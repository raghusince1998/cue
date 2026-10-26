import { isNull, notInArray, sql } from 'drizzle-orm'
import { HAPPENING_KINDS } from '@cue/shared'
import * as schema from '../db/schema.ts'

/** Kinds that are time, not a promise: never overdue, never a job left undone. */
export const NOT_OWED = ['focus', ...HAPPENING_KINDS]

/**
 * When a mirrored calendar became Cue's business: the moment it was connected.
 *
 * Coalesced to the beginning of time so that an event whose calendar row is
 * somehow missing is judged like anything else, rather than vanishing from
 * every list because a comparison with NULL is never true.
 */
function connectedAt() {
  const c = schema.commitments
  return sql`coalesce(
    (select f.created_at from calendar_feeds f where f.id = ${c.feedId}),
    '-infinity'::timestamptz
  )`
}

/**
 * Calendar history: mirrored from Google or Microsoft, and dated before Cue
 * started reading that calendar.
 *
 * Connecting a calendar brings in its past — a year of it by default. Cue was
 * not there for any of it, so it cannot say whether those meetings happened,
 * were skipped, or moved. They are neither done nor overdue: they have no
 * status, and the app does not pretend otherwise.
 */
export function isCalendarHistory() {
  const c = schema.commitments
  return sql<boolean>`(${c.feedId} is not null and ${c.dueAt} < ${connectedAt()})`
}

/**
 * Something Cue is managing at all: everything added here, and from a connected
 * calendar only what is dated after connecting and is not an all-day entry.
 */
export function managedByCue() {
  const c = schema.commitments
  return sql`(${c.feedId} is null or (not ${c.allDay} and ${c.dueAt} >= ${connectedAt()}))`
}

/**
 * Whether it occupies time on the calendar.
 *
 * Not a "waiting on someone" item: that is a date to check in, and letting it
 * claim a slot would make "check with Ravi at 10" clash with the 10 o'clock
 * meeting and eat into the day's free time. Every query that works out busy
 * time uses this.
 */
export function takesTime() {
  return isNull(schema.commitments.waitingOn)
}

/** When a meeting ends: its own end if it has one, else its start plus its length. */
export function meetingEnd() {
  const c = schema.commitments
  return sql`coalesce(${c.endsAt}, ${c.dueAt} + ${c.durationMinutes} * interval '1 minute')`
}

/** How long a finished meeting waits to be wrapped up before it counts as dropped. */
export const WRAP_UP_DAYS = 7

/**
 * A meeting that is under way, or ended within the last week.
 *
 * It is not dropped: it is waiting to be wrapped up — "any follow-ups?" — on
 * Today's "Just finished" list. Only after a week untouched does it join the
 * overdue list like anything else.
 */
export function isAwaitingWrapUp(now: Date) {
  const c = schema.commitments
  const since = new Date(now.getTime() - WRAP_UP_DAYS * 86_400_000)
  // As a string, cast: a Date inside a raw fragment reaches the driver
  // unconverted and it refuses it — typed comparisons like lt() convert, sql`` does not.
  return sql`(${c.kind} = 'meeting' and not ${c.allDay} and ${meetingEnd()} > ${since.toISOString()}::timestamptz)`
}

/**
 * What can be overdue.
 *
 * Everything you added yourself, and anything from a connected calendar dated
 * after you connected it — from then on Cue is managing it like the rest. Not
 * calendar history (above), and never an all-day calendar entry: a public
 * holiday is context for a day, not something you do.
 *
 * Every query that decides what is overdue, stuck, or slipping uses this, so
 * the Today list, the counts, the insights, the triage panel and the evening
 * nudge cannot disagree. (The nudge's raw SQL spells out the same rule.)
 */
export function canBeOverdue(now: Date) {
  // Nor something you are waiting on from someone else: it has its own list,
  // where a check-in that is due says so.
  // Nor a focus block: when it is over, it is over — it was time set aside,
  // not something promised. Nor an event or a festival: once the day has
  // passed, it has passed.
  const c = schema.commitments
  // Nor a booking: once the train has left, it has left.
  return sql`(${managedByCue()} and not ${isAwaitingWrapUp(now)} and ${c.waitingOn} is null and ${notInArray(c.kind, NOT_OWED)} and ${c.booking} is null)`
}
