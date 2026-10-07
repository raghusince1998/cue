/**
 * Repeating plans: the rule, and the dates it produces.
 *
 * Deliberately pure and dependency-free. Everything downstream — the database,
 * the reminder worker, conflict detection — deals in ordinary commitments that
 * this expansion produced, so none of them need to know recurrence exists.
 */

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const
export type Frequency = (typeof FREQUENCIES)[number]

export interface RecurrenceRule {
  freq: Frequency
  /** Every N days/weeks/months/years. 1 unless "every other" or "every 3". */
  interval: number
  /** 0=Sunday .. 6=Saturday. Weekly only; empty means "same weekday as the start". */
  byWeekday?: number[]
  /** 1-31. Monthly and yearly. Defaults to the start date's day. */
  byMonthDay?: number | null
  /**
   * "the second Tuesday of the month": 1-4 for first..fourth, -1 for last.
   * Monthly only, and only meaningful with exactly one entry in byWeekday.
   * Without it, "every second Tuesday" would be read as a fortnightly rule,
   * which drifts away from the real date within two months.
   */
  setPos?: number | null
  /** 0=January .. 11=December. Yearly only. Defaults to the start date's month. */
  byMonth?: number | null
  /** Inclusive last date, as YYYY-MM-DD. Null means it runs forever. */
  until?: string | null
  /** Total number of occurrences. Null means unbounded. */
  count?: number | null
  /**
   * Dates the series skips, as YYYY-MM-DD. Imported calendars use these for
   * "delete just this one", and without them a cancelled instance would come
   * back every time the feed is re-read.
   */
  exdates?: string[] | null
}

export interface RecurrenceAnchor {
  /** First occurrence. Also the phase for "every other week". */
  startsOn: Date
  hour: number
  minute: number
}

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
}

const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** 1st, 2nd, 3rd, 4th … 21st, 22nd, 23rd, 31st. */
export function ordinal(n: number): string {
  // 11th, 12th and 13th break the last-digit rule and have to be special-cased.
  const teen = n % 100
  if (teen >= 11 && teen <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** Refuses to run away if a caller asks for a decade of a daily rule. */
const HARD_LIMIT = 1000

const DAY_MS = 86_400_000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Whole days between two dates, ignoring any clock time on either. */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/**
 * Builds a local date, pulling the day back to the end of the month when that
 * month is too short.
 *
 * This is a deliberate divergence from RFC 5545, which skips such months
 * entirely. For a personal planner that is the wrong answer: "rent on the 31st"
 * must still fire in February, and a month with no reminder at all is a worse
 * failure than one that lands on the 28th.
 */
function clampedDate(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(year, month, Math.min(day, daysInMonth(year, month)), hour, minute)
}

/**
 * "The 2nd Tuesday of March 2026", or with pos = -1, the last one.
 *
 * A month with only four Tuesdays asked for a fifth gets the fourth: the same
 * reasoning as clamping a 31st — landing near the intent beats not firing.
 */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  pos: number,
  hour: number,
  minute: number,
): Date {
  // Normalise, because month may be out of range after adding an interval.
  const first = new Date(year, month, 1)
  const y = first.getFullYear()
  const m = first.getMonth()

  if (pos < 0) {
    const last = new Date(y, m, daysInMonth(y, m))
    const back = (last.getDay() - weekday + 7) % 7
    return new Date(y, m, last.getDate() - back, hour, minute)
  }

  const forward = (weekday - first.getDay() + 7) % 7
  const day = 1 + forward + (pos - 1) * 7
  const overflow = day > daysInMonth(y, m)
  return new Date(y, m, overflow ? day - 7 : day, hour, minute)
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Every occurrence of `rule` that falls inside [from, to].
 *
 * Counting is done from the anchor, not from `from`, so a windowed call still
 * honours `count` correctly — asking for next month's occurrences of a rule
 * capped at 5 will not hand back a sixth.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  anchor: RecurrenceAnchor,
  window: { from: Date; to: Date },
): Date[] {
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  const { hour, minute } = anchor
  const start = startOfDay(anchor.startsOn)

  // An `until` date is inclusive of the whole day, not of midnight on it.
  const untilMs = rule.until
    ? new Date(`${rule.until}T00:00:00`).getTime() + DAY_MS - 1
    : Number.POSITIVE_INFINITY
  const ceiling = Math.min(window.to.getTime(), untilMs)

  const out: Date[] = []
  let emitted = 0

  const excluded = rule.exdates?.length ? new Set(rule.exdates) : null

  const consider = (candidate: Date): boolean => {
    if (candidate.getTime() > ceiling) return false
    if (candidate < start) return true
    if (rule.count != null && emitted >= rule.count) return false
    emitted += 1
    // An excluded date still counts towards COUNT — it is an occurrence that
    // was cancelled, not one that never existed. That is what RFC 5545 means
    // and what the source calendar will have shown.
    if (excluded?.has(ymd(candidate))) return true
    if (candidate.getTime() >= window.from.getTime()) out.push(candidate)
    return true
  }

  if (rule.freq === 'daily') {
    for (let i = 0; i < HARD_LIMIT; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * interval)
      if (!consider(new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, minute))) break
    }
    return out
  }

  if (rule.freq === 'weekly') {
    const weekdays = rule.byWeekday?.length ? [...new Set(rule.byWeekday)].sort() : [start.getDay()]

    // Phase from the Sunday of the anchor's week, so "every other Tuesday"
    // stays on the same fortnight even when the rule also names a Monday.
    const week0 = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() - start.getDay(),
    )

    outer: for (let w = 0; w < HARD_LIMIT; w += 1) {
      const weekStart = new Date(
        week0.getFullYear(),
        week0.getMonth(),
        week0.getDate() + w * interval * 7,
      )
      // Nothing in this week can be in range and every later week is further
      // out, so stop rather than walking to the hard limit.
      if (weekStart.getTime() > ceiling) break

      for (const wd of weekdays) {
        const d = new Date(
          weekStart.getFullYear(),
          weekStart.getMonth(),
          weekStart.getDate() + wd,
          hour,
          minute,
        )
        if (!consider(d)) break outer
      }
    }
    return out
  }

  if (rule.freq === 'monthly') {
    const weekday = rule.byWeekday?.length === 1 ? rule.byWeekday[0]! : null
    if (rule.setPos != null && weekday != null) {
      for (let i = 0; i < HARD_LIMIT; i += 1) {
        const d = nthWeekdayOfMonth(
          start.getFullYear(),
          start.getMonth() + i * interval,
          weekday,
          rule.setPos,
          hour,
          minute,
        )
        if (!consider(d)) break
      }
      return out
    }

    const day = rule.byMonthDay ?? start.getDate()
    for (let i = 0; i < HARD_LIMIT; i += 1) {
      const d = clampedDate(start.getFullYear(), start.getMonth() + i * interval, day, hour, minute)
      if (!consider(d)) break
    }
    return out
  }

  const month = rule.byMonth ?? start.getMonth()
  const day = rule.byMonthDay ?? start.getDate()
  for (let i = 0; i < HARD_LIMIT; i += 1) {
    const d = clampedDate(start.getFullYear() + i * interval, month, day, hour, minute)
    if (!consider(d)) break
  }
  return out
}

/** The first occurrence strictly after `after`, or null once a series ends. */
export function nextOccurrence(
  rule: RecurrenceRule,
  anchor: RecurrenceAnchor,
  after: Date,
): Date | null {
  // Two years is enough for anything a person actually schedules, including a
  // yearly rule that has just passed this year's date.
  const horizon = new Date(after.getTime() + 366 * 2 * DAY_MS)
  const hits = expandRecurrence(rule, anchor, { from: new Date(after.getTime() + 1), to: horizon })
  return hits[0] ?? null
}

/** Does `date` fall on an occurrence of this rule? Used to detach edited ones. */
export function occursOn(rule: RecurrenceRule, anchor: RecurrenceAnchor, date: Date): boolean {
  const day = startOfDay(date)
  const hits = expandRecurrence(rule, anchor, {
    from: day,
    to: new Date(day.getTime() + DAY_MS - 1),
  })
  return hits.length > 0
}

function listWeekdays(days: number[]): string {
  const names = [...new Set(days)].sort().map((d) => WEEKDAY_LABELS[d]!)
  if (names.length === 1) return names[0]!
  if (names.length === 7) return 'day'
  // Mon-Fri is common enough to be worth naming rather than listing.
  if (names.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'weekday'
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/**
 * "Every other Tuesday", "Monthly on the 1st" — the rule read back in the words
 * someone would have used to type it.
 */
export function describeRecurrence(rule: RecurrenceRule, anchor?: RecurrenceAnchor): string {
  const n = Math.max(1, Math.floor(rule.interval || 1))
  const every = n === 1 ? 'Every' : n === 2 ? 'Every other' : `Every ${n}`

  let base: string
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday?.length
      ? rule.byWeekday
      : anchor
        ? [anchor.startsOn.getDay()]
        : []
    base = days.length ? `${every} ${listWeekdays(days)}` : `${every} week`
  } else if (rule.freq === 'daily') {
    base = n === 1 ? 'Every day' : n === 2 ? 'Every other day' : `${every} days`
  } else if (rule.freq === 'monthly' && rule.setPos != null && rule.byWeekday?.length === 1) {
    const which = rule.setPos < 0 ? 'last' : ordinal(rule.setPos)
    const day = WEEKDAY_LABELS[rule.byWeekday[0]!]
    base = `${every} ${n === 1 ? 'month' : 'months'}, the ${which} ${day}`
  } else {
    const day = rule.byMonthDay ?? anchor?.startsOn.getDate()
    const unit = FREQUENCY_LABELS[rule.freq]
    // Day 31 on a monthly rule is how "the last day of the month" is stored —
    // the clamping in clampedDate makes it land correctly in short months.
    const lastDay = day === 31 && rule.freq === 'monthly'
    const suffix = day ? ` on the ${lastDay ? 'last day' : ordinal(day)}` : ''
    base = `${every} ${n === 1 ? unit : `${unit}s`}${suffix}`
  }

  if (rule.count != null) return `${base}, ${rule.count} times`
  if (rule.until) {
    const d = new Date(`${rule.until}T00:00:00`)
    return `${base}, until ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
  }
  return base
}

export { ymd, daysBetween, startOfDay }
