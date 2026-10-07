import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The sample week.
 *
 * It is the first thing a new account sees, so it has to read like someone's
 * real working week — and when it is cleared, every trace of it has to go,
 * from the list as well as the summary, without touching anything real.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./sampleDay.ts')

before(async () => {
  h = await createTestDb('sampleday')
  process.env.DATABASE_URL = h.url
  svc = await import('./sampleDay.ts')
  me = await seedUser(h.sql, 'sample@test.local')
  other = await seedUser(h.sql, 'bystander@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from recurrences`
  await h.sql`delete from intentions`
  await h.sql`delete from trips`
})

/** Wednesday 7 October 2026. */
const day = (hour: number, minute = 0) => new Date(2026, 9, 7, hour, minute)

async function own(who: Seeded, title: string) {
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, notes)
    values (${who.orgId}, ${who.userId}, ${title}, ${day(18)}, 'my own note')`
}

test('the week includes a daily, a weekday and a weekly repeat', async () => {
  await svc.loadSampleDay(me.orgId, me.userId, day(10))

  const series = await h.sql<{ title: string; freq: string; by_weekday: number[] | null }[]>`
    select title, freq, by_weekday from recurrences where user_id = ${me.userId} order by title`
  assert.deepEqual(
    series.map((s) => [s.title, s.freq, s.by_weekday]),
    [
      ['Daily standup', 'weekly', [1, 2, 3, 4, 5]],
      ['Take evening medicines', 'daily', null],
      ['Weekly review with your manager', 'weekly', [5]],
    ],
  )

  // Each series has occurrences on the calendar, not just a rule.
  const [occurrences] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments
    where user_id = ${me.userId} and recurrence_id is not null`
  assert.ok(occurrences!.n > 20, `expected occurrences to be written, got ${occurrences!.n}`)
})

test('the plan with no set time is never born overdue, whatever the hour', async () => {
  for (const now of [day(9), day(14, 30), day(16, 30), day(17, 45), day(20)]) {
    await svc.loadSampleDay(me.orgId, me.userId, now)
    const [flex] = await h.sql<{ due_at: Date; preferred_window: string }[]>`
      select due_at, preferred_window from commitments
      where user_id = ${me.userId} and flexibility = 'flexible'`
    assert.ok(flex, 'expected a flexible plan')
    assert.ok(
      flex.due_at.getTime() > now.getTime(),
      `loaded at ${now.toTimeString().slice(0, 5)}, due ${flex.due_at.toTimeString().slice(0, 5)} (${flex.preferred_window})`,
    )
  }
})

test('nothing in the week leans on a place name the reader has to decode', async () => {
  await svc.loadSampleDay(me.orgId, me.userId, day(10))
  const rows = await h.sql<{ text: string }[]>`
    select title as text from commitments where user_id = ${me.userId}
    union all select title || ' ' || place_label from intentions where user_id = ${me.userId}
    union all select place_label from trips where user_id = ${me.userId}`
  const all = rows.map((r) => r.text).join(' | ')
  assert.doesNotMatch(all, /Mathura|peda|temple|uncle|Amma/i)
})

test('clearing removes everything the sample added, and nothing else', async () => {
  await own(me, 'My real plan')
  await own(other, 'Someone else entirely')

  await svc.loadSampleDay(me.orgId, me.userId, day(10))
  assert.equal(await svc.hasSampleDay(me.orgId, me.userId), true)

  await svc.clearSampleDay(me.orgId, me.userId)

  const left = await h.sql<{ title: string }[]>`select title from commitments order by title`
  assert.deepEqual(
    left.map((r) => r.title),
    ['My real plan', 'Someone else entirely'],
  )
  for (const table of ['recurrences', 'intentions', 'trips'] as const) {
    const [rows] = await h.sql<{ n: number }[]>`select count(*)::int as n from ${h.sql(table)}`
    assert.equal(rows!.n, 0, `${table} still has sample rows`)
  }
  assert.equal(await svc.hasSampleDay(me.orgId, me.userId), false)
})
