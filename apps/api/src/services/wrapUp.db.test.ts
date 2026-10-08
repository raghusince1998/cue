import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Follow-ups from meetings: a meeting that just ended waits to be wrapped up
 * rather than being called dropped, what came out of it becomes plans of its
 * own, and the notification asking about it goes once.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./wrapUp.ts')
let rules: typeof import('./overdue.ts')
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('wrapup')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  rules = await import('./overdue.ts')
  svc = await import('./wrapUp.ts')
  me = await seedUser(h.sql, 'wrapup@test.local')
  other = await seedUser(h.sql, 'someone@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from recurrences`
  await h.sql`update users set followup_prompts = true`
})

/** Thursday 8 October 2026, 4pm. */
const NOW = new Date(2026, 9, 8, 16, 0)
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000)

async function meeting(
  title: string,
  startsAt: Date,
  opts: { minutes?: number; user?: Seeded; recurrenceId?: string } = {},
): Promise<string> {
  const who = opts.user ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status, recurrence_id)
    values (${who.orgId}, ${who.userId}, ${title}, 'meeting', ${startsAt}, ${opts.minutes ?? 60},
            'pending', ${opts.recurrenceId ?? null})
    returning id`
  return row!.id
}

test('a meeting from this week waits to be wrapped up; after a week it is dropped', async () => {
  await meeting('Client review', minutesAgo(120))
  await meeting('Last month offsite', new Date(2026, 8, 10, 10, 0))

  const c = dbm.schema.commitments
  const rows = await dbm.db
    .select({ title: c.title, waiting: rules.isAwaitingWrapUp(NOW), can: rules.canBeOverdue(NOW) })
    .from(c)
    .where(eq(c.userId, me.userId))
  const by = Object.fromEntries(rows.map((r) => [r.title, { waiting: Boolean(r.waiting), can: Boolean(r.can) }]))
  assert.deepEqual(by['Client review'], { waiting: true, can: false })
  assert.deepEqual(by['Last month offsite'], { waiting: false, can: true })
})

test('each line becomes its own plan, and the meeting is done', async () => {
  const id = await meeting('Client review', minutesAgo(120))
  const tomorrow = new Date(2026, 9, 9, 10, 0)
  const friday = new Date(2026, 9, 9, 10, 0)

  assert.equal(await svc.wrapUpMeeting(other.userId, id, [], NOW), null, 'not theirs to close')

  const r = await svc.wrapUpMeeting(
    me.userId,
    id,
    [
      { title: 'Send the revised proposal', dueAt: tomorrow.toISOString() },
      { title: 'signed contract', waitingOn: 'Ravi', dueAt: friday.toISOString() },
      { title: '   ', dueAt: tomorrow.toISOString() },
    ],
    NOW,
  )
  assert.deepEqual(r, { created: 2 }, 'a blank line is not a follow-up')

  const made = await h.sql<{ title: string; kind: string; notes: string; from_commitment_id: string }[]>`
    select title, kind, notes, from_commitment_id from commitments
    where from_commitment_id = ${id} order by title`
  assert.deepEqual(
    made.map((m) => [m.title, m.kind]),
    [
      ['Send the revised proposal', 'task'],
      ['Waiting on Ravi: signed contract', 'followup'],
    ],
  )
  assert.ok(made.every((m) => m.notes.includes('Client review')), 'each says where it came from')

  const [reminders] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    join commitments c on c.id = rem.commitment_id where c.from_commitment_id = ${id}`
  assert.equal(reminders!.n, 2, 'each one reminds on its day')

  const [closed] = await h.sql<{ status: string }[]>`select status from commitments where id = ${id}`
  assert.equal(closed!.status, 'done')
})

test('"nothing came out of it" still closes the meeting', async () => {
  const id = await meeting('Status sync', minutesAgo(90))
  assert.deepEqual(await svc.wrapUpMeeting(me.userId, id, [], NOW), { created: 0 })
  const [closed] = await h.sql<{ status: string }[]>`select status from commitments where id = ${id}`
  assert.equal(closed!.status, 'done')
})

test('the notification goes once, for a one-off meeting that just ended', async () => {
  const [series] = await h.sql<{ id: string }[]>`
    insert into recurrences (org_id, user_id, title, freq, starts_on)
    values (${me.orgId}, ${me.userId}, 'Daily standup', 'daily', '2026-10-01') returning id`

  const fresh = await meeting('Client review', minutesAgo(70)) // ended 10 minutes ago
  await meeting('Daily standup', minutesAgo(25), { minutes: 15, recurrenceId: series!.id })
  await meeting('This morning', minutesAgo(400)) // ended hours ago: too late to ask
  await meeting('Still going', minutesAgo(30)) // ends in half an hour
  await meeting('Theirs', minutesAgo(70), { user: other })
  await h.sql`update users set followup_prompts = false where id = ${other.userId}`

  assert.equal(await svc.promptFollowUps(NOW), 1)
  const [asked] = await h.sql<{ id: string }[]>`
    select id from commitments where wrapup_prompted_at is not null`
  assert.equal(asked!.id, fresh)

  assert.equal(await svc.promptFollowUps(NOW), 0, 'never asked twice')
})

// ------------------------------------------------------- waiting on others

test('a follow-up waiting on someone records who', async () => {
  const id = await meeting('Vendor call', minutesAgo(120))
  await svc.wrapUpMeeting(
    me.userId,
    id,
    [{ title: 'revised quote', waitingOn: 'Priya', dueAt: new Date(2026, 9, 9, 10, 0).toISOString() }],
    NOW,
  )
  const [row] = await h.sql<{ title: string; waiting_on: string }[]>`
    select title, waiting_on from commitments where from_commitment_id = ${id}`
  assert.deepEqual(row, { title: 'Waiting on Priya: revised quote', waiting_on: 'Priya' })
})

test('a check-in claims no time and is never overdue', async () => {
  const scheduling = await import('./scheduling.ts')
  const slots = await import('./freeSlots.ts')
  // Tomorrow at 10: a check-in with Ravi, and nothing else.
  const at10 = new Date(2026, 9, 9, 10, 0)
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status, waiting_on)
    values (${me.orgId}, ${me.userId}, 'Waiting on Ravi: contract', 'followup', ${at10}, 15, 'pending', 'Ravi')`

  // A 10 o'clock meeting does not clash with it…
  const report = await scheduling.checkConflicts(me.userId, { startsAt: at10, durationMinutes: 60 })
  assert.equal(report.conflicts.length, 0)

  // …and 10 o'clock is still offered as free.
  const free = await slots.findFreeSlots(me.userId, 30, 3, { now: new Date(2026, 9, 9, 9, 50) })
  assert.ok(free.some((d) => d.getTime() === at10.getTime()), 'the check-in did not take the slot')

  // Past its date, it is due a check-in — not overdue.
  const c = dbm.schema.commitments
  const [row] = await dbm.db
    .select({ can: rules.canBeOverdue(new Date(2026, 9, 12, 12, 0)) })
    .from(c)
    .where(eq(c.title, 'Waiting on Ravi: contract'))
  assert.equal(Boolean(row!.can), false)
})
