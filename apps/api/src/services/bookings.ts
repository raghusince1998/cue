import { and, eq, gte, lte, ne, sql } from 'drizzle-orm'
import { samePlace, type ParsedBooking } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * Bookings as plans: a train, a flight, a hotel, a show. Reminded ahead of
 * time rather than at it — a reminder as the train leaves is no use — and
 * never chased once passed.
 */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * When a booking's reminders go: its lead time before (or the nearest still
 * to come), and the evening before an early start.
 */
export function bookingReminderTimes(dueAt: Date, type: string, leadMinutes: number, now = new Date()): Date[] {
  const t = now.getTime()
  const lead = dueAt.getTime() - leadMinutes * 60_000
  const first = [lead, dueAt.getTime() - 30 * 60_000, dueAt.getTime()].find((x) => x > t) ?? dueAt.getTime()
  const out = [new Date(first)]
  if (['train', 'flight', 'bus'].includes(type) && dueAt.getHours() < 11) {
    const eve = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate() - 1, 20, 0)
    if (eve.getTime() > t && eve.getTime() < first) out.unshift(eve)
  }
  return out
}

/** Web check-in opens about two days before a flight. */
export function webCheckInAt(dueAt: Date, now = new Date()): Date | null {
  const opens = new Date(dueAt.getTime() - 48 * 3_600_000)
  return opens.getTime() > now.getTime() + 30 * 60_000 ? opens : null
}

/** Whether this booking is already a plan: the same reference, or the same thing at the same time. */
async function known(userId: string, b: ParsedBooking): Promise<boolean> {
  const c = schema.commitments
  const [row] = await db
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        ne(c.status, 'deleted'),
        b.ref ? sql`${c.booking}->>'ref' = ${b.ref}` : and(eq(c.title, b.title), eq(c.dueAt, b.startsAt)),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * A booking found in email, made a plan without being asked: on the trip to
 * where it goes (started if there is none), with its reminders, and for a
 * flight a web check-in. Null when it is already a plan.
 */
export async function saveFoundBooking(
  orgId: string,
  userId: string,
  b: ParsedBooking,
  city: string | null,
  now = new Date(),
): Promise<{ id: string; title: string } | null> {
  if (b.startsAt.getTime() < now.getTime()) return null
  if (await known(userId, b)) return null

  const [user] = await db.select({ home: schema.users.homeCity }).from(schema.users).where(eq(schema.users.id, userId))
  const day = ymd(b.startsAt)

  return db.transaction(async (tx) => {
    let tripId: string | null = null
    if (city && !samePlace(city, user?.home)) {
      const t = schema.trips
      const [trip] = await tx
        .select({ id: t.id })
        .from(t)
        .where(and(eq(t.userId, userId), sql`lower(btrim(${t.placeLabel})) = lower(${city})`, lte(t.startsOn, day), gte(t.endsOn, day)))
        .limit(1)
      tripId =
        trip?.id ??
        (
          await tx
            .insert(t)
            .values({ orgId, userId, placeLabel: city, startsOn: day, endsOn: b.endsOn && b.endsOn > day ? b.endsOn : day })
            .returning({ id: t.id })
        )[0]!.id
    }

    const [row] = await tx
      .insert(schema.commitments)
      .values({
        orgId,
        userId,
        title: b.title,
        kind: 'task',
        dueAt: b.startsAt,
        durationMinutes: b.durationMinutes,
        notes: b.notes,
        placeLabel: b.from,
        tripId,
        flexibility: 'fixed',
        booking: {
          type: b.type,
          ref: b.ref,
          from: b.from,
          city,
          provider: b.provider,
          remindBeforeMinutes: b.remindBeforeMinutes,
        },
      })
      .returning({ id: schema.commitments.id })
    for (const at of bookingReminderTimes(b.startsAt, b.type, b.remindBeforeMinutes, now)) {
      await scheduleFirstReminder({ orgId, commitmentId: row!.id, fireAt: at }, tx)
    }

    const opens = b.type === 'flight' ? webCheckInAt(b.startsAt, now) : null
    if (opens) {
      const [checkIn] = await tx
        .insert(schema.commitments)
        .values({
          orgId,
          userId,
          title: `Web check-in: ${b.title}`,
          kind: 'task',
          dueAt: opens,
          durationMinutes: 15,
          notes: b.notes,
          tripId,
          flexibility: 'flexible',
        })
        .returning({ id: schema.commitments.id })
      await scheduleFirstReminder({ orgId, commitmentId: checkIn!.id, fireAt: opens }, tx)
    }
    return { id: row!.id, title: b.title }
  })
}
