import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Who it has been too long with. Last contact is worked out from what
 * happened — meetings, visits, finished things, "Talked today" — and only
 * from things that were really with that person.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./keepInTouch.ts')
let brief: typeof import('./morningBrief.ts')

before(async () => {
  h = await createTestDb('keep_in_touch')
  process.env.DATABASE_URL = h.url
  svc = await import('./keepInTouch.ts')
  brief = await import('./morningBrief.ts')
  me = await seedUser(h.sql, 'touch@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from interactions`
  await h.sql`delete from contacts`
})

/** Friday 9 October 2026, noon. */
const NOW = new Date(2026, 9, 9, 12, 0)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

async function person(
  name: string,
  opts: { every?: number; since?: Date; talked?: Date; snoozed?: Date; organization?: string } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into contacts (org_id, name, organization, keep_in_touch_days, keep_in_touch_since,
                          last_contacted_at, touch_snoozed_until)
    values (${me.orgId}, ${name}, ${opts.organization ?? null}, ${opts.every ?? null},
            ${opts.since ?? (opts.every ? daysAgo(100) : null)}, ${opts.talked ?? null},
            ${opts.snoozed ?? null})
    returning id`
  return row!.id
}

async function plan(
  title: string,
  dueAt: Date,
  opts: { kind?: string; status?: string; completedAt?: Date; contactId?: string; waitingOn?: string } = {},
) {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, status, completed_at, contact_id, waiting_on)
    values (${me.orgId}, ${me.userId}, ${title}, ${opts.kind ?? 'task'}, ${dueAt},
            ${opts.status ?? 'pending'}, ${opts.completedAt ?? null}, ${opts.contactId ?? null},
            ${opts.waitingOn ?? null})`
}

test('a meeting that happened counts; one still ahead, or cancelled, does not', async () => {
  const ravi = await person('Ravi Kumar', { every: 14 })
  await plan('Client review with Ravi', daysAgo(20), { kind: 'meeting', status: 'done' })
  await plan('Lunch with Ravi', daysAgo(3), { kind: 'meeting', status: 'cancelled' })
  await plan('Quarterly sync with Ravi', new Date(NOW.getTime() + 86_400_000), { kind: 'meeting' })

  const [r] = await svc.keepInTouch(me.orgId, me.userId, NOW)
  assert.equal(r!.id, ravi)
  assert.equal(r!.lastTouch?.getTime(), daysAgo(20).getTime())
  assert.equal(r!.due, true, '20 days is more than every 2 weeks')
})

test('finished calls, visits and "Talked today" all count as contact', async () => {
  const called = await person('Anita Desai', { every: 30 })
  await plan('Call back', daysAgo(40), { kind: 'callback', status: 'done', completedAt: daysAgo(10), contactId: called })

  const visited = await person('Dr. Mehta', { every: 30 })
  await h.sql`
    insert into interactions (org_id, user_id, contact_id, purpose, started_at)
    values (${me.orgId}, ${me.userId}, ${visited}, 'business', ${daysAgo(5)})`

  const talked = await person('Priya Shah', { every: 7, talked: daysAgo(2) })

  const answered = await person('Vikram Rao', { every: 14 })
  await plan('Waiting on Vikram: signed contract', daysAgo(30), {
    kind: 'followup', status: 'done', completedAt: daysAgo(4), waitingOn: 'Vikram',
  })

  const list = await svc.keepInTouch(me.orgId, me.userId, NOW)
  const by = new Map(list.map((p) => [p.id, p]))
  assert.equal(by.get(called)!.lastTouch?.getTime(), daysAgo(10).getTime(), 'when it was done, not when it was due')
  assert.equal(by.get(visited)!.lastTouch?.getTime(), daysAgo(5).getTime())
  assert.equal(by.get(talked)!.lastTouch?.getTime(), daysAgo(2).getTime())
  assert.equal(by.get(answered)!.lastTouch?.getTime(), daysAgo(4).getTime(), 'a check-in they answered')
  assert.ok(list.every((p) => !p.due))
})

test('with nothing yet, the clock starts when keeping in touch did', async () => {
  await person('New Contact', { every: 30, since: daysAgo(10) })
  await person('Old Contact', { every: 30, since: daysAgo(45) })
  const list = await svc.keepInTouch(me.orgId, me.userId, NOW)
  const by = new Map(list.map((p) => [p.name, p]))
  assert.equal(by.get('New Contact')!.due, false, 'monthly, set 10 days ago')
  assert.equal(by.get('Old Contact')!.due, true)
  assert.equal(list[0]!.name, 'Old Contact', 'longest overdue first')
})

test('"not now" quiets someone until the snooze ends', async () => {
  await person('Ravi Kumar', { every: 7, snoozed: new Date(NOW.getTime() + 3 * 86_400_000) })
  await person('Priya Shah', { every: 7, snoozed: daysAgo(1) })
  const by = new Map((await svc.keepInTouch(me.orgId, me.userId, NOW)).map((p) => [p.name, p]))
  assert.equal(by.get('Ravi Kumar')!.due, false)
  assert.equal(by.get('Priya Shah')!.due, true, 'a snooze that has run out')
})

test('another Ravi\'s meeting is not contact with this one', async () => {
  await person('Ravi Kumar', { every: 14 })
  await person('Ravi Iyer')
  await plan('Coffee with Ravi', daysAgo(2), { kind: 'meeting', status: 'done' })
  const [r] = await svc.keepInTouch(me.orgId, me.userId, NOW)
  assert.equal(r!.lastTouch, null, 'two Ravis: the first name alone is nobody in particular')
})

test('people not being kept in touch with are left out, and the brief names who is due', async () => {
  await person('Not Tracked')
  await person('Dr. Mehta', { every: 14, organization: 'Mehta Physio Clinic' })
  const list = await svc.keepInTouch(me.orgId, me.userId, NOW)
  assert.deepEqual(list.map((p) => p.name), ['Dr. Mehta'])

  const stats = await brief.briefStats(me.userId, 'Asia/Kolkata', NOW)
  assert.deepEqual(stats.reachOut, ['Dr. Mehta'])
  const b = brief.composeBrief(stats, 'Asia/Kolkata')!
  assert.match(b.body, /Time to reach out to Dr\. Mehta\./)
})
