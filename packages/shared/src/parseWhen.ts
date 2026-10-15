import { cleanTitle, extractPlace } from './textCleanup.ts'

/**
 * Turns "dentist friday 6pm" into a date and a title.
 *
 * Deliberately a plain deterministic parser, not a model: it must give the same
 * answer every time, work offline, cost nothing, and be debuggable when it gets
 * something wrong. It handles the phrasings people actually type and gives up
 * cleanly on anything else — the UI always shows the resolved date back, so a
 * wrong guess is visible before it is saved rather than after.
 */

/** Kept as a local union so this module stays dependency-free. */
export type ParsedWindow = 'morning' | 'afternoon' | 'evening' | 'night'

export interface ParsedWhen {
  date: Date
  /** The exact substring that produced the date, so it can be cut from the title. */
  matched: string
  /**
   * The date, time and duration fragments separately. Prefer these for cutting
   * a title: `matched` encloses everything between the first fragment and the
   * last, so in "tomorrow call the bank 9am" it would take the activity too.
   * Optional so a caller building a ParsedWhen by hand need not supply it.
   */
  pieces?: string[]
  /** True when no time was given and 9am was assumed. */
  timeAssumed: boolean
  /**
   * Set when the phrase named a part of the day rather than a clock time.
   * "this afternoon" is a window, not 2:00 PM — `date` carries a representative
   * hour so the item can be ordered, but a caller that respects the user should
   * schedule inside the window rather than pretending that hour was chosen.
   */
  window?: ParsedWindow
  durationMinutes?: number
  /**
   * Set when a clock reading had no am or pm and nothing in the sentence said
   * which half of the day it meant, so the usual one was picked. The caller
   * says so, because "6:30" is as often a gym session as a dinner.
   */
  halfGuessed?: 'am' | 'pm'
  /**
   * "Monday's board meeting": the day belongs to something else in the
   * sentence. It stays in the title, and a task for it is due before it.
   */
  possessive?: boolean
  /** "before 31 July", "by Friday", "before December": a date to finish by. */
  deadline?: boolean
  /** "team lunch tomorrow": the meal said when, since no clock time did. */
  meal?: string
}

export const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

export const MONTHS: Record<string, number> = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sept: 8, sep: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11,
}

/** What "morning" and friends resolve to, in 24-hour time. */
const DAY_PARTS: Record<string, number> = {
  morning: 9,
  noon: 12,
  midday: 12,
  afternoon: 14,
  evening: 18,
  tonight: 20,
  night: 20,
  midnight: 0,
}

/**
 * Only the vague ones. "noon" and "midnight" name an exact instant, so they
 * stay precise times rather than becoming windows.
 */
const WINDOW_OF_PART: Record<string, ParsedWindow> = {
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
  tonight: 'night',
}

/**
 * Multi-word phrases that mean the same thing for everybody.
 *
 * These need no knowledge of your calendar — "end of day" is five o'clock to
 * everyone — so they resolve here rather than being sent to the server to look
 * something up. Matched before the single words below, because "after lunch"
 * has no day-part word in it and "over lunch" would otherwise be missed.
 */
const CONVENTIONS: { pattern: RegExp; hour: number; minute?: number; window?: ParsedWindow }[] = [
  { pattern: /\bfirst\s+thing\b/i, hour: 9, window: 'morning' },
  { pattern: /\b(?:end\s+of\s+(?:the\s+)?day|eod|close\s+of\s+play)\b/i, hour: 17 },
  { pattern: /\bafter\s+lunch\b/i, hour: 14, window: 'afternoon' },
  { pattern: /\bbefore\s+lunch\b/i, hour: 11, window: 'morning' },
  { pattern: /\bover\s+lunch\b/i, hour: 13 },
  { pattern: /\bafter\s+work\b/i, hour: 18, window: 'evening' },
  { pattern: /\bbefore\s+work\b/i, hour: 7, window: 'morning' },
  { pattern: /\bafter\s+dinner\b/i, hour: 20, window: 'evening' },
  { pattern: /\bbefore\s+bed\b/i, hour: 21, window: 'night' },
  { pattern: /\bat\s+dawn\b|\bsunrise\b/i, hour: 6, window: 'morning' },
]

const DEFAULT_HOUR = 9

interface Match {
  start: number
  end: number
}

function span(a: Match | null, b: Match | null): Match | null {
  if (!a) return b
  if (!b) return a
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) }
}

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

/**
 * `friday` means the soonest Friday that has not gone past. `next friday`
 * means the Friday of next week (weeks start on Monday): said on a Wednesday
 * it skips this week's, and said on a Thursday "next monday" is the coming
 * Monday — not the one a week after it.
 */
function resolveWeekday(now: Date, target: number, forceNextWeek: boolean): Date {
  const result = startOfDay(now)
  let delta = (target - now.getDay() + 7) % 7
  if (forceNextWeek) {
    const toNextMonday = (8 - now.getDay()) % 7 || 7
    delta = toNextMonday + ((target + 6) % 7)
  }
  result.setDate(result.getDate() + delta)
  return result
}

// ------------------------------------------------------------------ pieces

interface TimeFound {
  hour: number
  minute: number
  match: Match
  /** Bare numbers ("friday 6") are only trusted when a date anchors them. */
  needsDateAnchor: boolean
  /** Set when the phrase was a part of the day rather than a clock reading. */
  window?: ParsedWindow
  /**
   * The number as said, when it named no half of the day: "at 9", "3:30",
   * "friday 6". Which half it means is settled by the rest of the sentence.
   */
  ambiguous?: number
}

function findTime(text: string): TimeFound | null {
  // 6pm · 6.30pm · 6:30 pm · 2:30 p.m · 2:30 p.m.
  //
  // The dots are optional in both positions. Requiring both meant "2:30 p.m"
  // fell through to the 24-hour branch and silently became 02:30 — the middle
  // of the night, with no warning.
  const meridiem = /\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?(?![a-z])/i.exec(text)
  if (meridiem) {
    let hour = Number(meridiem[1])
    const minute = Number(meridiem[2] ?? 0)
    const isPm = meridiem[3]!.toLowerCase() === 'p'
    if (hour === 12) hour = 0
    if (isPm) hour += 12
    return {
      hour,
      minute,
      match: { start: meridiem.index, end: meridiem.index + meridiem[0].length },
      needsDateAnchor: false,
    }
  }

  // "morning 7", "evening 7:30", "7 in the evening", "night at 10".
  //
  // Checked before the 24-hour clock and before the day-part default, because
  // each of those silently lost what was said. The day-part branch returned its
  // own default and never looked at the number — "tomorrow morning 7" became
  // 9am and "tomorrow night 10" became 8pm. The clock branch read "evening
  // 7:30" as half past seven in the morning. The part of the day is exactly
  // what says which half of the clock a bare number belongs to.
  //
  // This is also the natural order of Hindi — "kal subah 7 baje", "shaam 6
  // baje" — so without it those sentences lost their hour too.
  const parts = Object.keys(WINDOW_OF_PART).join('|')
  const oclock = `(?:\\s*o'?\\s?clock)?`
  const partThenHour = new RegExp(
    `\\b(${parts})\\s+(?:at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?${oclock}\\b`,
    'i',
  ).exec(text)
  const hourThenPart = new RegExp(
    `\\b(\\d{1,2})(?:[:.](\\d{2}))?${oclock}\\s+(?:in\\s+the\\s+|at\\s+)?(${parts})\\b`,
    'i',
  ).exec(text)
  const spoken = partThenHour
    ? { part: partThenHour[1]!, h: partThenHour[2]!, m: partThenHour[3], at: partThenHour }
    : hourThenPart
      ? { part: hourThenPart[3]!, h: hourThenPart[1]!, m: hourThenPart[2], at: hourThenPart }
      : null
  if (spoken) {
    const raw = Number(spoken.h)
    const minute = Number(spoken.m ?? 0)
    if (raw <= 23 && minute <= 59) {
      return {
        hour: hourInPart(raw, spoken.part.toLowerCase()),
        minute,
        match: { start: spoken.at.index, end: spoken.at.index + spoken.at[0].length },
        needsDateAnchor: false,
        // No window: the hour was said out loud, so it is a time, not a range
        // to schedule somewhere inside.
      }
    }
  }

  // 24-hour, or an explicit "at 6:30". "07:30" and "19:30" are 24-hour clocks;
  // "3:30" is a person who left off the pm, and reading it as half past three
  // in the morning sent the school pickup off before dawn.
  const clock = /\b(\d{1,2}):(\d{2})\b/.exec(text)
  if (clock) {
    const raw = Number(clock[1])
    const twelveHour = raw >= 1 && raw <= 12 && !clock[1]!.startsWith('0')
    return {
      hour: raw,
      minute: Number(clock[2]),
      match: { start: clock.index, end: clock.index + clock[0].length },
      needsDateAnchor: false,
      ...(twelveHour ? { ambiguous: raw } : {}),
    }
  }

  // Before the single words: "after lunch" contains no day-part word of its
  // own, and "end of day" has nothing in it for the single-word pass to find.
  for (const convention of CONVENTIONS) {
    const found = convention.pattern.exec(text)
    if (!found) continue
    return {
      hour: convention.hour,
      minute: convention.minute ?? 0,
      match: { start: found.index, end: found.index + found[0].length },
      needsDateAnchor: false,
      ...(convention.window ? { window: convention.window } : {}),
    }
  }

  const part = new RegExp(`\\b(${Object.keys(DAY_PARTS).join('|')})\\b`, 'i').exec(text)
  if (part) {
    const word = part[1]!.toLowerCase()
    return {
      hour: DAY_PARTS[word]!,
      minute: 0,
      match: { start: part.index, end: part.index + part[0].length },
      needsDateAnchor: false,
      // "afternoon" is a window; "noon" is an instant. Only the vague ones
      // become windows, so the caller knows not to trust the hour.
      ...(WINDOW_OF_PART[word] ? { window: WINDOW_OF_PART[word] } : {}),
    }
  }

  // "at 6" — the "at" is what makes a bare number safe to read as a time.
  const at = /\bat\s+(\d{1,2})\b/i.exec(text)
  if (at) {
    const raw = Number(at[1])
    if (raw <= 24) {
      return {
        hour: businessHour(raw),
        minute: 0,
        match: { start: at.index, end: at.index + at[0].length },
        needsDateAnchor: false,
        ...(raw >= 1 && raw <= 12 ? { ambiguous: raw } : {}),
      }
    }
  }

  // "friday 6" — only trusted once a weekday or date has been found.
  const bare = /\b(\d{1,2})\b(?!\s*(?:min|minute|hour|hr|day|week|month|st|nd|rd|th|\/))/i.exec(
    text,
  )
  if (bare) {
    const raw = Number(bare[1])
    if (raw >= 1 && raw <= 23) {
      return {
        hour: businessHour(raw),
        minute: 0,
        match: { start: bare.index, end: bare.index + bare[0].length },
        needsDateAnchor: true,
        ...(raw <= 12 ? { ambiguous: raw } : {}),
      }
    }
  }

  return null
}

/**
 * Which half of the clock a number means, given the part of the day said with it.
 *
 * "7 in the evening" is 19:00 and "morning 7" is 07:00 — the number alone is
 * ambiguous and the part of the day is what settles it. Night covers both ends:
 * "night 10" is 22:00, while "raat 2 baje" is two in the morning, because
 * nobody means two in the afternoon when they say night.
 */
function hourInPart(raw: number, part: string): number {
  if (raw >= 13) return raw // already 24-hour; trust it
  const window = WINDOW_OF_PART[part]
  if (window === 'morning') return raw === 12 ? 12 : raw
  if (window === 'afternoon' || window === 'evening') return raw === 12 ? 12 : raw + 12
  // Night: late evening, or the small hours after midnight.
  if (raw === 12) return 0
  return raw <= 4 ? raw : raw + 12
}

/** 1–7 reads as afternoon, 8–12 as morning. How people actually speak. */
function businessHour(raw: number): number {
  if (raw >= 13) return raw
  if (raw === 12) return 12
  if (raw <= 7) return raw + 12
  return raw
}

/** Words that put a bare number in the evening: "dinner at 8:30", "party at 10". */
const EVENING_CUE = /\b(?:tonight|evening|night|dinner|supper|party|drinks|movie)\b/i
/** And in the morning: "breakfast at 8", "yoga at 6:30". */
const MORNING_CUE = /\b(?:morning|breakfast|wake|wake-?up|alarm|sunrise|dawn|jog|jogging|yoga)\b/i
/** Travel leaves early: "flight at 6:40" is the morning one. */
const TRAVEL_CUE = /\b(?:flight|train|bus|cab|taxi|airport|station|departs?|departure|boarding|pnr)\b/i

/**
 * Which half of the day a number with no am or pm means, from the rest of the
 * sentence. A part of the day said with it decides; then words that only
 * happen at one end of the day; then the plain convention. `guessed` is set
 * only when the convention decided an hour that really could be either.
 */
function pickHalf(raw: number, text: string, window?: ParsedWindow): { hour: number; guessed: boolean } {
  if (window) return { hour: hourInPart(raw, window), guessed: false }
  if (EVENING_CUE.test(text)) return { hour: hourInPart(raw, 'evening'), guessed: false }
  if (MORNING_CUE.test(text)) return { hour: raw, guessed: false }
  if (TRAVEL_CUE.test(text)) {
    // 5 to 11 is the morning departure; 1 to 4 is far likelier the afternoon.
    const hour = raw >= 5 && raw <= 11 ? raw : businessHour(raw)
    return { hour, guessed: raw !== 12 }
  }
  const hour = businessHour(raw)
  // 1–4 is the afternoon and 8–11 the morning for nearly everyone; 5, 6 and 7
  // are honestly either, so those are the ones worth saying out loud.
  return { hour, guessed: raw >= 5 && raw <= 7 }
}

/** Meals say when without a clock: lunch is at one, more or less, for everyone. */
const MEALS: { pattern: RegExp; name: string; hour: number; minute: number }[] = [
  { pattern: /\bbreakfast\b/i, name: 'breakfast', hour: 8, minute: 30 },
  { pattern: /\bbrunch\b/i, name: 'brunch', hour: 11, minute: 30 },
  { pattern: /\blunch\b/i, name: 'lunch', hour: 13, minute: 0 },
  { pattern: /\bdinner\b/i, name: 'dinner', hour: 20, minute: 0 },
]

/** The usual time of a meal named in the line, for one that gave no time. */
export function mealTime(text: string): { name: string; hour: number; minute: number } | null {
  const meal = MEALS.find((m) => m.pattern.test(text))
  return meal ? { name: meal.name, hour: meal.hour, minute: meal.minute } : null
}

/**
 * Every clock time with an am or pm in the line, in order: "medicine at 9am
 * and 9pm" is two reminders, not one with a stray "and 9pm" in its title.
 */
export function allClockTimes(text: string): { hour: number; minute: number; text: string }[] {
  const found: { hour: number; minute: number; text: string }[] = []
  for (const m of text.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m\.?(?![a-z])/gi)) {
    let hour = Number(m[1])
    const minute = Number(m[2] ?? 0)
    if (hour < 1 || hour > 12 || minute > 59) continue
    if (hour === 12) hour = 0
    if (m[3]!.toLowerCase() === 'p') hour += 12
    found.push({ hour, minute, text: m[0] })
  }
  return found
}

/** "3:30 pm", "9 am": a clock reading the way it is said. */
export function clockLabel(hour: number, minute: number): string {
  const half = hour >= 12 ? 'pm' : 'am'
  const h = hour % 12 === 0 ? 12 : hour % 12
  return `${h}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${half}`
}

function findDuration(text: string): { minutes: number; match: Match } | null {
  const m = /\bfor\s+(\d{1,3})\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i.exec(text)
  if (!m) return null
  const value = Number(m[1])
  const isHours = /^h/i.test(m[2]!)
  return {
    minutes: Math.min(480, isHours ? value * 60 : value),
    match: { start: m.index, end: m.index + m[0].length },
  }
}

interface DateFound {
  date: Date
  match: Match
  /** Set when the phrase already fixed an exact time, e.g. "in 2 hours". */
  exactTime?: boolean
  /**
   * Phrases like "tonight" and "this evening" name a day *and* a time in one
   * breath. Without this the whole phrase is eaten as a date and the time
   * silently defaults to 9am.
   */
  impliedHour?: number
  /** "tonight" and "this evening" name a window as well as a day. */
  impliedWindow?: ParsedWindow
  /** A weekday name that came out as today: "friday" said on a Friday. */
  weekdayIsToday?: boolean
  /** "Monday's", "tomorrow's": the day of something else named in the line. */
  possessive?: boolean
  /** "before December", "by the end of the month": already a date to finish by. */
  deadline?: boolean
}

/** "Monday's", "tomorrow’s" — straight or curly apostrophe. */
const POSSESSIVE = /^['’]s\b/i

/**
 * A month named on its own as a deadline: "before December", "by the end of
 * June". Only deadlines — "offsite in November" is an event on a day nobody
 * said, and asking which day beats pinning it to the 1st.
 */
function findMonthOnly(text: string, now: Date): DateFound | null {
  const monthNames = Object.keys(MONTHS).join('|')
  const m = new RegExp(
    `\\b(before|by|till|until|(?:by\\s+)?(?:the\\s+)?end\\s+of)\\s+(?:the\\s+)?(?:month\\s+of\\s+)?(${monthNames})\\b(?:\\s+(\\d{4}))?`,
    'i',
  ).exec(text)
  if (!m) return null
  const lead = m[1]!.toLowerCase().replace(/\s+/g, ' ')
  const month = MONTHS[m[2]!.toLowerCase()]!
  // "may" is a month only when it reads as one: "in May", not "I may".
  if (month === 4 && m[2] !== 'May' && m[2] !== 'MAY') return null
  let year = m[3] ? Number(m[3]) : now.getFullYear()
  if (!m[3] && new Date(year, month + 1, 0) < startOfDay(now)) year += 1

  // "before December" is done before the month starts: its eve. "end of
  // June" is its last day.
  const date = lead.endsWith('end of') ? new Date(year, month + 1, 0) : new Date(year, month, 0)
  // "before November" said in November: the deadline has gone, and next
  // year's is what they mean.
  if (date < startOfDay(now)) date.setFullYear(date.getFullYear() + 1)
  return { date, match: { start: m.index, end: m.index + m[0].length }, deadline: true }
}

function findDate(text: string, now: Date): DateFound | null {
  // in 20 minutes · in 2 hours · in 3 days · after 2 weeks
  const relative =
    /\b(?:in|after)\s+(?:(a|an)|(\d{1,3}))\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours|day|days|week|weeks|month|months)\b/i.exec(
      text,
    )
  if (relative) {
    const value = relative[1] ? 1 : Number(relative[2])
    const unit = relative[3]!.toLowerCase()
    const date = new Date(now)
    let exactTime = false

    if (unit.startsWith('min')) {
      date.setMinutes(date.getMinutes() + value)
      exactTime = true
    } else if (unit === 'h' || unit.startsWith('hr') || unit.startsWith('hour')) {
      date.setHours(date.getHours() + value)
      exactTime = true
    } else if (unit.startsWith('day')) {
      date.setDate(date.getDate() + value)
    } else if (unit.startsWith('week')) {
      date.setDate(date.getDate() + value * 7)
    } else {
      date.setMonth(date.getMonth() + value)
    }

    return {
      date: exactTime ? date : startOfDay(date),
      match: { start: relative.index, end: relative.index + relative[0].length },
      exactTime,
    }
  }

  // 25/12 · 25/12/2026 — day first, which is the convention here.
  const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(text)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2]) - 1
    const yearRaw = numeric[3] ? Number(numeric[3]) : now.getFullYear()
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw
    const date = new Date(year, month, day, 0, 0, 0, 0)
    if (!Number.isNaN(date.getTime()) && date.getMonth() === month) {
      if (!numeric[3] && date < startOfDay(now)) date.setFullYear(year + 1)
      return { date, match: { start: numeric.index, end: numeric.index + numeric[0].length } }
    }
  }

  // 25 dec · 25th december · dec 25
  const monthNames = Object.keys(MONTHS).join('|')
  // "5 November", "5th November", "5th of November" — the "of" is optional, and
  // omitting it here meant "5th of November" fell through to the bare-ordinal
  // rule and came back as the 5th of the wrong month.
  const dayMonth = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b`,
    'i',
  ).exec(text)
  const monthDay = new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(text)
  const named = dayMonth
    ? { day: Number(dayMonth[1]), month: MONTHS[dayMonth[2]!.toLowerCase()]!, m: dayMonth }
    : monthDay
      ? { day: Number(monthDay[2]), month: MONTHS[monthDay[1]!.toLowerCase()]!, m: monthDay }
      : null

  if (named) {
    const date = new Date(now.getFullYear(), named.month, named.day, 0, 0, 0, 0)
    if (date < startOfDay(now)) date.setFullYear(now.getFullYear() + 1)
    return { date, match: { start: named.m.index, end: named.m.index + named.m[0].length } }
  }

  // "before December", "in March", "end of June": a month with no day. Before
  // the bare ordinal, which would otherwise take nothing from it at all.
  const monthOnly = findMonthOnly(text, now)
  if (monthOnly) return monthOnly

  // "by month end", "end of the month": the last day of this one.
  const monthEnd = /\b(?:by\s+)?(?:the\s+)?(?:end\s+of\s+(?:the\s+|this\s+)?month|(?:this\s+)?month[- ]end)\b/i.exec(text)
  if (monthEnd) {
    const date = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { date, match: { start: monthEnd.index, end: monthEnd.index + monthEnd[0].length }, deadline: true }
  }

  /**
   * "on the 18th" — a day with no month.
   *
   * Checked after the named-month forms so "13th October" is not truncated to
   * "13th". Without this the sentence still parsed, because "at 6 PM" was found
   * and the day silently ignored — a wrong answer, which is worse than none.
   * The ordinal suffix is mandatory: a bare "18" is far too easy to mistake.
   */
  const ordinalDay = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i.exec(text)
  if (ordinalDay) {
    const day = Number(ordinalDay[1])
    if (day >= 1 && day <= 31) {
      const date = new Date(now.getFullYear(), now.getMonth(), day, 0, 0, 0, 0)
      // Already gone this month, so they mean next month.
      if (date < startOfDay(now) || date.getDate() !== day) {
        date.setMonth(now.getMonth() + 1, day)
      }
      if (date.getDate() === day) {
        return {
          date,
          match: { start: ordinalDay.index, end: ordinalDay.index + ordinalDay[0].length },
        }
      }
    }
  }

  // day after tomorrow — checked before "tomorrow" so it is not swallowed.
  const dayAfter = /\bday\s+after\s+tomorrow\b/i.exec(text)
  if (dayAfter) {
    const date = startOfDay(now)
    date.setDate(date.getDate() + 2)
    return { date, match: { start: dayAfter.index, end: dayAfter.index + dayAfter[0].length } }
  }

  const tomorrow = /\b(tomorrow|tmrw|tmw)\b/i.exec(text)
  if (tomorrow) {
    const date = startOfDay(now)
    date.setDate(date.getDate() + 1)
    const end = tomorrow.index + tomorrow[0].length
    return {
      date,
      match: { start: tomorrow.index, end },
      ...(POSSESSIVE.test(text.slice(end)) ? { possessive: true } : {}),
    }
  }

  const today = /\b(today|tonight|this\s+(morning|afternoon|evening))\b/i.exec(text)
  if (today) {
    // "tonight" and "this evening" name a day and a time at once. Without
    // pulling the hour out here the whole phrase is eaten as a date and the
    // time quietly falls back to the 9am default.
    const part = (today[2] ?? (/tonight/i.test(today[1]!) ? 'tonight' : '')).toLowerCase()
    const impliedHour = DAY_PARTS[part]
    const impliedWindow = WINDOW_OF_PART[part]

    return {
      date: startOfDay(now),
      match: { start: today.index, end: today.index + today[0].length },
      ...(impliedHour !== undefined ? { impliedHour } : {}),
      ...(impliedWindow ? { impliedWindow } : {}),
    }
  }

  /**
   * "sometime this week" is a real answer, not a shrug. It means "by the end of
   * the week", so it resolves to the last working day rather than to nothing.
   */
  const thisWeekend = /\bthis\s+weekend\b/i.exec(text)
  if (thisWeekend) {
    const date = startOfDay(now)
    // Saturday is day 6; if it has gone, they mean the coming one.
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7))
    return {
      date,
      match: { start: thisWeekend.index, end: thisWeekend.index + thisWeekend[0].length },
    }
  }

  const thisWeek = /\bthis\s+week\b/i.exec(text)
  if (thisWeek) {
    const date = startOfDay(now)
    // End of the working week: Friday, or today if the weekend has started.
    date.setDate(date.getDate() + Math.max(0, 5 - date.getDay()))
    return {
      date,
      match: { start: thisWeek.index, end: thisWeek.index + thisWeek[0].length },
    }
  }

  const nextWeek = /\bnext\s+week\b/i.exec(text)
  if (nextWeek) {
    const date = startOfDay(now)
    date.setDate(date.getDate() + 7)
    return { date, match: { start: nextWeek.index, end: nextWeek.index + nextWeek[0].length } }
  }

  const nextMonth = /\bnext\s+month\b/i.exec(text)
  if (nextMonth) {
    const date = startOfDay(now)
    date.setMonth(date.getMonth() + 1)
    return { date, match: { start: nextMonth.index, end: nextMonth.index + nextMonth[0].length } }
  }

  const weekdayNames = Object.keys(WEEKDAYS).join('|')
  const weekday = new RegExp(`\\b(next|this|coming)?\\s*(${weekdayNames})\\b`, 'i').exec(text)
  if (weekday) {
    const forceNext = weekday[1]?.toLowerCase() === 'next'
    const end = weekday.index + weekday[0].length
    const possessive = POSSESSIVE.test(text.slice(end))
    const date = resolveWeekday(now, WEEKDAYS[weekday[2]!.toLowerCase()]!, forceNext)
    // "Monday's board meeting" said on a Monday is next week's: today's would
    // have been "today's".
    if (possessive && date.getTime() === startOfDay(now).getTime()) date.setDate(date.getDate() + 7)
    return {
      date,
      match: { start: weekday.index, end },
      weekdayIsToday: date.getTime() === startOfDay(now).getTime(),
      ...(possessive ? { possessive } : {}),
    }
  }

  return null
}

// -------------------------------------------------------------------- api

export function parseWhen(input: string, now: Date = new Date()): ParsedWhen | null {
  const duration = findDuration(input)
  // Blank out the duration before looking for a time, or "for 30 min" donates
  // its 30 to the clock.
  const withoutDuration = duration
    ? input.slice(0, duration.match.start) +
      ' '.repeat(duration.match.end - duration.match.start) +
      input.slice(duration.match.end)
    : input

  const dateFound = findDate(withoutDuration, now)

  // "before 31 July", "by Friday": a date to be done by. "before" a day is the
  // day before it, so the reminder comes while there is still time; the word
  // goes with the date, so the title is not left saying "submit ITR before".
  if (dateFound && !dateFound.possessive) {
    const lead = /\b(before|by|till|until|no\s+later\s+than)\s+(?:the\s+)?$/i.exec(
      withoutDuration.slice(0, dateFound.match.start),
    )
    if (lead) {
      dateFound.match = { start: lead.index, end: dateFound.match.end }
      if (!dateFound.deadline && !dateFound.exactTime) {
        dateFound.deadline = true
        if (/^before$/i.test(lead[1]!)) dateFound.date.setDate(dateFound.date.getDate() - 1)
      }
    }
  }

  // Hide the date phrase before hunting for a time, so "in 3 days" cannot have
  // its 3 read back as 3pm.
  const withoutDate = dateFound
    ? withoutDuration.slice(0, dateFound.match.start) +
      ' '.repeat(dateFound.match.end - dateFound.match.start) +
      withoutDuration.slice(dateFound.match.end)
    : withoutDuration

  const timeFound = findTime(withoutDate)
  const usableTime = timeFound && (!timeFound.needsDateAnchor || dateFound !== null)

  if (!dateFound && !usableTime) return null

  let date: Date
  let timeAssumed = false
  let halfGuessed: 'am' | 'pm' | undefined
  let meal: string | undefined

  // A number with no am or pm takes its half of the day from the sentence:
  // "tonight at 9" is nine at night, "dinner at 8:30" is the evening one.
  if (usableTime && timeFound && timeFound.ambiguous !== undefined) {
    const half = pickHalf(timeFound.ambiguous, withoutDuration, dateFound?.impliedWindow)
    timeFound.hour = half.hour
    if (half.guessed) halfGuessed = half.hour >= 12 ? 'pm' : 'am'
  }

  if (dateFound && usableTime && timeFound) {
    date = new Date(dateFound.date)
    date.setHours(timeFound.hour, timeFound.minute, 0, 0)
    // "friday 1pm" said at 2pm on a Friday is next Friday: a plan for an
    // hour that has already gone is never what anyone means.
    if (dateFound.weekdayIsToday && date <= now) date.setDate(date.getDate() + 7)
  } else if (dateFound) {
    date = new Date(dateFound.date)
    const usual = mealTime(withoutDate)
    if (dateFound.impliedHour !== undefined) {
      date.setHours(dateFound.impliedHour, 0, 0, 0)
    } else if (!dateFound.exactTime && usual) {
      // "team lunch friday" is at lunchtime, not at the 9am default.
      date.setHours(usual.hour, usual.minute, 0, 0)
      meal = usual.name
    } else if (!dateFound.exactTime) {
      date.setHours(DEFAULT_HOUR, 0, 0, 0)
      timeAssumed = true
    }
  } else {
    // A time with no day means the next time that clock reading comes round.
    date = startOfDay(now)
    date.setHours(timeFound!.hour, timeFound!.minute, 0, 0)
    if (date <= now) date.setDate(date.getDate() + 1)
  }

  const matchSpan = span(
    span(dateFound?.match ?? null, usableTime ? (timeFound?.match ?? null) : null),
    duration?.match ?? null,
  )!

  // A window when that is all that was said. "tonight" is a window; "tonight
  // at 9" is nine o'clock, and filing it as "some time tonight" loses the nine.
  const clockSaid = usableTime && timeFound && !timeFound.window
  const window = clockSaid ? undefined : (dateFound?.impliedWindow ?? (usableTime ? timeFound?.window : undefined))

  // Each fragment on its own, as well as the enclosing span.
  //
  // `matched` runs from the earliest fragment to the latest, which is right
  // when they sit together ("tomorrow 9am") and wrong when something sits
  // between them: in "tomorrow call the bank 9am" the span swallows "call the
  // bank", and a title built by cutting it out comes back empty. That is the
  // ordinary order of a Hindi sentence — "kal subah mandir jaunga 9 baje" — so
  // there it happened every time.
  //
  // But fragments joined only by a connector are one phrase: in "tomorrow at
  // 4pm" the "at" belongs to neither fragment, and cutting them apart strands
  // it in the title — "meet dr sharma at about the pricing". So neighbours are
  // merged when nothing but a connector separates them, and kept apart when
  // real words do.
  const CONNECTOR = /^[\s,@-]*(?:(?:at|on|around|by)\b[\s,@-]*)?$/i
  // A possessive day stays in the title: "prepare slides for Monday's board
  // meeting" cut down to "prepare slides for 's board meeting" said nothing.
  const ordered = [dateFound?.possessive ? null : dateFound?.match, usableTime ? timeFound?.match : null, duration?.match]
    .filter((m): m is Match => Boolean(m))
    .sort((a, b) => a.start - b.start)
  const joined: Match[] = []
  for (const m of ordered) {
    const last = joined[joined.length - 1]
    if (last && (m.start <= last.end || CONNECTOR.test(input.slice(last.end, m.start)))) {
      last.end = Math.max(last.end, m.end)
    } else {
      joined.push({ ...m })
    }
  }
  const pieces = joined.map((m) => input.slice(m.start, m.end).trim()).filter(Boolean)

  return {
    date,
    matched: input.slice(matchSpan.start, matchSpan.end).trim(),
    pieces,
    timeAssumed,
    ...(window ? { window } : {}),
    ...(duration ? { durationMinutes: duration.minutes } : {}),
    ...(halfGuessed ? { halfGuessed } : {}),
    ...(dateFound?.possessive ? { possessive: true } : {}),
    ...(dateFound?.deadline ? { deadline: true } : {}),
    ...(meal ? { meal } : {}),
  }
}

/**
 * What is left once the date phrase is removed — the title.
 *
 * Removing only the date is not enough. People dictate whole sentences at a
 * planner ("hi please block my calendar for ... on site the session time will
 * be ..."), and every word of that survived into the event title until the
 * conversational cleanup was shared with this path.
 */
export function titleFrom(input: string, parsed: ParsedWhen): string {
  let without: string
  // An empty list is an answer too: a possessive day ("Monday's") is the
  // only date, and it stays.
  if (parsed.pieces && (parsed.pieces.length > 0 || parsed.possessive)) {
    // Cut each fragment on its own, so whatever sat between them — usually the
    // thing being planned — survives.
    without = input
    for (const piece of parsed.pieces) {
      const at = without.indexOf(piece)
      if (at !== -1) without = without.slice(0, at) + ' ' + without.slice(at + piece.length)
    }
  } else {
    const index = input.indexOf(parsed.matched)
    without =
      index === -1
        ? input
        : input.slice(0, index) + ' ' + input.slice(index + parsed.matched.length)
  }

  const place = extractPlace(without)
  const cleaned = cleanTitle(without, { place })

  // Never hand back an empty title just because the cleanup was aggressive.
  return (
    cleaned ||
    without
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
      .trim()
  )
}

/** The place named in the sentence, so the caller can prefill it separately. */
export function placeFrom(input: string): string | null {
  return extractPlace(input)
}
