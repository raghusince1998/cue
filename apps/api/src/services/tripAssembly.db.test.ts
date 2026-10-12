import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import type { ParsedBooking } from '@cue/shared'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Trips, end to end: the bookings for one journey — out, the stay, and home —
 * become one trip with the right dates, wherever they came from; and a trip
 * gets a day-by-day plan and a packing list.
 */

let h: Harness
let me: Seeded
let bookings: typeof import('./bookings.ts')
let app: FastifyInstance
let token: string

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const inDays = (n: number, hour = 9, minute = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, hour, minute)
}

function booking(b: Partial<ParsedBooking> & Pick<ParsedBooking, 'type' | 'title' | 'startsAt'>): ParsedBooking {
  return {
    timeKnown: true,
    endsOn: null,
    city: null,
    from: null,
    fromCity: null,
    ref: null,
    notes: null,
    provider: null,
    durationMinutes: 60,
    remindBeforeMinutes: b.type === 'flight' ? 180 : 120,
    ...b,
  }
}

async function tripsNow() {
  return h.sql<{ id: string; place_label: string; starts_on: string; ends_on: string }[]>`
    select id, place_label, starts_on::text, ends_on::text from trips where user_id = ${me.userId} order by starts_on`
}
async function tripOf(title: string) {
  const [row] = await h.sql<{ trip_id: string | null }[]>`select trip_id from commitments where title = ${title} and user_id = ${me.userId}`
  return row?.trip_id ?? null
}

before(async () => {
  h = await createTestDb('trip_assembly')
  process.env.DATABASE_URL = h.url
  bookings = await import('./bookings.ts')
  me = await seedUser(h.sql, 'trips@test.local')
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { tripRoutes } = await import('../routes/trips.ts')
  const { quickAddRoutes } = await import('../routes/quickAdd.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  app = Fastify()
  await registerAuth(app)
  await app.register(tripRoutes)
  await app.register(quickAddRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'trips@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from trips`
  await h.sql`update users set home_city = 'Bangalore' where id = ${me.userId}`
})

test('out, the stay and home again: three emails, one trip from the first day to the last', async () => {
  const out = inDays(20, 7)
  const back = inDays(24, 15)
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight 6E 512 · Bengaluru → Goa', startsAt: out, city: 'Goa', from: 'Bengaluru', fromCity: 'Bengaluru', ref: 'ABC123' }), 'Goa')
  // The hotel's email names no city: it belongs to the trip it falls in.
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'hotel', title: 'Check in: Taj Holiday Village', startsAt: inDays(20, 14), endsOn: ymd(back), ref: 'HTL9988' }), null)
  // Home again: to Bengaluru, which is home under its old name.
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight 6E 513 · Goa → Bengaluru', startsAt: back, city: 'Bengaluru', from: 'Goa', fromCity: 'Goa', ref: 'XYZ789' }), 'Bengaluru')

  const trips = await tripsNow()
  assert.equal(trips.length, 1, 'one trip, not three')
  assert.deepEqual([trips[0]!.place_label, trips[0]!.starts_on, trips[0]!.ends_on], ['Goa', ymd(out), ymd(back)])
  for (const title of ['Flight 6E 512 · Bengaluru → Goa', 'Check in: Taj Holiday Village', 'Flight 6E 513 · Goa → Bengaluru']) {
    assert.equal(await tripOf(title), trips[0]!.id, title)
  }
})

test('the hotel first, then the flight a day early: still one trip, from the flight', async () => {
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'hotel', title: 'Check in: Sea Breeze', startsAt: inDays(31, 14), endsOn: ymd(inDays(33)), city: 'Goa' }), 'Goa')
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'train', title: 'Train 12779 · Pune → Madgaon', startsAt: inDays(30, 22), city: 'Goa', fromCity: 'Pune' }), 'Goa')
  const trips = await tripsNow()
  assert.equal(trips.length, 1)
  assert.deepEqual([trips[0]!.starts_on, trips[0]!.ends_on], [ymd(inDays(30)), ymd(inDays(33))])
})

test('on from one city to the next: the first trip ends, the next begins', async () => {
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight AI 101 · Bengaluru → Delhi', startsAt: inDays(10, 8), city: 'Delhi', fromCity: 'Bengaluru' }), 'Delhi')
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'train', title: 'Train 12015 · New Delhi → Jaipur', startsAt: inDays(12, 6), city: 'Jaipur', fromCity: 'Delhi' }), 'Jaipur')
  const trips = await tripsNow()
  assert.deepEqual(
    trips.map((t) => [t.place_label, t.starts_on, t.ends_on]),
    [
      ['Delhi', ymd(inDays(10)), ymd(inDays(12))],
      ['Jaipur', ymd(inDays(12)), ymd(inDays(12))],
    ],
  )
  assert.equal(await tripOf('Train 12015 · New Delhi → Jaipur'), trips[1]!.id)
})

test('with no home city said, back to where a trip began is still the way home', async () => {
  await h.sql`update users set home_city = null where id = ${me.userId}`
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight · Pune → Goa', startsAt: inDays(50, 7), city: 'Goa', fromCity: 'Pune' }), 'Goa')
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight · Goa → Pune', startsAt: inDays(53, 19), city: 'Pune', fromCity: 'Goa' }), 'Pune')
  const trips = await tripsNow()
  assert.deepEqual(trips.map((t) => t.place_label), ['Goa'], 'no trip to Pune')
  assert.equal(trips[0]!.ends_on, ymd(inDays(53)))
  assert.equal(await tripOf('Flight · Goa → Pune'), trips[0]!.id)
})

test('a trip already over and come back from is not the one being left', async () => {
  await h.sql`update users set home_city = null where id = ${me.userId}`
  // In Bengaluru from the 3rd to the 5th, with nothing to say how they came or went.
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Bengaluru', ${ymd(inDays(3))}, ${ymd(inDays(5))})`
  // Three weeks later, a flight out of Bengaluru to Goa.
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight · Bengaluru → Goa', startsAt: inDays(25, 7), city: 'Goa', fromCity: 'Bengaluru' }), 'Goa')
  const trips = await tripsNow()
  assert.deepEqual(
    trips.map((t) => [t.place_label, t.starts_on, t.ends_on]),
    [
      ['Bengaluru', ymd(inDays(3)), ymd(inDays(5))],
      ['Goa', ymd(inDays(25)), ymd(inDays(25))],
    ],
    'the Bengaluru trip keeps its own dates',
  )
})

test('a journey to where you live is no trip at all', async () => {
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'train', title: 'Train · Mysuru → Bengaluru', startsAt: inDays(5, 9), city: 'Bengaluru', fromCity: 'Mysuru' }), 'Bengaluru')
  assert.equal((await tripsNow()).length, 0)
})

test('a typed flight and its way home join one trip too', async () => {
  const day = (n: number) => `${inDays(n).getDate()} ${inDays(n).toLocaleDateString('en-IN', { month: 'short' })}`
  const call = (text: string) =>
    app.inject({ method: 'POST', url: '/quick', payload: { text, allowConflict: true }, headers: { authorization: `Bearer ${token}` } })
  assert.equal((await call(`flight to Goa on ${day(40)} 7am`)).statusCode, 201)
  assert.equal((await call(`flight from Goa to Bangalore on ${day(43)} 6pm`)).statusCode, 201)
  const trips = await tripsNow()
  assert.equal(trips.length, 1)
  assert.deepEqual([trips[0]!.starts_on, trips[0]!.ends_on], [ymd(inDays(40)), ymd(inDays(43))])
})

test('a trip day by day, and a packing list made once, the evening before', async () => {
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'flight', title: 'Flight 6E 512 · Bengaluru → Goa', startsAt: inDays(20, 7), city: 'Goa', fromCity: 'Bengaluru', ref: 'ABC123', provider: 'IndiGo' }), 'Goa')
  await bookings.saveFoundBooking(me.orgId, me.userId, booking({ type: 'hotel', title: 'Check in: Taj', startsAt: inDays(20, 14), endsOn: ymd(inDays(23)) }), null)
  const [trip] = await tripsNow()
  const auth = { authorization: `Bearer ${token}` }

  const detail = (await app.inject({ method: 'GET', url: `/trips/${trip!.id}`, headers: auth })).json() as {
    planned: { title: string; booking: { leaveAt: string | null; ref: string | null; endsOn: string | null } | null }[]
  }
  const flight = detail.planned.find((p) => p.title.startsWith('Flight'))!
  assert.equal(new Date(flight.booking!.leaveAt!).getHours(), 4, 'leave three hours before a 7am flight')
  assert.equal(flight.booking!.ref, 'ABC123')
  assert.equal(detail.planned.find((p) => p.title === 'Check in: Taj')!.booking!.endsOn, ymd(inDays(23)))

  const made = await app.inject({ method: 'POST', url: `/trips/${trip!.id}/packing`, payload: { purpose: 'leisure' }, headers: auth })
  assert.equal(made.statusCode, 201)
  const { id } = made.json() as { id: string }
  const [plan] = await h.sql<{ title: string; due_at: Date }[]>`select title, due_at from commitments where id = ${id}`
  assert.equal(plan!.title, 'Pack for Goa')
  assert.equal(ymd(plan!.due_at), ymd(inDays(19)), 'the evening before')
  assert.equal(plan!.due_at.getHours(), 20)
  const items = await h.sql<{ text: string }[]>`select text from checklist_items where commitment_id = ${id} order by position`
  assert.ok(items.some((i) => i.text === '4 sets of clothes'), 'three nights: a change a day and a spare')
  assert.ok(items.some((i) => /100 ml/.test(i.text)), 'a flight on the trip')

  const again = await app.inject({ method: 'POST', url: `/trips/${trip!.id}/packing`, payload: { purpose: 'work' }, headers: auth })
  assert.equal((again.json() as { id: string }).id, id, 'made once')
})

test('a typed flight offers to book the cab, the evening before', async () => {
  const day = inDays(9)
  const res = await app.inject({
    method: 'POST',
    url: '/quick/preview',
    payload: { text: `flight to Goa on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })} 7am` },
    headers: { authorization: `Bearer ${token}` },
  })
  const cab = (res.json() as { suggestions: { id: string; text: string; extra?: { dueAt: string } }[] }).suggestions.find((s) => s.id === 'book-cab')
  assert.ok(cab)
  assert.match(cab.text, /leave by 4 am/)
  assert.equal(ymd(new Date(cab.extra!.dueAt)), ymd(inDays(8)))
})
