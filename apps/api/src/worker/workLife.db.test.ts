import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Work and personal kept apart, in the reminder loop.
 *
 * Only what nags waits: a chase after the first reminder, or a plan with no
 * set time. A time the person chose always rings, and critical things,
 * bookings and calendar meetings are never held. Which side of the working
 * day "now" is on is set per test by choosing the working hours around the
 * real clock, so these pass at any hour.
 */
let h: Harness
let me: Seeded
let worker: typeof import('./reminders.ts')

const TZ = 'Asia/Kolkata'
const hourNow = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))

/** Every day, all day: it is always working time. */
async function atWork() {
  await h.sql`update users set keep_apart = true, timezone = ${TZ}, work_days = '{0,1,2,3,4,5,6}', work_start_hour = 0, work_end_hour = 24 where id = ${me.userId}`
}
/** Working hours that do not include this hour: it is never working time now. */
async function offWork() {
  const h0 = hourNow()
  const [start, end] = h0 >= 2 ? [0, 1] : [22, 23]
  await h.sql`update users set keep_apart = true, timezone = ${TZ}, work_days = '{0,1,2,3,4,5,6}', work_start_hour = ${start}, work_end_hour = ${end} where id = ${me.userId}`
}

before(async () => {
  h = await createTestDb('work_life')
  process.env.DATABASE_URL = h.url
  process.env.ESCALATION_MINUTES = '15'
  process.env.MAX_ESCALATIONS = '3'
  worker = await import('./reminders.ts')
  me = await seedUser(h.sql, 'work-life@test.local')
  // Kept apart only for someone who said they work.
  await h.sql`update users set uses = '{office}' where id = ${me.userId}`
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

async function plan(
  title: string,
  opts: { flexibility?: string; priority?: string; sphere?: string | null; attempt?: number } = {},
): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, status, flexibility, priority, sphere)
    values (${me.orgId}, ${me.userId}, ${title}, now() - interval '1 minute', 'pending',
            ${opts.flexibility ?? 'fixed'}, ${opts.priority ?? 'normal'}, ${opts.sphere ?? null})
    returning id`
  await h.sql`
    insert into reminders (org_id, commitment_id, fire_at, attempt, status)
    values (${me.orgId}, ${row!.id}, now() - interval '1 minute', ${opts.attempt ?? 0}, 'pending')`
  return row!.id
}

async function first(commitmentId: string) {
  const [r] = await h.sql<{ status: string; held: boolean; fire_at: Date }[]>`
    select status, held, fire_at from reminders where commitment_id = ${commitmentId} order by attempt, created_at limit 1`
  return r!
}

test('at work: a personal chase waits for the evening; a personal time chosen rings', async () => {
  await atWork()
  const chase = await plan('call mom', { attempt: 1 })
  const flexible = await plan('buy milk', { flexibility: 'flexible' })
  const chosen = await plan('call mom about Sunday')
  await worker.runOnce()

  for (const id of [chase, flexible]) {
    const r = await first(id)
    assert.equal(r.status, 'pending', 'held, not sent')
    assert.equal(r.held, true)
    assert.ok(r.fire_at > new Date(), 'until the working day ends')
  }
  assert.equal((await first(chosen)).status, 'sent', 'a time someone chose is kept')
})

test('at work: work nags carry on', async () => {
  await atWork()
  const id = await plan('send the Q3 report', { attempt: 1 })
  await worker.runOnce()
  assert.equal((await first(id)).status, 'sent')
})

test('after hours: a work chase waits for the morning; personal carries on', async () => {
  await offWork()
  const work = await plan('send the Q3 report', { attempt: 2 })
  const personal = await plan('call mom', { attempt: 1 })
  await worker.runOnce()
  const held = await first(work)
  assert.equal(held.status, 'pending')
  assert.equal(held.held, true)
  assert.equal((await first(personal)).status, 'sent')
})

test('never held: critical, the person’s own sorting, unsorted plans, or with it turned off', async () => {
  await atWork()
  const critical = await plan('pay school fees', { attempt: 1, priority: 'critical' })
  const sortedAsWork = await plan('gym', { attempt: 1, sphere: 'work' })
  const unsorted = await plan('call Ravi', { attempt: 1 })
  await worker.runOnce()
  assert.equal((await first(critical)).status, 'sent')
  assert.equal((await first(sortedAsWork)).status, 'sent', 'they said it is work, so it is')
  assert.equal((await first(unsorted)).status, 'sent', 'neither: nothing to hold it for')

  await h.sql`update users set keep_apart = false where id = ${me.userId}`
  const off = await plan('call mom', { attempt: 1 })
  await worker.runOnce()
  assert.equal((await first(off)).status, 'sent')
})

test('only for someone with a working life', async () => {
  await atWork()
  await h.sql`update users set uses = '{personal}' where id = ${me.userId}`
  const id = await plan('call mom', { attempt: 1 })
  await worker.runOnce()
  assert.equal((await first(id)).status, 'sent')
  await h.sql`update users set uses = '{}' where id = ${me.userId}`
  const unsaid = await plan('call mom', { attempt: 1 })
  await worker.runOnce()
  assert.equal((await first(unsaid)).status, 'sent', 'not said yet: no working day to keep it out of')
  await h.sql`update users set uses = '{office}' where id = ${me.userId}`
})
