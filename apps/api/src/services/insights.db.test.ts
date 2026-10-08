import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What the app claims to have noticed.
 *
 * Every insight is an assertion about someone's life, shown to them without
 * being asked. A wrong one ("Fridays are where things slip" when they are not)
 * is worse than silence, because it teaches the reader to ignore the whole
 * panel. So the tests here are mostly about restraint: saying nothing when
 * there is nothing to say, and not calling noise a pattern.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./insights.ts')

before(async () => {
  h = await createTestDb('insights')
  process.env.DATABASE_URL = h.url
  svc = await import('./insights.ts')
  me = await seedUser(h.sql, 'insight@test.local')
  other = await seedUser(h.sql, 'someone@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from intentions`
  await h.sql`delete from trips`
})

/** Midday on Monday 5 October 2026, so "today" has room behind and ahead. */
const NOW = new Date(2026, 9, 5, 12, 0)
/** Offset from that Monday to the Friday of the same week. */
const TO_FRIDAY = 4

function at(dayOffset: number, hour: number, minute = 0): Date {
  return new Date(2026, 9, 5 + dayOffset, hour, minute)
}

async function plan(
  title: string,
  dueAt: Date,
  opts: { minutes?: number; place?: string; status?: string; user?: Seeded; completedAt?: Date } = {},
) {
  const who = opts.user ?? me
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, place_label, status, completed_at)
    values (${who.orgId}, ${who.userId}, ${title}, ${dueAt}, ${opts.minutes ?? 60},
            ${opts.place ?? null}, ${opts.status ?? 'pending'}, ${opts.completedAt ?? null})`
}

const ids = (list: { id: string }[]) => list.map((i) => i.id)

test('an empty account is told nothing, rather than told nothing is wrong', async () => {
  const insights = await svc.buildInsights(me.userId, NOW)
  assert.deepEqual(insights, [], 'inventing observations from no data is how a panel loses trust')
})

test('overdue work is reported with its oldest item named', async () => {
  await plan('Send the quote', at(-9, 17))
  await plan('Call the accountant', at(-2, 17))

  const insights = await svc.buildInsights(me.userId, NOW)
  const overdue = insights.find((i) => i.id === 'overdue')

  assert.ok(overdue)
  assert.equal(overdue.tone, 'urgent')
  assert.match(overdue.headline, /2 things/)
  assert.match(overdue.detail, /Send the quote/, 'the oldest is the one worth naming')
  assert.match(overdue.detail, /8 days/, 'a 17:00 due time nine dates back is eight full days')
})

test("one person's day is never another's", async () => {
  await plan('Their overdue thing', at(-3, 10), { user: other })

  const mine = await svc.buildInsights(me.userId, NOW)
  assert.ok(!ids(mine).includes('overdue'))

  const theirs = await svc.buildInsights(other.userId, NOW)
  assert.ok(ids(theirs).includes('overdue'))
})

test('a lopsided pattern is reported; scattered misses are not', async () => {
  // Four of five on a Friday: real.
  for (const w of [1, 2, 3, 4]) await plan(`Friday ${w}`, at(TO_FRIDAY - 7 * w, 17))
  await plan('A Monday one', at(-5, 17))

  const clustered = await svc.buildInsights(me.userId, NOW)
  const pattern = clustered.find((i) => i.id === 'drop-pattern')
  assert.ok(pattern, 'four out of five on one weekday is a pattern worth naming')
  assert.match(pattern.headline, /Friday/)

  // Spread across the week: noise, and must stay unremarked.
  await h.sql`delete from commitments`
  for (const d of [1, 2, 3, 4, 5, 6]) await plan(`Scattered ${d}`, at(-d - 1, 17))

  const scattered = await svc.buildInsights(me.userId, NOW)
  assert.ok(
    !ids(scattered).includes('drop-pattern'),
    'six misses on six different days is not a Tuesday problem',
  )
})

test('fewer than four misses is not yet a pattern', async () => {
  for (const w of [1, 2, 3]) await plan(`Friday ${w}`, at(-7 * w + 2, 17))

  const insights = await svc.buildInsights(me.userId, NOW)
  assert.ok(!ids(insights).includes('drop-pattern'))
})

test('the day’s shape counts only what is still ahead', async () => {
  await plan('Already finished this morning', at(0, 9), { minutes: 60 })
  await plan('This afternoon', at(0, 14), { minutes: 120 })

  const insights = await svc.buildInsights(me.userId, NOW)
  const shape = insights.find((i) => i.id === 'today-shape')

  assert.ok(shape)
  assert.match(shape.headline, /1 fixed thing|% booked/)
  assert.match(shape.detail, /1 fixed thing/, 'the 9am is behind us and no longer occupies the day')
})

test('a trip surfaces what has been waiting for it', async () => {
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Mathura', '2026-10-10', '2026-10-12')`
  for (const t of ['Buy peda', 'Visit the temple']) {
    await h.sql`
      insert into intentions (org_id, user_id, place_label, title, status)
      values (${me.orgId}, ${me.userId}, 'mathura', ${t}, 'saved')`
  }

  const insights = await svc.buildInsights(me.userId, NOW)
  const trip = insights.find((i) => i.id.startsWith('trip-'))

  assert.ok(trip, 'a trip with wishes attached is the whole point of saving them')
  assert.match(trip.headline, /2 things waiting for Mathura/)
  assert.match(trip.detail, /5 days/)
  assert.match(trip.detail, /Buy peda/)
})

test('a trip with nothing waiting says nothing', async () => {
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Delhi', '2026-10-10', '2026-10-12')`

  const insights = await svc.buildInsights(me.userId, NOW)
  assert.ok(!insights.some((i) => i.id.startsWith('trip-')))
})

test('completed work is acknowledged', async () => {
  await plan('Dentist', at(-2, 10), { status: 'done', completedAt: at(-2, 11) })

  const insights = await svc.buildInsights(me.userId, NOW)
  const good = insights.find((i) => i.id === 'closed-week')
  assert.ok(good)
  assert.equal(good.tone, 'positive')
})

test('the most urgent thing sorts first', async () => {
  await plan('Overdue', at(-3, 10))
  await plan('Done', at(-1, 10), { status: 'done', completedAt: at(-1, 11) })

  const insights = await svc.buildInsights(me.userId, NOW)
  assert.equal(insights[0]!.tone, 'urgent', 'a panel that leads with congratulations buries the work')
})

test('the summary rolls forward once today is spent', async () => {
  await plan('Tomorrow morning', at(1, 10), { minutes: 120 })

  // Evening: nothing left today, so the useful question is about tomorrow.
  const evening = await svc.buildSummary(me.userId, new Date(2026, 9, 5, 20, 0))
  assert.equal(evening.subject, 'tomorrow')
  assert.equal(evening.todayCount, 1)
  assert.ok(evening.percentBooked > 0, 'a 0% dial at 8pm is accurate and worthless')
})

test('the summary stays on today while today still has something in it', async () => {
  await plan('This afternoon', at(0, 15), { minutes: 60 })

  const summary = await svc.buildSummary(me.userId, NOW)
  assert.equal(summary.subject, 'today')
  assert.equal(summary.todayCount, 1)
})

test('a calendar event that is over is not something you dropped', async () => {
  // Connecting Google brings in a year of history. Every meeting in it is in
  // the past and still "pending", and it used to land in the overdue count —
  // 65 of them on a real account, last year's Diwali included.
  await h.sql`delete from commitments`
  const [feed] = await h.sql<{ id: string }[]>`
    insert into calendar_feeds (org_id, user_id, label, source)
    values (${me.orgId}, ${me.userId}, 'Work', 'google') returning id`
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, status, feed_id)
    values (${me.orgId}, ${me.userId}, 'Last year''s offsite', ${at(-300, 10)}, 'pending', ${feed!.id})`

  const insights = await svc.buildInsights(me.userId, NOW)
  assert.ok(!insights.some((i) => i.id === 'overdue' || i.id === 'stuck'), 'not dropped, not stuck')
  const summary = await svc.buildSummary(me.userId, NOW)
  assert.equal(summary.overdue, 0)

  // Something you set out to do still counts, and its button goes somewhere.
  await plan('Send the quote', at(-2, 10))
  const after = await svc.buildInsights(me.userId, NOW)
  const overdue = after.find((i) => i.id === 'overdue')
  assert.ok(overdue, 'a real overdue item is still reported')
  assert.notEqual(overdue!.action?.href, '/', 'a button that links to the page it is on does nothing')
  await h.sql`delete from calendar_feeds`
})
