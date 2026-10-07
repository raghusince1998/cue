/**
 * "every Tuesday", "1st of every month", "every other Friday until December".
 *
 * Same contract as parseWhen: deterministic, no AI, and it returns the exact
 * substrings it consumed so the caller can cut them out of the title. A rule it
 * is not sure about is a rule it does not return — a wrong repeat is far worse
 * than none, because it quietly fills your calendar with the wrong thing.
 */

import { WEEKDAYS, MONTHS, parseWhen } from './parseWhen.ts'
import type { RecurrenceRule } from './recurrence.ts'

export interface ParsedRecurrence {
  rule: RecurrenceRule
  /** Every substring consumed, for removal from the title. */
  matches: string[]
}

const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|')

/**
 * What separates one day from the next in a run.
 *
 * Either a joining word, which may be written tight — "tuesday/thursday" — or
 * nothing but a space, which is how "mon wed fri" gets typed. Both forms are
 * common enough that supporting only one leaves a parser that looks broken.
 */
const DAY_SEP = String.raw`(?:\s*(?:,|and|&|\/|\+)\s*|\s+)`
const MO = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')

/** "other", "2nd", "second", "3" — whatever sits between "every" and the unit. */
const EVERY = String.raw`every\s+(?:(other|alternate|second|2nd)\s+|(\d+)(?:st|nd|rd|th)?\s+)?`

/** first/second/third/fourth/last, for "the second Tuesday of the month". */
const SET_POS: Record<string, number> = {
  first: 1, '1st': 1,
  second: 2, '2nd': 2,
  third: 3, '3rd': 3,
  fourth: 4, '4th': 4,
  last: -1,
}

const WORD_NUMBERS: Record<string, number> = {
  second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, twelve: 12,
}

function intervalFrom(other: string | undefined, digits: string | undefined): number {
  if (other) return 2
  if (digits) return Math.max(1, parseInt(digits, 10))
  return 1
}

/** All the weekday names in a run like "Mon, Wed and Fri". */
function weekdaysIn(text: string): number[] {
  const found: number[] = []
  for (const m of text.matchAll(new RegExp(String.raw`\b(${WD})s?\b`, 'gi'))) {
    const day = WEEKDAYS[m[1]!.toLowerCase()]
    if (day !== undefined) found.push(day)
  }
  return [...new Set(found)].sort()
}

interface Core {
  rule: RecurrenceRule
  matched: string
}

function matchCore(input: string): Core | null {
  // Ordered most specific first: "every 2 weeks on Tuesday" must not be eaten
  // by the plain "every 2 weeks" branch before the weekday is seen.

  // "the second Tuesday of every month", "last Friday of the month".
  //
  // Must come before the weekly branch, which would otherwise read "every
  // second Tuesday" as fortnightly — a rule that looks right for one month and
  // then drifts permanently off the real date.
  const nthWeekday = new RegExp(
    String.raw`\b(?:on\s+|every\s+)?(?:the\s+)?(first|1st|second|2nd|third|3rd|fourth|4th|last)\s+(${WD})\s+of\s+(?:every|each|the)\s+month\b`,
    'i',
  ).exec(input)
  if (nthWeekday) {
    const pos = SET_POS[nthWeekday[1]!.toLowerCase()]
    const day = WEEKDAYS[nthWeekday[2]!.toLowerCase()]
    if (pos !== undefined && day !== undefined) {
      return {
        rule: { freq: 'monthly', interval: 1, byWeekday: [day], setPos: pos },
        matched: nthWeekday[0],
      }
    }
  }

  // "the last day of every month" — stored as day 31, which clamps back to the
  // real month end wherever the month is shorter.
  const lastDay =
    /\b(?:on\s+)?(?:the\s+)?last\s+day\s+of\s+(?:every|each|the)\s+month\b/i.exec(input)
  if (lastDay) {
    return { rule: { freq: 'monthly', interval: 1, byMonthDay: 31 }, matched: lastDay[0] }
  }

  // "every morning", "every evening" — daily, with the part of day left in the
  // text for parseWhen to turn into a preferred window.
  const dayPart = /\bevery\s+(?:morning|afternoon|evening|night)\b/i.exec(input)
  if (dayPart) {
    // Only the word "every" is consumed: "morning" still has work to do.
    return { rule: { freq: 'daily', interval: 1 }, matched: dayPart[0].replace(/\s*\S+$/, '') }
  }

  // "every other Tuesday", "every Mon, Wed and Fri", "every 2 weeks on Tuesday"
  const weekly = new RegExp(
    // The separator may be nothing at all: "every mon wed fri" is how a run of
    // days gets written at least as often as "mon, wed and fri". Safe to allow,
    // because each alternative still has to be a weekday name.
    String.raw`\b${EVERY}(?:weeks?\s+on\s+)?((?:${WD})s?(?:${DAY_SEP}(?:${WD})s?)*)\b`,
    'i',
  ).exec(input)
  if (weekly) {
    const byWeekday = weekdaysIn(weekly[3]!)
    if (byWeekday.length) {
      return {
        rule: { freq: 'weekly', interval: intervalFrom(weekly[1], weekly[2]), byWeekday },
        matched: weekly[0],
      }
    }
  }

  // "on Tuesdays", "Tuesdays and Thursdays" — the plural alone implies repeat.
  const plural = new RegExp(
    String.raw`\b(?:on\s+|each\s+)?((?:${WD})s(?:${DAY_SEP}(?:${WD})s)*)\b`,
    'i',
  ).exec(input)
  if (plural) {
    const byWeekday = weekdaysIn(plural[1]!)
    if (byWeekday.length) {
      return { rule: { freq: 'weekly', interval: 1, byWeekday }, matched: plural[0] }
    }
  }

  // "every weekday", "on weekdays", "every working day"
  const weekdayRun = /\b(?:every\s+|on\s+|each\s+)?(?:week\s?days?|working\s+days?)\b/i.exec(input)
  if (weekdayRun) {
    return {
      rule: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
      matched: weekdayRun[0],
    }
  }

  // "every day", "daily", "every 3 days"
  const daily = new RegExp(String.raw`\b(?:${EVERY}days?|daily|each\s+day)\b`, 'i').exec(input)
  if (daily) {
    return { rule: { freq: 'daily', interval: intervalFrom(daily[1], daily[2]) }, matched: daily[0] }
  }

  // "1st of every month", "on the 15th of each month"
  const dayOfMonth =
    /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)?\s+of\s+(?:every|each)\s+month\b|\b(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each)\s+month\b/i.exec(
      input,
    )
  if (dayOfMonth) {
    const day = parseInt(dayOfMonth[1] ?? dayOfMonth[2]!, 10)
    if (day >= 1 && day <= 31) {
      return { rule: { freq: 'monthly', interval: 1, byMonthDay: day }, matched: dayOfMonth[0] }
    }
  }

  // "every month on the 5th"
  const monthlyOn =
    new RegExp(String.raw`\b${EVERY}months?\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i').exec(input)
  if (monthlyOn) {
    const day = parseInt(monthlyOn[3]!, 10)
    if (day >= 1 && day <= 31) {
      return {
        rule: {
          freq: 'monthly',
          interval: intervalFrom(monthlyOn[1], monthlyOn[2]),
          byMonthDay: day,
        },
        matched: monthlyOn[0],
      }
    }
  }

  // "every year on 3 March", "annually on March 3"
  const yearlyOn = new RegExp(
    String.raw`\b(?:${EVERY}years?|yearly|annually)\s+on\s+(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MO})|(${MO})\s+(\d{1,2})(?:st|nd|rd|th)?)\b`,
    'i',
  ).exec(input)
  if (yearlyOn) {
    const day = parseInt(yearlyOn[3] ?? yearlyOn[6]!, 10)
    const month = MONTHS[(yearlyOn[4] ?? yearlyOn[5])!.toLowerCase()]
    if (day >= 1 && day <= 31 && month !== undefined) {
      return {
        rule: {
          freq: 'yearly',
          interval: intervalFrom(yearlyOn[1], yearlyOn[2]),
          byMonth: month,
          byMonthDay: day,
        },
        matched: yearlyOn[0],
      }
    }
  }

  // Bare units, last: "every week", "fortnightly", "quarterly", "every year".
  const fortnight = /\b(?:fortnightly|bi-?weekly)\b/i.exec(input)
  if (fortnight) return { rule: { freq: 'weekly', interval: 2 }, matched: fortnight[0] }

  const quarterly = /\bquarterly\b/i.exec(input)
  if (quarterly) return { rule: { freq: 'monthly', interval: 3 }, matched: quarterly[0] }

  const week = new RegExp(String.raw`\b(?:${EVERY}weeks?|weekly)\b`, 'i').exec(input)
  if (week) {
    return { rule: { freq: 'weekly', interval: intervalFrom(week[1], week[2]) }, matched: week[0] }
  }

  const month = new RegExp(String.raw`\b(?:${EVERY}months?|monthly)\b`, 'i').exec(input)
  if (month) {
    return { rule: { freq: 'monthly', interval: intervalFrom(month[1], month[2]) }, matched: month[0] }
  }

  const year = new RegExp(String.raw`\b(?:${EVERY}years?|yearly|annually)\b`, 'i').exec(input)
  if (year) {
    return { rule: { freq: 'yearly', interval: intervalFrom(year[1], year[2]) }, matched: year[0] }
  }

  return null
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 }

/** "until December", "for 10 weeks", "5 times" — where the series stops. */
function matchEnd(
  input: string,
  now: Date,
): { end: Pick<RecurrenceRule, 'until' | 'count'>; matched: string } | null {
  const times = /\b(?:for\s+)?(\d+)\s+(?:times|occurrences)\b/i.exec(input)
  if (times) return { end: { count: parseInt(times[1]!, 10) }, matched: times[0] }

  const span = /\bfor\s+(?:the\s+next\s+)?(\d+|\w+)\s+(day|week|month|year)s?\b/i.exec(input)
  if (span) {
    const raw = span[1]!.toLowerCase()
    const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : WORD_NUMBERS[raw]
    if (n) {
      const until = new Date(now.getTime())
      until.setDate(until.getDate() + n * UNIT_DAYS[span[2]!.toLowerCase()]!)
      return { end: { until: ymd(until) }, matched: span[0] }
    }
  }

  const until = /\b(?:until|till|upto|up\s+to|through)\s+(.{3,40}?)\s*$/i.exec(input)
  if (until) {
    const when = parseWhen(until[1]!, now)
    if (when) return { end: { until: ymd(when.date) }, matched: until[0] }
  }

  return null
}

export function parseRecurrence(input: string, now: Date = new Date()): ParsedRecurrence | null {
  const core = matchCore(input)
  if (!core) return null

  const matches = [core.matched]
  const rule = { ...core.rule }

  // The terminator is looked for in what is left, so "every 2 weeks" cannot
  // also be read as the "2" in a count.
  const rest = input.replace(core.matched, ' ')
  const end = matchEnd(rest, now)
  if (end) {
    Object.assign(rule, end.end)
    matches.push(end.matched)
  }

  return { rule, matches }
}

/**
 * The title with the recurrence phrase removed.
 *
 * Mirrors titleFrom in parseWhen — the two run in sequence on the same
 * sentence, each cutting out what it understood.
 */
export function stripRecurrence(input: string, parsed: ParsedRecurrence): string {
  let text = input
  for (const m of parsed.matches) text = text.replace(m, ' ')
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*(?:\b(?:and|on|at|the|a|an|,)\b\s*)+/i, '')
    .replace(/(?:\s*\b(?:and|on|at|the|a|an)\b)+\s*$/i, '')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim()
}
