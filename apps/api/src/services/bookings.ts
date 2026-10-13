import { and, eq, ne, sql } from 'drizzle-orm'
import { type ParsedBooking } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'
import { tripForBooking, wishesFor } from './tripAssembly.ts'

/**
 * Bookings as plans: a train, a flight, a hotel, a show. Reminded ahead of
 * time rather than at it — a reminder as the train leaves is no use — and
 * never chased once passed.
 */

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
async function known(userId: string, b: ParsedBooking) {
  const c = schema.commitments
  const [row] = await db
    .select({ id: c.id, title: c.title, notes: c.notes, booking: c.booking, dueAt: c.dueAt, tripId: c.tripId, status: c.status, placeLabel: c.placeLabel, orgId: c.orgId })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        ne(c.status, 'deleted'),
        b.ref
          ? b.type === 'flight'
            ? // A round trip's two flights share one PNR: the same flight is the
              // same PNR and the same flight number ("Flight SG 401…"), or the
              // same PNR within hours, for one saved before its number was read.
              sql`${c.booking}->>'ref' = ${b.ref} and (${c.title} like ${`${b.title.split(' · ')[0]}%`} or abs(extract(epoch from (${c.dueAt} - ${b.startsAt.toISOString()}::timestamptz))) < ${6 * 3_600})`
            : sql`${c.booking}->>'ref' = ${b.ref}`
          : and(eq(c.title, b.title), eq(c.dueAt, b.startsAt)),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * A booking saved before, read again by a better reader: put right in place.
 * "Train" becomes "Train 12951 Mumbai Rajdhani · Mumbai Central → New
 * Delhi", the notes gain seats and arrival, and it joins its trip. Its time
 * moves only when it was one of those read badly (no route in its title) —
 * a time the person set themselves is never overwritten. Null when there was
 * nothing to improve, or it is already done with.
 */
async function improve(
  existing: NonNullable<Awaited<ReturnType<typeof known>>>,
  orgId: string,
  userId: string,
  b: ParsedBooking,
  city: string | null,
  now: Date,
): Promise<{ id: string; title: string } | null> {
  if (existing.status !== 'pending') return null
  const readBadly = !existing.title.includes('→')
  const title = readBadly && b.title.includes('→') ? b.title : existing.title
  const notes = b.notes && (!existing.notes || b.notes.length > existing.notes.length) ? b.notes : existing.notes
  const old = existing.booking
  const booking = {
    type: b.type,
    ref: b.ref ?? old?.ref ?? null,
    from: b.from ?? old?.from ?? null,
    city: city ?? old?.city ?? null,
    provider: b.provider ?? old?.provider ?? null,
    remindBeforeMinutes: b.remindBeforeMinutes,
    fromCity: b.fromCity ?? old?.fromCity ?? null,
    endsOn: b.endsOn ?? old?.endsOn ?? null,
  }
  const moveTo = readBadly && b.timeKnown && b.startsAt.getTime() !== existing.dueAt.getTime() && b.startsAt > now ? b.startsAt : null
  const sameBooking = (Object.keys(booking) as (keyof typeof booking)[]).every((k) => booking[k] === (old?.[k] ?? null))
  // Another email about the same booking with nothing new in it is not news.
  if (title === existing.title && notes === existing.notes && !moveTo && sameBooking) return null

  await db.transaction(async (tx) => {
    // One read badly never found its trip: it can now.
    const trip =
      existing.tripId || !readBadly
        ? null
        : await tripForBooking(orgId, userId, { type: b.type, startsAt: moveTo ?? existing.dueAt, endsOn: b.endsOn, city, fromCity: b.fromCity ?? null }, tx)
    await tx
      .update(schema.commitments)
      .set({
        title,
        notes,
        booking,
        placeLabel: existing.placeLabel ?? b.from,
        ...(trip ? { tripId: trip.tripId } : {}),
        ...(moveTo ? { dueAt: moveTo, escalationCount: 0 } : {}),
      })
      .where(eq(schema.commitments.id, existing.id))
    if (moveTo) {
      // Reminders for the wrong time go; the right ones come.
      await cancelPendingReminders(existing.id, tx)
      for (const at of bookingReminderTimes(moveTo, b.type, b.remindBeforeMinutes, now)) {
        await scheduleFirstReminder({ orgId, commitmentId: existing.id, fireAt: at }, tx)
      }
    }
  })
  return { id: existing.id, title }
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
  const existing = await known(userId, b)
  if (existing) return improve(existing, orgId, userId, b, city, now)

  const saved = await db.transaction(async (tx) => {
    // The trip it is part of: the way out, the stay and the way home, as one.
    const trip = await tripForBooking(
      orgId,
      userId,
      { type: b.type, startsAt: b.startsAt, endsOn: b.endsOn, city, fromCity: b.fromCity ?? null },
      tx,
    )
    const tripId = trip?.tripId ?? null

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
          fromCity: b.fromCity ?? null,
          endsOn: b.endsOn,
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
    return { id: row!.id, title: b.title, trip }
  })

  // A trip started from an email is the moment saved wishes for there matter:
  // the person never saw it being made, so they are told once.
  if (saved.trip?.created) {
    const wishes = await wishesFor(userId, saved.trip.placeLabel)
    if (wishes.length > 0) {
      await sendToUser(userId, {
        title: `Trip to ${saved.trip.placeLabel}`,
        body: `Found in your email: ${b.title}. You saved ${wishes.length === 1 ? 'something' : `${wishes.length} things`} for ${saved.trip.placeLabel}: ${wishes.slice(0, 3).join(', ')}${wishes.length > 3 ? '…' : ''}.`,
        tag: `trip-${saved.trip.tripId}`,
        url: '/trips',
      }).catch(() => 0)
    }
  }
  return { id: saved.id, title: saved.title }
}
