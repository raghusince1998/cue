import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Proposing a day, and then writing it.
 *
 * This is the only part of the app that moves things on someone's calendar
 * without them typing the time, so the restraint matters more than the
 * placement: it must never touch a fixed appointment, never double-book a
 * slot, never silently drop something it could not fit, and never apply a
 * stale plan over a change the person made in between.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./planTomorrow.ts')

before(async () => {
  h = await createTestDb('plantomorrow')
  process.env.DATABASE_URL = h.url
  svc = await import('./planTomorrow.ts')
  me = await seedUser(h.sql, 'plan@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

/** Monday 5 October 2026, 8pm — the hour the nudge actually fires. */
const NOW = new Date(2026, 9, 5, 20, 0)
const tomorrowAt = (hour: number, minute = 0) => new Date(2026, 9, 6, hour, minute)

async function fixed(title: string, when: Date, minutes = 60, user = me) {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, flexibility)
    values (${user.orgId}, ${user.userId}, ${title}, ${when}, ${minutes}, 'fixed')
    returning id`
  return row!.id
}

async function loose(title: string, minutes: number, window: string | null = null, when = tomorrowAt(12)) {
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, flexibility, preferred_window)
    values (${me.orgId}, ${me.userId}, ${title}, ${when}, ${minutes}, 'flexible', ${window})
    returning id`
  return row!.id
}

const hhmm = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

test('a loose item is given a real time in a real gap', async () => {
  await fixed('Standup', tomorrowAt(9, 30), 30)
  await loose('Write the proposal', 60)

  const plan = await svc.planTomorrow(me.userId, NOW)
  assert.equal(plan.proposals.length, 1)
  assert.equal(plan.proposals[0]!.title, 'Write the proposal')
  assert.ok(plan.proposals[0]!.because.length > 0, 'a placement with no reason is not checkable')
})

test('the stated window is honoured, not quietly ignored', async () => {
  await loose('Call the plumber', 30, 'afternoon')
  await loose('Morning run', 30, 'morning')

  const plan = await svc.planTomorrow(me.userId, NOW)
  const by = Object.fromEntries(plan.proposals.map((p) => [p.title, new Date(p.at).getHours()]))

  assert.ok(by['Morning run']! < 12, `morning item landed at ${by['Morning run']}`)
  assert.ok(by['Call the plumber']! >= 12 && by['Call the plumber']! < 17)
})

test('two proposals never claim the same minutes', async () => {
  await loose('First', 120)
  await loose('Second', 120)
  await loose('Third', 120)

  const plan = await svc.planTomorrow(me.userId, NOW)
  const spans = plan.proposals
    .map((p) => ({ from: +new Date(p.at), to: +new Date(p.at) + p.durationMinutes * 60_000 }))
    .sort((a, b) => a.from - b.from)

  for (let i = 1; i < spans.length; i += 1) {
    assert.ok(spans[i]!.from >= spans[i - 1]!.to, 'a plan that double-books itself is not a plan')
  }
})

test('nothing is proposed on top of a fixed appointment', async () => {
  await fixed('Client review', tomorrowAt(10), 180)
  await loose('Write the proposal', 60)

  const plan = await svc.planTomorrow(me.userId, NOW)
  const at = new Date(plan.proposals[0]!.at)
  const clashes = at < tomorrowAt(13) && new Date(at.getTime() + 60 * 60_000) > tomorrowAt(10)
  assert.ok(!clashes, `proposed ${hhmm(plan.proposals[0]!.at)}, which overlaps a fixed meeting`)
})

test('something that does not fit is reported, not dropped', async () => {
  // A full day, leaving nowhere for a three-hour task.
  await fixed('All morning', tomorrowAt(8), 240)
  await fixed('All afternoon', tomorrowAt(12, 30), 510)
  await loose('Deep work', 180)

  const plan = await svc.planTomorrow(me.userId, NOW)
  assert.equal(plan.proposals.length, 0)
  assert.equal(plan.unplaceable.length, 1)
  assert.match(plan.unplaceable[0]!.because, /no gap|No gap/i)
})

test('the awkward item is placed before the easy ones', async () => {
  await fixed('Morning block', tomorrowAt(8), 120)
  await loose('Quick call', 15)
  await loose('Long session', 240)

  const plan = await svc.planTomorrow(me.userId, NOW)
  // Filling the day with quick wins first would strand the long one.
  assert.ok(
    plan.proposals.some((p) => p.title === 'Long session'),
    'the item that barely fits should be placed while there is still room',
  )
})

test('a flexible item that already slipped is picked up too', async () => {
  // Last week, never done. It is exactly what wants a slot tomorrow.
  await loose('Overdue errand', 30, null, new Date(2026, 8, 28, 12, 0))

  const plan = await svc.planTomorrow(me.userId, NOW)
  assert.equal(plan.proposals.length, 1)
  assert.equal(plan.proposals[0]!.title, 'Overdue errand')
})

test('an all-day item does not block the day', async () => {
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, flexibility, all_day)
    values (${me.orgId}, ${me.userId}, 'Public holiday', ${tomorrowAt(0)}, 60, 'fixed', true)`
  await loose('Write the proposal', 60)

  const plan = await svc.planTomorrow(me.userId, NOW)
  assert.equal(plan.proposals.length, 1, 'a holiday is context, not a booking')
})

// ------------------------------------------------------------- applying

test('applying turns a proposal into a real, fixed plan', async () => {
  const id = await loose('Write the proposal', 60, 'morning')
  const plan = await svc.planTomorrow(me.userId, NOW)

  const applied = await svc.applyPlan(me.userId, [
    { commitmentId: id, at: plan.proposals[0]!.at },
  ])
  assert.equal(applied, 1)

  const [row] = await h.sql<{ flexibility: string; preferred_window: string | null; due_at: Date }[]>`
    select flexibility, preferred_window, due_at from commitments where id = ${id}`
  assert.equal(row!.flexibility, 'fixed')
  assert.equal(row!.preferred_window, null, 'it has a time now; the window is spent')
  assert.equal(+row!.due_at, +new Date(plan.proposals[0]!.at))
})

test('only the proposals handed back are applied', async () => {
  const keep = await loose('Leave this one alone', 30)
  const move = await loose('Move this one', 30)
  const plan = await svc.planTomorrow(me.userId, NOW)
  const chosen = plan.proposals.find((p) => p.commitmentId === move)!

  await svc.applyPlan(me.userId, [{ commitmentId: move, at: chosen.at }])

  const [untouched] = await h.sql<{ flexibility: string }[]>`
    select flexibility from commitments where id = ${keep}`
  assert.equal(untouched!.flexibility, 'flexible')
})

test('a stale plan never overwrites a time set by hand', async () => {
  const id = await loose('Write the proposal', 60)
  const plan = await svc.planTomorrow(me.userId, NOW)

  // The person gave it a real time themselves between seeing the plan and
  // accepting it. Their choice wins.
  const theirs = tomorrowAt(16, 45)
  await h.sql`update commitments set flexibility = 'fixed', due_at = ${theirs} where id = ${id}`

  const applied = await svc.applyPlan(me.userId, [
    { commitmentId: id, at: plan.proposals[0]!.at },
  ])
  assert.equal(applied, 0)

  const [row] = await h.sql<{ due_at: Date }[]>`select due_at from commitments where id = ${id}`
  assert.equal(+row!.due_at, +theirs)
})

test("another person's commitment cannot be rescheduled", async () => {
  const theirs = await fixed('Their meeting', tomorrowAt(14), 60, other)
  await h.sql`update commitments set flexibility = 'flexible' where id = ${theirs}`

  const applied = await svc.applyPlan(me.userId, [
    { commitmentId: theirs, at: tomorrowAt(9).toISOString() },
  ])
  assert.equal(applied, 0)
})

test('an empty day proposes nothing rather than inventing work', async () => {
  const plan = await svc.planTomorrow(me.userId, NOW)
  assert.deepEqual(plan.proposals, [])
  assert.deepEqual(plan.unplaceable, [])
  assert.equal(plan.loose, 0)
})

test('the reasons are said in Hindi to someone who reads Hindi', async () => {
  await loose('Morning run', 30, 'morning')
  const plan = await svc.planTomorrow(me.userId, NOW, 'hi')
  assert.match(plan.proposals[0]!.because, /^सुबह का पहला खाली समय, .+ से .+ तक।$/)
  assert.match((await svc.planTomorrow(me.userId, NOW)).proposals[0]!.because, /^Your first free morning stretch/)
})
