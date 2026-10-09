import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A clinic or company: whoever's "Works at" names it, what is open with the
 * people there or with the place itself, when you last heard, and its stage.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./accounts.ts')

before(async () => {
  h = await createTestDb('accounts')
  process.env.DATABASE_URL = h.url
  svc = await import('./accounts.ts')
  me = await seedUser(h.sql, 'accounts@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from contacts`
  await h.sql`delete from accounts`
})

/** Friday 9 October 2026, noon. */
const NOW = new Date(2026, 9, 9, 12, 0)
const day = (offset: number, hour = 10) => new Date(2026, 9, 9 + offset, hour, 0)

async function person(name: string, organization: string | null, talked: Date | null = null): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization, last_contacted_at)
    values (${me.orgId}, ${name}, ${organization}, ${talked}) returning id`
  return row!.id
}

async function plan(
  title: string,
  dueAt: Date,
  opts: { kind?: string; status?: string; waitingOn?: string; contactId?: string } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, status, waiting_on, contact_id)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt},
            ${opts.status ?? 'pending'}, ${opts.waitingOn ?? null}, ${opts.contactId ?? null})
    returning id`
  return row!.id
}

const find = async (name: string) =>
  (await svc.listAccounts(me.orgId, me.userId, NOW)).find((a) => a.key === svc.accountKey(name))

test('everything with the people there, and with the place itself', async () => {
  await person('Dr. Anil Mehta', 'Mehta Physio Clinic')
  await person('Dr. Priya Nair', '  mehta  physio clinic ')
  await person('Ravi Kumar', 'Infosys')

  const met = await plan('Product walkthrough with Dr. Mehta', day(-20), { kind: 'meeting', status: 'done' })
  const demo = await plan('Demo at Mehta Physio Clinic', day(4), { kind: 'meeting' })
  const payment = await plan('Waiting on Mehta Physio Clinic: advance payment', day(-1), {
    kind: 'followup', waitingOn: 'Mehta Physio Clinic',
  })
  const brochure = await plan('Send Anil the brochure', day(1))
  await plan('Quarterly review with Ravi', day(2), { kind: 'meeting' })

  const mehta = (await find('Mehta Physio Clinic'))!
  assert.equal(mehta.people.length, 2, 'two spellings, one clinic')
  assert.deepEqual(mehta.nextMeetings, [demo])
  assert.deepEqual(mehta.pastMeetings, [met])
  assert.deepEqual(mehta.waiting, [payment])
  assert.equal(mehta.waitingDue, 1)
  assert.deepEqual(mehta.owe, [brochure])
  assert.equal(mehta.lastContact?.getTime(), day(-20).getTime())

  const infosys = (await find('infosys'))!
  assert.equal(infosys.people.length, 1)
  assert.equal(infosys.nextMeetings.length, 1)
  assert.equal(infosys.owe.length, 0, "nothing of Mehta's leaks in")
})

test('talks with no contact for two weeks have gone quiet; a call puts that right', async () => {
  const anil = await person('Dr. Anil Mehta', 'Mehta Physio Clinic')
  await plan('Walkthrough with Dr. Mehta', day(-20), { kind: 'meeting', status: 'done' })
  await svc.saveAccount(me.orgId, { name: 'mehta physio clinic', stage: 'proposal' })

  let mehta = (await find('Mehta Physio Clinic'))!
  assert.equal(mehta.name, 'Mehta Physio Clinic', 'spelled the way the people there spell it')
  assert.equal(mehta.stage, 'proposal')
  assert.ok(mehta.stageChangedAt, 'the moment it changed is kept')
  assert.equal(mehta.quiet, false, 'the proposal just went out')

  await h.sql`update accounts set stage_changed_at = ${day(-18)}`
  mehta = (await find('Mehta Physio Clinic'))!
  assert.equal(mehta.quiet, true, 'sent 18 days ago, last met 20 days ago')

  await h.sql`update contacts set last_contacted_at = ${day(-1)} where id = ${anil}`
  mehta = (await find('Mehta Physio Clinic'))!
  assert.equal(mehta.quiet, false)

  // A customer is not "quiet" for not being chased.
  await svc.saveAccount(me.orgId, { name: 'Mehta Physio Clinic', stage: 'customer' })
  await h.sql`update contacts set last_contacted_at = null where id = ${anil}`
  assert.equal((await find('Mehta Physio Clinic'))!.quiet, false)
})

test('an account with a stage but nobody saved there yet still shows', async () => {
  await svc.saveAccount(me.orgId, { name: 'Sunrise Hospital', stage: 'prospect', notes: 'Met at the expo' })
  const sunrise = (await find('Sunrise Hospital'))!
  assert.equal(sunrise.people.length, 0)
  assert.equal(sunrise.notes, 'Met at the expo')
})

test('renaming moves everyone there; renaming onto another account merges them', async () => {
  await person('Dr. Anil Mehta', 'Mehta Physio')
  await person('Dr. Priya Nair', 'Mehta Physio Clinic')
  await svc.saveAccount(me.orgId, { name: 'Mehta Physio', stage: 'talking', notes: 'Wants a trial' })
  await svc.saveAccount(me.orgId, { name: 'Mehta Physio Clinic', notes: 'Two branches' })

  await svc.renameAccount(me.orgId, 'mehta physio', 'Mehta Physio Clinic')
  const list = await svc.listAccounts(me.orgId, me.userId, NOW)
  assert.equal(list.length, 1)
  assert.equal(list[0]!.people.length, 2)
  assert.equal(list[0]!.stage, 'talking', "the target had no stage, so the old one's is kept")
  assert.equal(list[0]!.notes, 'Two branches\n\nWants a trial')

  await svc.renameAccount(me.orgId, 'Mehta Physio Clinic', 'Mehta Physiotherapy')
  const [renamed] = await svc.listAccounts(me.orgId, me.userId, NOW)
  assert.equal(renamed!.name, 'Mehta Physiotherapy')
  assert.equal(renamed!.people.length, 2)
  const orgs = await h.sql<{ organization: string }[]>`select distinct organization from contacts`
  assert.deepEqual(orgs.map((o) => o.organization), ['Mehta Physiotherapy'])
})
