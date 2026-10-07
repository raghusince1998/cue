import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * When somebody is actually free.
 *
 * One answer to a question three screens were each working out separately —
 * the triage panel, tomorrow's plan, and now the "move it" control on an
 * overdue card. Three implementations of "free" is how they drift apart and
 * start contradicting each other on the same day.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./freeSlots.ts')

before(async () => {
  h = await createTestDb('freeslots')
  process.env.DATABASE_URL = h.url
  svc = await import('./freeSlots.ts')
  me = await seedUser(h.sql, 'slots@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
})

/** Monday 5 October 2026, 08:00 — before the working day starts. */
const NOW = new Date(2026, 9, 5, 8, 0)
const at = (dayOffset: number, hour: number, minute = 0) =>
  new Date(2026, 9, 5 + dayOffset, hour, minute)

/** Cancelled or deleted: either way it is no longer holding the time. */
async function bookWithStatus(title: string, when: Date, status: string) {
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, status)
    values (${me.orgId}, ${me.userId}, ${title}, ${when}, 60, ${status})`
}

async function book(
  title: string,
  when: Date,
  opts: { minutes?: number; allDay?: boolean; flexibility?: string; user?: Seeded } = {},
) {
  const who = opts.user ?? me
  const [row] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, due_at, duration_minutes, all_day, flexibility, status)
    values (${who.orgId}, ${who.userId}, ${title}, ${when}, ${opts.minutes ?? 60},
            ${opts.allDay ?? false}, ${opts.flexibility ?? 'fixed'}, 'pending')
    returning id`
  return row!.id
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

test('an empty day offers the start of working hours', async () => {
  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.equal(hhmm(first!), '09:00')
})

test('a booked block is skipped', async () => {
  await book('Standup', at(0, 9), { minutes: 120 })

  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.ok(first! >= at(0, 11), `offered ${hhmm(first!)}, inside a booked block`)
})

test('nothing in the past is offered', async () => {
  const midday = new Date(2026, 9, 5, 12, 15)
  const [first] = await svc.findFreeSlots(me.userId, 30, 1, { now: midday })
  assert.ok(first! >= midday)
})

test('the offers are spread out rather than three in a row', async () => {
  const slots = await svc.findFreeSlots(me.userId, 30, 3, { now: NOW })
  assert.equal(slots.length, 3)
  // Three slots half an hour apart is one choice presented three times.
  for (let i = 1; i < slots.length; i += 1) {
    const gap = (slots[i]!.getTime() - slots[i - 1]!.getTime()) / 60_000
    assert.ok(gap >= 60, `only ${gap} minutes between offers`)
  }
})

test('a window is honoured when one is asked for', async () => {
  const slots = await svc.findFreeSlots(me.userId, 30, 3, { now: NOW, window: 'afternoon' })
  for (const s of slots) {
    assert.ok(s.getHours() >= 12 && s.getHours() < 17, `${hhmm(s)} is not an afternoon`)
  }
})

test('an all-day item does not block the day', async () => {
  await book('Public holiday', at(0, 0), { allDay: true })
  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.equal(hhmm(first!), '09:00', 'a holiday is context, not a booking')
})

test('a flexible item claims nothing', async () => {
  await book('Call the plumber', at(0, 9), { flexibility: 'flexible', minutes: 120 })
  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.equal(hhmm(first!), '09:00')
})

test('the item being moved does not block itself', async () => {
  const id = await book('Dentist', at(0, 9), { minutes: 60 })

  const without = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.ok(without[0]! >= at(0, 10), 'it occupies its own slot by default')

  const excluding = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW, excludeId: id })
  assert.equal(hhmm(excluding[0]!), '09:00', 'its own old time must not block the best answer')
})

test("another person's diary is not consulted", async () => {
  await book('Their all-day meeting', at(0, 9), { minutes: 480, user: other })
  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW })
  assert.equal(hhmm(first!), '09:00')
})

test('a day with no room returns fewer, not worse', async () => {
  // Every working hour booked for the whole horizon. 09:00 plus ten hours ends
  // exactly at 19:00, which leaves 19:00 itself free — touching slots do not
  // clash, here as everywhere else — so it has to run past the last one.
  for (let day = 0; day < 14; day += 1) await book(`Day ${day}`, at(day, 9), { minutes: 11 * 60 })

  const slots = await svc.findFreeSlots(me.userId, 60, 3, { now: NOW, horizonDays: 14 })
  assert.deepEqual(slots, [], '"nothing free for a fortnight" is a real answer worth being told')
})

test('nextFreeSlot is the first of the same answer', async () => {
  await book('Standup', at(0, 9), { minutes: 60 })
  const one = await svc.nextFreeSlot(me.userId, 30, { now: NOW })
  const [first] = await svc.findFreeSlots(me.userId, 30, 1, { now: NOW })
  assert.equal(+one!, +first!)
})

test('times already promised elsewhere are respected', async () => {
  const taken = [{ from: at(0, 9), to: at(0, 11) }]
  const [first] = await svc.findFreeSlots(me.userId, 60, 1, { now: NOW, claimed: taken })
  assert.ok(first! >= at(0, 11), 'a slot handed out a moment ago is not free any more')
})

/**
 * Whether a status still occupies time, asked the only way that is not fooled
 * by the spreading rule: offers are kept an hour apart, so "is 10:00 in the
 * list" can be false for a completely free diary. What matters is whether the
 * row changes the answer at all.
 */
const iso = (dates: Date[]) => dates.map((d) => d.toISOString())

test('a pending plan holds its hour', async () => {
  // The control. Without it the two tests below prove nothing. It books the
  // slot the empty diary offers first, which is the one hour a booking is
  // guaranteed to displace.
  const empty = iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW }))
  await bookWithStatus('Real review', new Date(empty[0]!), 'pending')
  const booked = iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW }))
  assert.notDeepEqual(booked, empty)
})

test('a cancelled plan gives the time back', async () => {
  // The point of leaving it on the calendar struck through is that the slot
  // reads as free. It had better actually be free.
  const empty = iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW }))
  await bookWithStatus('Cancelled review', new Date(empty[0]!), 'cancelled')
  assert.deepEqual(iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW })), empty)
})

test('a deleted plan gives the time back too', async () => {
  const empty = iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW }))
  await bookWithStatus('Gone', new Date(empty[0]!), 'deleted')
  assert.deepEqual(iso(await svc.findFreeSlots(me.userId, 60, 5, { now: NOW })), empty)
})
