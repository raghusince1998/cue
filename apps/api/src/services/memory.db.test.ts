import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What the app claims to remember about someone.
 *
 * Prefilling from history is the difference between a form and an assistant,
 * and also the fastest way to make one untrustworthy. A wrong duration or the
 * wrong place costs more than an empty field, because the person has to notice
 * it before they can correct it. So most of this is about when *not* to guess.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./memory.ts')

before(async () => {
  h = await createTestDb('memory')
  process.env.DATABASE_URL = h.url
  svc = await import('./memory.ts')
  me = await seedUser(h.sql, 'mem@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

const NOW = new Date(2026, 9, 5, 12, 0)

async function past(
  title: string,
  daysAgo: number,
  opts: { hour?: number; minute?: number; minutes?: number; place?: string; kind?: string; user?: Seeded } = {},
) {
  const who = opts.user ?? me
  const when = new Date(2026, 9, 5 - daysAgo, opts.hour ?? 10, opts.minute ?? 0)
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, place_label)
    values (${who.orgId}, ${who.userId}, ${title}, ${opts.kind ?? 'meeting'}, ${when},
            ${opts.minutes ?? 60}, ${opts.place ?? null})`
}

test('nothing in the past means nothing is guessed', async () => {
  assert.equal(await svc.recallSimilar(me.userId, 'dentist', { now: NOW }), null)
})

test('a matching title brings back its duration and place', async () => {
  await past('Dentist appointment', 90, { minutes: 45, place: 'Apollo Clinic' })
  await past('Dentist appointment', 30, { minutes: 45, place: 'Apollo Clinic' })

  const learned = await svc.recallSimilar(me.userId, 'dentist', { now: NOW })
  assert.ok(learned)
  assert.equal(learned.durationMinutes, 45)
  assert.equal(learned.placeLabel, 'Apollo Clinic')
  assert.match(learned.because, /2 times/)
  assert.match(learned.because, /45 min/)
})

test('a short phrase matches a longer one it is contained in', async () => {
  await past('Dentist appointment with Dr Shah', 20, { minutes: 45 })
  await past('Dentist appointment with Dr Shah', 50, { minutes: 45 })

  const learned = await svc.recallSimilar(me.userId, 'dentist', { now: NOW })
  assert.ok(learned, 'plain overlap would reject this for being short, which is backwards')
  assert.equal(learned.durationMinutes, 45)
})

test('unrelated titles are not mistaken for each other', async () => {
  await past('Dentist appointment', 20, { minutes: 45 })

  assert.equal(await svc.recallSimilar(me.userId, 'team standup', { now: NOW }), null)
  assert.equal(await svc.recallSimilar(me.userId, 'buy milk', { now: NOW }), null)
})

test("another person's history is never borrowed", async () => {
  await past('Dentist appointment', 20, { minutes: 45, user: other })
  assert.equal(await svc.recallSimilar(me.userId, 'dentist', { now: NOW }), null)
})

test('the usual duration is the middle one, not the outlier', async () => {
  await past('Gym', 3, { minutes: 60 })
  await past('Gym', 10, { minutes: 60 })
  // One four-hour session should not drag the normal answer upwards.
  await past('Gym', 17, { minutes: 240 })

  const learned = await svc.recallSimilar(me.userId, 'gym', { now: NOW })
  assert.equal(learned?.durationMinutes, 60)
})

test('a consistent time is claimed as a habit; a scattered one is not', async () => {
  for (const d of [3, 10, 17, 24]) await past('Gym', d, { hour: 7 })
  const habit = await svc.recallSimilar(me.userId, 'gym', { now: NOW })
  assert.equal(habit?.hour, 7)
  assert.match(habit!.becauseHour!, /usually.*7am/i)

  await h.sql`delete from commitments`
  for (const [i, d] of [3, 10, 17, 24].entries()) await past('Gym', d, { hour: 7 + i * 3 })
  const scattered = await svc.recallSimilar(me.userId, 'gym', { now: NOW })
  assert.equal(scattered?.hour, null, 'four different hours is not a routine')
})

test('one precedent is offered in weaker words than a habit', async () => {
  await past('Sprint planning', 7, { hour: 14, minute: 30 })

  const learned = await svc.recallSimilar(me.userId, 'sprint planning', { now: NOW })
  assert.ok(learned)
  assert.equal(learned.hour, null, 'a single instance is not a habit')
  assert.equal(learned.lastHour, 14)
  assert.equal(learned.lastMinute, 30, 'an 11:30 meeting moved to 11:00 is a small lie')
  assert.match(learned.becauseHour!, /Last time/)
})

test('a single occurrence is reported without an odd-sounding count', async () => {
  await past('Physio', 14, { minutes: 45, place: 'Koregaon Park' })

  const learned = await svc.recallSimilar(me.userId, 'physio', { now: NOW })
  assert.ok(learned)
  assert.equal(learned.placeLabel, 'Koregaon Park')
  // Where it came from is worth saying; "you have done this 1 time" is not.
  assert.match(learned.because, /^Last time this was at Koregaon Park/)
  assert.doesNotMatch(learned.because, /1 time/)
})

test('a match with nothing concrete to report stays silent', async () => {
  // No place, and a single instance so no "usually N minutes" either.
  await past('Coffee catch-up', 14, { minutes: 60 })

  const learned = await svc.recallSimilar(me.userId, 'coffee catch-up', { now: NOW })
  assert.ok(learned, 'it still prefills quietly')
  assert.equal(learned.because, '')
})

test('history older than a year is not applied', async () => {
  await past('Dentist appointment', 500, { minutes: 45 })
  assert.equal(await svc.recallSimilar(me.userId, 'dentist', { now: NOW }), null)
})

test('an item can be excluded from its own lookup', async () => {
  await past('Dentist appointment', 20, { minutes: 45 })
  const [row] = await h.sql<{ id: string }[]>`select id from commitments limit 1`

  assert.ok(await svc.recallSimilar(me.userId, 'dentist', { now: NOW }))
  assert.equal(
    await svc.recallSimilar(me.userId, 'dentist', { now: NOW, excludeId: row!.id }),
    null,
    'editing something must not learn from itself',
  )
})

test('frequent titles are habits, not one-offs', async () => {
  await past('Team standup', 2)
  await past('Team standup', 9)
  await past('Team standup', 16)
  await past('Board meeting', 5)

  const frequent = await svc.frequentTitles(me.userId, NOW)
  const titles = frequent.map((f) => f.title)

  assert.ok(titles.includes('Team standup'))
  assert.ok(!titles.includes('Board meeting'), 'once is not a habit, and listing it is clutter')
})
