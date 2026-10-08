import { sql } from 'drizzle-orm'
import * as schema from '../db/schema.ts'

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
export function canBeOverdue() {
  const c = schema.commitments
  return sql`(${c.feedId} is null or (not ${c.allDay} and ${c.dueAt} >= ${connectedAt()}))`
}
