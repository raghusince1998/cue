import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Admitting the nagging failed.
 *
 * The risk in a feature like this is being wrong in either direction: calling
 * something stuck while it is still being chased makes the app defeatist, and
 * never calling anything stuck leaves the red list growing forever. Most of
 * these tests are about where that line sits, and about not making the mess
 * worse while clearing it.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./triage.ts')

before(async () => {
  h = await createTestDb('triage')
  process.env.DATABASE_URL = h.url
  process.env.MAX_ESCALATIONS = '4'
  svc = await import('./triage.ts')
  me = await seedUser(h.sql, 'triage@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

/** Monday 5 October 2026, midday. */
const NOW = new Date(2026, 9, 5, 12, 0)
const daysAgo = (n: number, hour = 10) => new Date(2026, 9, 5 - n, hour, 0)

async function overdue(
  title: string,
  when: Date,
  opts: { escalations?: number; flexibility?: string; minutes?: number; user?: Seeded } = {},
): Promise<string> {
  const who = opts.user ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments
      (org_id, user_id, title, due_at, duration_minutes, escalation_count, flexibility, status)
    values (${who.orgId}, ${who.userId}, ${title}, ${when}, ${opts.minutes ?? 60},
            ${opts.escalations ?? 0}, ${opts.flexibility ?? 'fixed'}, 'pending')
    returning id`
  return row!.id
}

const statusOf = async (id: string) => {
  const [row] = await h.sql<{ status: string; flexibility: string; due_at: Date; escalation_count: number }[]>`
    select status, flexibility, due_at, escalation_count from commitments where id = ${id}`
  return row!
}

// ------------------------------------------------------------ what is stuck

test('something late but still being chased is not called stuck', async () => {
  await overdue('Yesterday', daysAgo(1), { escalations: 1 })

  const r = await svc.buildTriage(me.userId, NOW)
  assert.equal(r.items.length, 0, 'the reminders are still working; let them')
  assert.equal(r.merelyLate, 1, 'but it is counted, so the framing stays honest')
})

test('something old is stuck even if it was never chased out', async () => {
  await overdue('Ancient', daysAgo(20))
  const r = await svc.buildTriage(me.userId, NOW)
  assert.equal(r.items.length, 1)
})

test('something chased to the end of the chain is stuck immediately', async () => {
  // Only two days late, but the reminders have already given up on it.
  await overdue('Chased out', daysAgo(2), { escalations: 4 })

  const r = await svc.buildTriage(me.userId, NOW)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0]!.reason, 'chased-out')
  assert.match(r.items[0]!.because, /not working/)
})

test('a flexible item that never got a slot says exactly that', async () => {
  await overdue('Vague task', daysAgo(10), { flexibility: 'flexible' })

  const r = await svc.buildTriage(me.userId, NOW)
  assert.equal(r.items[0]!.reason, 'never-scheduled')
  assert.match(r.items[0]!.because, /never had a real time/)
})

test('the weekday pattern is named when there is one', async () => {
  // Four Fridays out of five.
  for (const n of [3, 10, 17, 24]) await overdue(`Friday ${n}`, daysAgo(n, 17))
  await overdue('A Monday one', daysAgo(7, 17))

  const r = await svc.buildTriage(me.userId, NOW)
  assert.equal(r.worstWeekday, 'Friday')
  assert.ok(r.items.some((i) => i.reason === 'bad-day'))
})

test("another person's backlog is never yours", async () => {
  await overdue('Theirs', daysAgo(30), { user: other })
  assert.equal((await svc.buildTriage(me.userId, NOW)).items.length, 0)
})

// ------------------------------------------------------- what it suggests

test('what it suggests depends on how dead the thing is', async () => {
  const recent = await overdue('Recently stuck', daysAgo(8))
  const chased = await overdue('Chased out', daysAgo(10), { escalations: 4 })
  const ancient = await overdue('Long gone', daysAgo(40), { escalations: 4 })

  const r = await svc.buildTriage(me.userId, NOW)
  const by = Object.fromEntries(r.items.map((i) => [i.id, i.suggested]))

  assert.equal(by[recent], 'reschedule', 'merely old is worth another go')
  assert.equal(by[chased], 'someday', 'chasing failed, so stop pretending it has a deadline')
  assert.equal(by[ancient], 'drop', 'six weeks past and chased out is not happening')
})

test('two stuck items are never offered the same slot', async () => {
  await overdue('First', daysAgo(10), { minutes: 60 })
  await overdue('Second', daysAgo(11), { minutes: 60 })
  await overdue('Third', daysAgo(12), { minutes: 60 })

  const r = await svc.buildTriage(me.userId, NOW)
  const slots = r.items.map((i) => i.suggestedAt).filter(Boolean)
  assert.equal(new Set(slots).size, slots.length, 'accepting the lot would book them on top of each other')
})

test('a proposed slot does not collide with real commitments', async () => {
  // A packed afternoon the suggestion has to avoid.
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, flexibility, status)
    values (${me.orgId}, ${me.userId}, 'Busy', ${new Date(2026, 9, 5, 13, 0)}, 240, 'fixed', 'pending')`
  await overdue('Needs a slot', daysAgo(10), { minutes: 60 })

  const r = await svc.buildTriage(me.userId, NOW)
  const at = new Date(r.items[0]!.suggestedAt!)
  const clashes = at < new Date(2026, 9, 5, 17, 0) && at >= new Date(2026, 9, 5, 13, 0)
  assert.ok(!clashes, `suggested ${at.toISOString()}, inside a booked block`)
})

// ---------------------------------------------------------------- applying

test('marking it done closes it and stops the chasing', async () => {
  const id = await overdue('Actually did this', daysAgo(10))
  await h.sql`insert into reminders (org_id, commitment_id, fire_at) values (${me.orgId}, ${id}, now())`

  const r = await svc.applyTriage(me.userId, [{ id, action: 'done' }], NOW)
  assert.equal(r.done, 1)
  assert.equal((await statusOf(id)).status, 'done')

  const [pending] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders where commitment_id = ${id} and status = 'pending'`
  assert.equal(pending!.n, 0)
})

test('dropping takes it off the list without destroying the row', async () => {
  const id = await overdue('Not happening', daysAgo(40))
  await svc.applyTriage(me.userId, [{ id, action: 'drop' }], NOW)

  const row = await statusOf(id)
  // Deleted, not cancelled. Cancelling would leave it sitting on its day with
  // a line through it, which is the wrong answer for something you have just
  // admitted you are never going to do.
  assert.equal(row.status, 'deleted')
  // Soft, though: what you keep abandoning is a pattern, and History is the
  // only place it can be seen.
  const [still] = await h.sql<{ n: number }[]>`select count(*)::int as n from commitments where id = ${id}`
  assert.equal(still!.n, 1)

  const [stamped] = await h.sql<{ deleted_at: Date | null }[]>`
    select deleted_at from commitments where id = ${id}`
  assert.ok(stamped!.deleted_at, 'records when it was let go')
})

test('"no deadline" keeps it but stops it pretending to have one', async () => {
  const id = await overdue('Someday', daysAgo(20), { escalations: 4 })
  await svc.applyTriage(me.userId, [{ id, action: 'someday' }], NOW)

  const row = await statusOf(id)
  assert.equal(row.status, 'pending', 'it is still yours')
  assert.equal(row.flexibility, 'flexible')
  assert.equal(row.escalation_count, 0, 'the chasing is what failed, so the count resets')
})

test('rescheduling starts a fresh chain from the new time', async () => {
  const id = await overdue('Move me', daysAgo(10), { escalations: 4 })
  const at = new Date(2026, 9, 7, 14, 0)

  await svc.applyTriage(me.userId, [{ id, action: 'reschedule', at: at.toISOString() }], NOW)

  const row = await statusOf(id)
  assert.equal(+row.due_at, +at)
  assert.equal(row.escalation_count, 0)

  const [queued] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders where commitment_id = ${id} and status = 'pending'`
  assert.equal(queued!.n, 1, 'exactly one fresh reminder, not a second chain alongside the old')
})

test('rescheduling into the past is refused', async () => {
  const id = await overdue('Move me', daysAgo(10))
  const r = await svc.applyTriage(
    me.userId,
    [{ id, action: 'reschedule', at: daysAgo(2).toISOString() }],
    NOW,
  )
  assert.equal(r.rescheduled, 0, 'moving something to last Saturday solves nothing')
})

test('a decision cannot reach another account', async () => {
  const theirs = await overdue('Theirs', daysAgo(30), { user: other })
  const r = await svc.applyTriage(me.userId, [{ id: theirs, action: 'drop' }], NOW)
  assert.equal(r.dropped, 0)
  assert.equal((await statusOf(theirs)).status, 'pending')
})

test('a decision about something already closed does nothing', async () => {
  const id = await overdue('Already done', daysAgo(10))
  await h.sql`update commitments set status = 'done' where id = ${id}`

  const r = await svc.applyTriage(me.userId, [{ id, action: 'drop' }], NOW)
  assert.equal(r.dropped, 0, 'a stale panel must not reopen or overwrite a closed item')
})
