import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Sharing when you are free: real gaps, spread over the days asked for, two a
 * day at most, never on a weekend.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./availability.ts')

before(async () => {
  h = await createTestDb('availability')
  process.env.DATABASE_URL = h.url
  svc = await import('./availability.ts')
  me = await seedUser(h.sql, 'free@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

/** Thursday 8 October 2026, 8 in the morning. */
const NOW = new Date(2026, 9, 8, 8, 0)
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute)
const label = (d: Date) => `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

async function meeting(dueAt: Date, minutes: number) {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes, status)
    values (${me.orgId}, ${me.userId}, 'Busy', 'meeting', ${dueAt}, ${minutes}, 'pending')`
}

test('the next three working days, two times a day, around what is booked', async () => {
  await meeting(at(8, 9), 120) // Thursday 9 to 11

  const slots = await svc.availability(me.userId, { minutes: 30, range: 'soon', part: 'any', count: 6 }, NOW)
  assert.deepEqual(slots.map(label), [
    '8 11:00', // the first gap after the meeting
    '8 12:30', // an hour clear of the first offer, so it is a real alternative
    '9 09:00',
    '9 10:30',
    '12 09:00', // Friday, then the weekend is skipped
    '12 10:30',
  ])
})

test('mornings only, and next week only', async () => {
  const mornings = await svc.availability(me.userId, { minutes: 60, range: 'next', part: 'morning', count: 10 }, NOW)
  assert.ok(mornings.length > 0)
  assert.ok(mornings.every((d) => d.getHours() < 12), 'nothing after noon')
  assert.ok(mornings.every((d) => d >= at(12, 0) && d < at(17, 0)), 'Monday to Friday of next week')
  assert.ok(mornings.every((d) => d.getDay() !== 0 && d.getDay() !== 6))
})

test('on a Friday, "this week" runs into next week rather than offering one day', async () => {
  const friday = new Date(2026, 9, 9, 16, 0)
  const slots = await svc.availability(me.userId, { minutes: 30, range: 'week', part: 'any', count: 6 }, friday)
  assert.ok(slots.some((d) => d >= at(12, 0)), 'offers reach next week')
})

test('nothing in the next three hours: they need time to reply', async () => {
  const evening = new Date(2026, 9, 8, 17, 30)
  const slots = await svc.availability(me.userId, { minutes: 30, range: 'soon', part: 'any', count: 3 }, evening)
  assert.ok(slots.every((d) => d.getTime() >= evening.getTime() + 3 * 3_600_000))
  assert.equal(slots[0]!.getDate(), 9, 'too late today, so it starts tomorrow')
})

test('asked in the evening, "next 3 days" still covers three working days', async () => {
  const evening = new Date(2026, 9, 8, 17, 30) // Thursday
  const slots = await svc.availability(me.userId, { minutes: 30, range: 'soon', part: 'any', count: 10 }, evening)
  assert.deepEqual([...new Set(slots.map((d) => d.getDate()))], [9, 12, 13], 'Friday, Monday, Tuesday')
})
