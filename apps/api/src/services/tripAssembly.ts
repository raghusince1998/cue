import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { sameCity } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'

/**
 * One trip from many bookings.
 *
 * A trip to Goa arrives as three separate messages: the flight out on the
 * 1st, the hotel from the 1st to the 5th, the flight home on the 5th. Each on
 * its own made a one-day trip, or none — the hotel email names no city, and
 * the flight home goes to where the person lives. Here each booking finds the
 * trip it belongs to, or starts one, and stretches its dates to hold it, so
 * the three become one trip from the 1st to the 5th.
 *
 * - Going somewhere that is not home: the trip there that covers that day or
 *   touches it, or a new one.
 * - Leaving somewhere: the trip there that began in the last month is the one
 *   being left — it ends that day. The way home joins it; a hop on to another
 *   city starts the next trip.
 * - A stay: the trip it falls in, by city when the booking names one and by
 *   date when it does not, stretched to check-out.
 */

export interface TripBooking {
  type: string
  /** When it leaves, or checks in. */
  startsAt: Date
  /** Check-out, for a stay. */
  endsOn: string | null
  /** Where it goes. */
  city: string | null
  /** Where it leaves from. */
  fromCity: string | null
}

export interface TripFound {
  tripId: string
  placeLabel: string
  /** Started by this booking, rather than found. */
  created: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function shift(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + days)
  return ymd(d)
}

type TripRow = { id: string; placeLabel: string; startsOn: string; endsOn: string }

/** Widen a trip to take in these days, never narrowing it. */
async function stretch(exec: Executor, trip: TripRow, from: string, to: string): Promise<void> {
  const startsOn = from < trip.startsOn ? from : trip.startsOn
  const endsOn = to > trip.endsOn ? to : trip.endsOn
  if (startsOn === trip.startsOn && endsOn === trip.endsOn) return
  await exec.update(schema.trips).set({ startsOn, endsOn }).where(eq(schema.trips.id, trip.id))
}

/** This person's trips to a city that cover a day, or touch it by one either side. */
async function tripToAround(exec: Executor, userId: string, city: string, day: string): Promise<TripRow | null> {
  const t = schema.trips
  const rows = await exec
    .select({ id: t.id, placeLabel: t.placeLabel, startsOn: t.startsOn, endsOn: t.endsOn })
    .from(t)
    .where(and(eq(t.userId, userId), lte(t.startsOn, shift(day, 1)), gte(t.endsOn, shift(day, -1))))
  return rows.find((r) => sameCity(r.placeLabel, city)) ?? null
}

/**
 * The trip to a city being left on a day: one still under way (or ended the
 * day before), or one begun in the last month by a journey there that has no
 * way back yet — a flight out on the 1st, home on the 5th. A trip that has
 * ended and been come back from is not this one: being in Bengaluru on the
 * 17th does not make the 1st of next month part of it.
 */
async function tripBeingLeft(exec: Executor, userId: string, city: string, day: string): Promise<TripRow | null> {
  const t = schema.trips
  const rows = await exec
    .select({ id: t.id, placeLabel: t.placeLabel, startsOn: t.startsOn, endsOn: t.endsOn })
    .from(t)
    .where(and(eq(t.userId, userId), lte(t.startsOn, day), gte(t.startsOn, shift(day, -30))))
    .orderBy(desc(t.startsOn))
  for (const trip of rows.filter((r) => sameCity(r.placeLabel, city))) {
    if (trip.endsOn >= shift(day, -1)) return trip
    const c = schema.commitments
    const legs = await exec
      .select({ to: sql<string | null>`${c.booking}->>'city'`, from: sql<string | null>`${c.booking}->>'fromCity'` })
      .from(c)
      .where(and(eq(c.tripId, trip.id), sql`${c.booking}->>'type' in ('flight', 'train', 'bus')`))
    const arrived = legs.some((l) => sameCity(l.to, trip.placeLabel))
    const leftAlready = legs.some((l) => sameCity(l.from, trip.placeLabel))
    if (arrived && !leftAlready) return trip
  }
  return null
}

/** Any trip under way on a day: where a stay that names no city belongs. */
async function tripOnDay(exec: Executor, userId: string, day: string): Promise<TripRow | null> {
  const t = schema.trips
  const [row] = await exec
    .select({ id: t.id, placeLabel: t.placeLabel, startsOn: t.startsOn, endsOn: t.endsOn })
    .from(t)
    .where(and(eq(t.userId, userId), lte(t.startsOn, day), gte(t.endsOn, day)))
    .orderBy(desc(t.startsOn))
    .limit(1)
  return row ?? null
}

/**
 * The trip a booking belongs to — found, started, and stretched to hold it —
 * or null when it belongs to none: a journey within the home city, say.
 */
export async function tripForBooking(
  orgId: string,
  userId: string,
  b: TripBooking,
  exec: Executor = db,
): Promise<TripFound | null> {
  const [user] = await exec.select({ home: schema.users.homeCity }).from(schema.users).where(eq(schema.users.id, userId))
  const home = user?.home ?? null
  const day = ymd(b.startsAt)
  const away = (city: string | null): city is string => Boolean(city) && !sameCity(city, home)

  // A stay: the trip it falls in, to its check-out.
  if (b.type === 'hotel') {
    const lastDay = b.endsOn && b.endsOn > day ? b.endsOn : day
    const trip = away(b.city) ? await tripToAround(exec, userId, b.city, day) : await tripOnDay(exec, userId, day)
    if (trip) {
      await stretch(exec, trip, day, lastDay)
      return { tripId: trip.id, placeLabel: trip.placeLabel, created: false }
    }
    if (!away(b.city)) return null
    return start(exec, orgId, userId, b.city, day, lastDay)
  }

  // Leaving somewhere away: that trip ends today.
  const leaving = away(b.fromCity) ? await tripBeingLeft(exec, userId, b.fromCity, day) : null
  if (leaving) await stretch(exec, leaving, leaving.startsOn, day)

  // Back to where the trip began is home, even before anyone has said where
  // home is: Goa → Bengaluru after Bengaluru → Goa is the way back, not a trip.
  const backWhereItBegan = leaving !== null && sameCity(b.city, await cameFrom(exec, leaving.id))

  // Going somewhere away: the trip there, or a new one.
  if (away(b.city) && !backWhereItBegan) {
    const there = await tripToAround(exec, userId, b.city, day)
    if (there) {
      await stretch(exec, there, day, there.endsOn)
      return { tripId: there.id, placeLabel: there.placeLabel, created: false }
    }
    return start(exec, orgId, userId, b.city, day, b.endsOn && b.endsOn > day ? b.endsOn : day)
  }

  // Going home, or nowhere known: the way back is part of the trip it ends.
  return leaving ? { tripId: leaving.id, placeLabel: leaving.placeLabel, created: false } : null
}

/** Where the journey that began a trip set out from. */
async function cameFrom(exec: Executor, tripId: string): Promise<string | null> {
  const c = schema.commitments
  const [row] = await exec
    .select({ from: sql<string | null>`${c.booking}->>'fromCity'` })
    .from(c)
    .where(and(eq(c.tripId, tripId), sql`${c.booking}->>'fromCity' is not null`))
    .orderBy(c.dueAt)
    .limit(1)
  return row?.from ?? null
}

/**
 * Whether a journey is the way home from a trip: to the home city, or back
 * to where the trip being left began. The preview asks before offering a
 * trip; this is what says not to offer one.
 */
export async function isWayHome(userId: string, b: { city: string | null; fromCity: string | null; startsAt: Date }): Promise<boolean> {
  if (!b.city) return false
  const [user] = await db.select({ home: schema.users.homeCity }).from(schema.users).where(eq(schema.users.id, userId))
  if (sameCity(b.city, user?.home)) return true
  if (!b.fromCity) return false
  const leaving = await tripBeingLeft(db, userId, b.fromCity, ymd(b.startsAt))
  return leaving !== null && sameCity(b.city, await cameFrom(db, leaving.id))
}

async function start(exec: Executor, orgId: string, userId: string, city: string, from: string, to: string): Promise<TripFound> {
  const [row] = await exec
    .insert(schema.trips)
    .values({ orgId, userId, placeLabel: city, startsOn: from, endsOn: to })
    .returning({ id: schema.trips.id })
  return { tripId: row!.id, placeLabel: city, created: true }
}

/** Wishes saved for a place and still waiting: what a new trip there should mention. */
export async function wishesFor(userId: string, city: string): Promise<string[]> {
  const i = schema.intentions
  const rows = await db
    .select({ title: i.title, placeLabel: i.placeLabel })
    .from(i)
    .where(and(eq(i.userId, userId), eq(i.status, 'saved'), sql`${i.placeLabel} is not null`))
  return rows.filter((r) => sameCity(r.placeLabel, city)).map((r) => r.title)
}
