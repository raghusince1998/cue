import { isNull } from 'drizzle-orm'
import * as schema from '../db/schema.ts'

/**
 * What can be overdue: something the user set out to do.
 *
 * An event mirrored from Google or Microsoft is a copy of someone's calendar,
 * not a promise made here. Once its time has passed it is simply over.
 * Counting it as "dropped" turned a year of connected history into 65 overdue
 * items on the first sync — last year's Diwali, 353 days late — and buried the
 * handful of things that really were.
 *
 * Every query that decides what is overdue, stuck, or slipping uses this, so
 * the Today list, the counts, the insights, the triage panel and the evening
 * nudge cannot disagree.
 */
export function canBeOverdue() {
  return isNull(schema.commitments.feedId)
}
