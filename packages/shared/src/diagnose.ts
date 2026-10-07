import { parseWhen } from './parseWhen.ts'
import { parseIntention, parseTrip } from './parseIntent.ts'
import {
  MONTH_NAMES,
  WEEKDAY_NAMES,
  cleanTitle,
  extractPlace,
  findMalformedTime,
} from './textCleanup.ts'

/**
 * Why a sentence did not become a plan.
 *
 * Silence is the worst possible answer. When someone types a real sentence and
 * the box does nothing, they conclude the app is broken — even when the input
 * genuinely was not schedulable. Saying *which part* was missing turns a dead
 * end into two taps.
 *
 * This runs only after every parser has declined, so it never competes with
 * them; it just explains the failure.
 */

export interface Diagnosis {
  /** A month was named but no day with it — "of November". */
  monthWithoutDay?: string
  /** Something shaped like a time that is not one — "22330 p.m". */
  unparseableTime?: string
  /** A day-of-week was named but nothing else usable. */
  weekdayWithoutTime?: string
  /** Best guess at what the thing actually is. */
  likelyTitle?: string
  /** Best guess at where, from "at ...". */
  likelyPlace?: string
  /** One sentence for the user, written in their terms. */
  message: string
}

export function diagnose(input: string): Diagnosis | null {
  const text = input.trim()
  if (text.length < 8) return null

  // Only explain failures — never second-guess a parser that succeeded.
  if (parseWhen(text) || parseIntention(text) || parseTrip(text)) return null

  const month = new RegExp(`\\b(${MONTH_NAMES})\\b`, 'i').exec(text)
  const weekday = new RegExp(`\\b(${WEEKDAY_NAMES})\\b`, 'i').exec(text)

  // Digits next to an am/pm that the time parser refused: "22330 p.m".
  const malformed = findMalformedTime(text)

  const place = extractPlace(text)
  const title = cleanTitle(text, { place })

  const missing: string[] = []
  if (month) missing.push(`which day of ${month[1]}`)
  else if (weekday) missing.push('a date')
  if (malformed) missing.push(`a time — "${malformed}" is not one I recognise`)

  if (missing.length === 0 && !title) return null

  const message =
    missing.length > 0
      ? `Almost — I still need ${missing.join(', and ')}.`
      : 'I could not find a date or time in that.'

  return {
    ...(month ? { monthWithoutDay: month[1] } : {}),
    ...(malformed ? { unparseableTime: malformed } : {}),
    ...(weekday && !month ? { weekdayWithoutTime: weekday[1] } : {}),
    ...(title ? { likelyTitle: title } : {}),
    ...(place ? { likelyPlace: place } : {}),
    message,
  }
}
