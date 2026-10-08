import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Focus time: a block that holds routine reminders until it ends, lets
 * critical ones through, protects its time from clashes, and is never
 * overdue.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./focus.ts')
let worker: typeof import('../worker/reminders.ts')
let rules: typeof import('./overdue.ts')
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('focus')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  rules = await import('./overdue.ts')
  svc = await import('./focus.ts')
  worker = await import('../worker/reminders.ts')
  me = await seedUser(h.sql, 'focus@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

/** A plan whose reminder is due right now. */
async function dueNow(title: string, priority = 'normal'): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, status, priority)
    values (${me.orgId}, ${me.userId}, ${title}, 'task', now() - interval '1 minute', 'pending', ${priority})
    returning id`
  await h.sql`
    insert into reminders (org_id, commitment_id, fire_at, attempt, status)
    values (${me.orgId}, ${row!.id}, now() - interval '1 minute', 0, 'pending')`
  return row!.id
}

const reminderOf = async (id: string) => {
  const [r] = await h.sql<{ status: string; held: boolean; fire_at: Date }[]>`
    select status, held, fire_at from reminders where commitment_id = ${id} order by created_at limit 1`
  return r!
}

test('while focusing, routine reminders wait for the end; critical ones do not', async () => {
  const started = await svc.startFocus(me.orgId, me.userId, { minutes: 50, title: 'Q3 deck' })
  assert.ok(started.ok)
  if (!started.ok) return

  const routine = await dueNow('Call the bank')
  const urgent = await dueNow('Server is down', 'critical')
  await worker.runOnce()

  const held = await reminderOf(routine)
  assert.equal(held.status, 'pending')
  assert.equal(held.held, true)
  assert.equal(held.fire_at.getTime(), started.endsAt.getTime(), 'it goes when the block ends')
  assert.equal((await reminderOf(urgent)).status, 'sent', 'critical still interrupts')
  assert.equal(await svc.heldCount(me.userId), 1)

  // Ending early lets it through at once, and records the time actually spent.
  const ended = await svc.endFocus(me.userId, started.id)
  assert.deepEqual(ended, { released: 1 })
  const released = await reminderOf(routine)
  assert.equal(released.held, false)
  assert.ok(released.fire_at.getTime() <= Date.now())
  const [block] = await h.sql<{ status: string; duration_minutes: number }[]>`
    select status, duration_minutes from commitments where id = ${started.id}`
  assert.equal(block!.status, 'done')
  assert.equal(block!.duration_minutes, 5, 'ended at once: the minimum, not the fifty planned')
})

test('a block is busy time: it clashes, and it is never overdue', async () => {
  const at = new Date(Date.now() + 26 * 3_600_000)
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status)
    values (${me.orgId}, ${me.userId}, 'Board meeting', 'meeting', ${at}, 60, 'pending')`

  const clash = await svc.startFocus(me.orgId, me.userId, { minutes: 90, startAt: new Date(at.getTime() - 30 * 60_000) })
  assert.equal(clash.ok, false)
  if (!clash.ok) assert.equal(clash.conflicts[0]!.title, 'Board meeting')

  const later = await svc.startFocus(me.orgId, me.userId, { minutes: 60, startAt: new Date(at.getTime() + 2 * 3_600_000) })
  assert.ok(later.ok)
  const [rem] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders where commitment_id = ${later.ok ? later.id : ''}`
  assert.equal(rem!.n, 1, 'a block booked for later announces its start')

  // Long past and never ended by hand: still not overdue.
  const c = dbm.schema.commitments
  const [row] = await dbm.db
    .select({ can: rules.canBeOverdue(new Date(at.getTime() + 30 * 86_400_000)) })
    .from(c)
    .where(eq(c.kind, 'focus'))
  assert.equal(Boolean(row!.can), false)
})

test('a block whose time is up is closed as done', async () => {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status)
    values (${me.orgId}, ${me.userId}, 'Focus time', 'focus', now() - interval '2 hours', 60, 'pending')`
  assert.equal(await svc.closeFinishedFocus(), 1)
  const [row] = await h.sql<{ status: string }[]>`select status from commitments where kind = 'focus'`
  assert.equal(row!.status, 'done')
  assert.equal(await svc.activeFocus(me.userId), null)
})
