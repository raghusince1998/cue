import { resolveZone } from './windowsZones.ts'
/**
 * Reading an iCalendar feed (RFC 5545).
 *
 * Hand-rolled rather than pulled from npm, for the same reason the date parser
 * is: this runs against whatever Google, Apple and Outlook actually emit, and
 * when one of them sends something surprising the fix has to be readable.
 *
 * The guiding rule is the one the rest of this codebase follows — a repeat it
 * cannot model is reported as unsupported, never half-applied. An event that
 * silently loses half its rule is worse than one that was skipped out loud.
 */

import type { RecurrenceRule } from './recurrence.ts'

export interface IcsEvent {
  /** Stable across syncs, which is what makes re-importing safe. */
  uid: string
  title: string
  description: string | null
  location: string | null
  startsAt: Date
  endsAt: Date | null
  /** Date-valued rather than timed: a birthday, a holiday, a whole-day trip. */
  allDay: boolean
  /** Set when the event repeats and the rule fits what we can model. */
  rule: RecurrenceRule | null
  cancelled: boolean
}

export interface IcsSkip {
  uid: string
  title: string
  reason: string
}

export interface IcsParseResult {
  calendarName: string | null
  events: IcsEvent[]
  /** Reported rather than swallowed, so the UI can say what it did not take. */
  skipped: IcsSkip[]
}

/**
 * Long lines are folded onto continuation lines beginning with a space or tab.
 * Unfolding has to happen before anything else or values arrive truncated.
 */
function unfold(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1)
    } else {
      out.push(raw)
    }
  }
  return out
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

/** `DTSTART;TZID=Asia/Kolkata:20261006T103000` -> name, params, value. */
function parseLine(line: string): Prop | null {
  // The first colon that is not inside a quoted parameter ends the name+params.
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') quoted = !quoted
    else if (ch === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon === -1) return null

  const head = line.slice(0, colon)
  const value = line.slice(colon + 1)
  const [name, ...paramParts] = head.split(';')
  if (!name) return null

  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf('=')
    if (eq > 0) {
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '')
    }
  }

  return { name: name.toUpperCase(), params, value }
}

/** Text values escape commas, semicolons, newlines and backslashes. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) =>
    ch === 'n' || ch === 'N' ? '\n' : ch,
  )
}

/**
 * How far `tz` is from UTC at a given instant, in milliseconds.
 *
 * Intl is the only timezone database available without a dependency. Formatting
 * the instant in the target zone and reading it back as if it were UTC gives
 * the offset, DST included.
 */
function offsetAt(ts: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(ts)
      .map((p) => [p.type, p.value]),
  )
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Some locales render midnight as hour 24.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - ts
}

/** Wall-clock time in a named zone -> the absolute instant it refers to. */
function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  const first = offsetAt(naive, tz)
  const ts = naive - first
  // One correction pass: the initial guess can land on the wrong side of a DST
  // transition, and re-reading the offset at the corrected instant fixes it.
  const second = offsetAt(ts, tz)
  return new Date(second === first ? ts : naive - second)
}

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/

interface ParsedDate {
  date: Date
  allDay: boolean
}

function parseDate(prop: Prop): ParsedDate | null {
  const value = prop.value.trim()

  const dateOnly = DATE_ONLY.exec(value)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    // All-day values have no zone. Building it local keeps "14 March" on the
    // 14th regardless of where the server happens to be.
    return { date: new Date(Number(y), Number(m) - 1, Number(d)), allDay: true }
  }

  const dt = DATE_TIME.exec(value)
  if (!dt) return null
  const [, y, mo, d, h, mi, s, utc] = dt
  const nums = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number]

  if (utc) {
    return { date: new Date(Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5])), allDay: false }
  }

  const tz = prop.params.TZID
  if (tz) {
    // Outlook writes Windows names rather than IANA ones, so this is a lookup
    // and not just a pass-through. Null means the zone is genuinely unknown,
    // and the caller reports that: falling back to the server's own zone put
    // an 11:00 Pacific meeting on screen at 11:00 local, confidently wrong by
    // half a day with nothing anywhere saying so.
    const zone = resolveZone(tz)
    if (!zone) return null
    try {
      return { date: zonedToUtc(nums[0], nums[1], nums[2], nums[3], nums[4], nums[5], zone), allDay: false }
    } catch {
      return null
    }
  }

  return { date: new Date(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]), allDay: false }
}

const ICS_WEEKDAYS: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * RRULE -> our rule, or null when it asks for something we do not model.
 *
 * Null means "this repeats in a way we cannot describe", and the caller reports
 * it rather than importing a single occurrence that looks complete but is not.
 */
export function parseRRule(value: string): RecurrenceRule | null {
  const parts: Record<string, string> = {}
  for (const chunk of value.split(';')) {
    const eq = chunk.indexOf('=')
    if (eq > 0) parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1)
  }

  const freqMap: Record<string, RecurrenceRule['freq']> = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    YEARLY: 'yearly',
  }
  const freq = freqMap[(parts.FREQ ?? '').toUpperCase()]
  if (!freq) return null

  // Sub-daily repeats, and the calendar-arithmetic parts nobody uses by hand,
  // have no representation here. Rejecting beats approximating.
  for (const unsupported of ['BYWEEKNO', 'BYYEARDAY', 'BYHOUR', 'BYMINUTE', 'BYSECOND']) {
    if (parts[unsupported]) return null
  }

  const rule: RecurrenceRule = {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
  }

  if (parts.BYDAY) {
    const days: number[] = []
    let setPos: number | null = null

    for (const token of parts.BYDAY.split(',')) {
      const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(token.trim())
      if (!m) return null
      days.push(ICS_WEEKDAYS[m[2]!.toUpperCase()]!)
      if (m[1]) {
        // "2TU" — an ordinal weekday. Only meaningful one at a time.
        if (setPos !== null || parts.BYDAY.includes(',')) return null
        setPos = Number(m[1])
      }
    }

    rule.byWeekday = [...new Set(days)].sort()
    if (setPos !== null) rule.setPos = setPos
  }

  if (parts.BYSETPOS) {
    const pos = Number(parts.BYSETPOS)
    // Only the simple "nth weekday of the month" form maps onto our model.
    if (!Number.isInteger(pos) || rule.byWeekday?.length !== 1) return null
    rule.setPos = pos
  }

  if (parts.BYMONTHDAY) {
    const days = parts.BYMONTHDAY.split(',')
    // One month day is all the model holds, and dropping the rest silently is
    // exactly the failure this whole parser is written to avoid.
    if (days.length > 1) return null
    const day = Number(days[0])
    if (!Number.isInteger(day) || day < 1 || day > 31) return null
    rule.byMonthDay = day
  }

  if (parts.BYMONTH) {
    const months = parts.BYMONTH.split(',')
    if (months.length > 1) return null
    const month = Number(months[0])
    if (!Number.isInteger(month) || month < 1 || month > 12) return null
    rule.byMonth = month - 1
  }

  if (parts.COUNT) {
    const n = Number(parts.COUNT)
    if (Number.isInteger(n) && n > 0) rule.count = n
  }

  if (parts.UNTIL) {
    // Read as a UTC calendar date, never converted to local.
    //
    // UNTIL is an instant, but it stands for the day the author picked in
    // their calendar UI. Converting 20261231T235959Z to a local date lands on
    // 1 January in Kolkata and 31 December in New York — an off-by-one that
    // flips direction with the server's timezone. The date in the string is
    // the one that was meant.
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts.UNTIL.trim())
    if (m) rule.until = `${m[1]}-${m[2]}-${m[3]}`
  }

  return rule
}

export function parseIcs(text: string): IcsParseResult {
  const events: IcsEvent[] = []
  const skipped: IcsSkip[] = []
  let calendarName: string | null = null

  /**
   * Component nesting matters more than it looks. A Google feed opens with a
   * VTIMEZONE containing STANDARD and DAYLIGHT blocks that have their own
   * DTSTART and RRULE — read flat, those would be mistaken for an event that
   * repeats forever.
   */
  const stack: string[] = []
  let current: Record<string, Prop> | null = null
  let exdates: Date[] = []
  let hasRecurrenceId = false

  for (const line of unfold(text)) {
    const prop = parseLine(line)
    if (!prop) continue

    if (prop.name === 'BEGIN') {
      stack.push(prop.value.toUpperCase())
      if (prop.value.toUpperCase() === 'VEVENT' && stack.length === 2) {
        current = {}
        exdates = []
        hasRecurrenceId = false
      }
      continue
    }

    if (prop.name === 'END') {
      const ended = stack.pop()
      if (ended === 'VEVENT' && current) {
        finish(current, exdates, hasRecurrenceId)
        current = null
      }
      continue
    }

    if (!current) {
      if (prop.name === 'X-WR-CALNAME' && stack.length === 1) {
        calendarName = unescapeText(prop.value).trim() || null
      }
      continue
    }

    // Only properties directly inside the VEVENT, never ones from a nested
    // VALARM (which carries its own TRIGGER, DESCRIPTION and so on).
    if (stack[stack.length - 1] !== 'VEVENT') continue

    if (prop.name === 'EXDATE') {
      for (const one of prop.value.split(',')) {
        const d = parseDate({ ...prop, value: one })
        if (d) exdates.push(d.date)
      }
      continue
    }
    if (prop.name === 'RECURRENCE-ID') hasRecurrenceId = true

    current[prop.name] = prop
  }

  function finish(props: Record<string, Prop>, exclusions: Date[], isOverride: boolean) {
    const uid = props.UID?.value.trim()
    const title = props.SUMMARY ? unescapeText(props.SUMMARY.value).trim() : ''
    const label = title || '(untitled)'

    if (!uid) {
      skipped.push({ uid: '', title: label, reason: 'no UID to sync against' })
      return
    }

    // Named separately from "no date": a calendar full of a zone we cannot
    // resolve is a fixable problem, and "no start date I could read" would send
    // somebody looking in entirely the wrong place.
    const startZone = props.DTSTART?.params.TZID
    if (startZone && !resolveZone(startZone)) {
      skipped.push({ uid, title: label, reason: `uses a time zone I do not know (${startZone})` })
      return
    }

    const start = props.DTSTART ? parseDate(props.DTSTART) : null
    if (!start) {
      skipped.push({ uid, title: label, reason: 'no start date I could read' })
      return
    }

    // A RECURRENCE-ID event is a single moved or changed instance of a series.
    // Importing it as its own event would duplicate that day.
    if (isOverride) {
      skipped.push({ uid, title: label, reason: 'a one-off change to a repeating event' })
      return
    }

    let rule: RecurrenceRule | null = null
    if (props.RRULE) {
      rule = parseRRule(props.RRULE.value)
      if (!rule) {
        skipped.push({ uid, title: label, reason: 'repeats in a way I cannot describe yet' })
        return
      }
      if (exclusions.length > 0) {
        rule = { ...rule, exdates: exclusions.map(ymd) }
      }
    }

    let end = props.DTEND ? parseDate(props.DTEND) : null

    // An all-day DTEND is *exclusive*: a one-day holiday on 2 October is
    // written DTSTART=20261002;DTEND=20261003. Taken literally that is two
    // days, and every single-day event in an imported calendar renders a day
    // too long. The last included day is what the rest of the app means by an
    // end date, so normalise here rather than in every consumer.
    if (end && start.allDay) {
      const inclusive = new Date(end.date.getTime() - 86_400_000)
      end = { ...end, date: inclusive < start.date ? start.date : inclusive }
    }

    events.push({
      uid,
      title: label,
      description: props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value).trim() || null : null,
      location: props.LOCATION ? unescapeText(props.LOCATION.value).trim() || null : null,
      startsAt: start.date,
      endsAt: end?.date ?? null,
      allDay: start.allDay,
      rule,
      cancelled: (props.STATUS?.value ?? '').toUpperCase() === 'CANCELLED',
    })
  }

  return { calendarName, events, skipped }
}
