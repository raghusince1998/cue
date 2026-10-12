import { parseWhen } from './parseWhen.ts'

/**
 * Grammars for the two sentences a planner hears constantly and a date parser
 * cannot touch:
 *
 *   "When I go to Mathura, remind me to buy peda."   -> a place-bound intention
 *   "I'm going to Mathura from 12 to 14 October."    -> a trip
 *
 * Neither contains a date to find, which is why `parseWhen` returns nothing for
 * both. They are still perfectly regular English, so they want a parser rather
 * than a language model — deterministic, instant, free, and testable.
 */

// --------------------------------------------------------------- intentions

export interface ParsedIntention {
  placeLabel: string
  title: string
}

/** Phrases that introduce the task half, when there is no comma to split on. */
const TASK_LEAD =
  /\b(?:remind me to|remind me|i want to|i need to|i would like to|i should|i must|make sure to|don't forget to|dont forget to)\b/i

/** Filler that adds nothing once the place is known. */
const TASK_PREFIX =
  /^(?:please\s+)?(?:remind me to|remind me|i want to|i need to|i would like to|i should|i must|make sure to|don't forget to|dont forget to|to)\s+/i

function tidyTask(raw: string): string {
  // Punctuation first: ", remind me to buy peda" must lose the comma before
  // TASK_PREFIX can recognise the phrase that follows it.
  return raw
    .replace(/^[\s,:—–-]+/, '')
    .replace(TASK_PREFIX, '')
    .replace(/^[\s,:—–-]+/, '')
    .replace(/[\s,.!]+$/, '')
    .trim()
}

/**
 * Trims a date off the end of a captured place. "Mathura on 12 October" is the
 * place plus a date the caller handles separately — keeping it would name the
 * trip after a calendar entry.
 */
function tidyPlace(raw: string): string {
  let place = raw.replace(/^[\s,]+/, '').replace(/[\s,.!]+$/, '')

  // "Agra for 3 days" is a place and a length, not a place called "Agra for 3
  // days". Cut at the length before anything else looks at the string.
  place = place.replace(/\s+for\s+\d{1,2}\s*(?:day|days|night|nights)\b.*$/i, '')

  const date = parseWhen(place)
  if (date) {
    const at = place.indexOf(date.matched)
    if (at > 0) place = place.slice(0, at)
  }

  return place
    .replace(/\b(?:on|from|in|at|the)\s*$/i, '')
    .replace(/[\s,.!]+$/, '')
    .trim()
}

/**
 * What a task usually starts with, for a line with no comma or "remind me":
 * "when I go to Mumbai meet Rahul" is Mumbai, then the thing to do there.
 */
const TASK_VERB =
  /\s+(?=(?:meet|see|visit|buy|get|pick|collect|drop|try|eat|call|check|book|pay|give|take|bring|return|shop|attend|watch|ask|tell|send|show|have|post|renew|submit|sign|order|pack)\b)/i

/** Splits "Mathura, remind me to buy peda" into its two halves. */
function splitPlaceAndTask(rest: string): { place: string; task: string } | null {
  const comma = rest.indexOf(',')
  const lead = TASK_LEAD.exec(rest)

  // Whichever boundary comes first is the real one.
  let cut =
    comma >= 0 && (lead === null || comma < lead.index) ? comma : (lead?.index ?? -1)
  if (cut < 0) {
    // No comma and no "remind me": the place runs up to the first word that
    // starts a task, as long as a place is all that is in front of it.
    const verb = TASK_VERB.exec(rest)
    if (!verb || rest.slice(0, verb.index).trim().split(/\s+/).length > 3) return null
    cut = verb.index
  }

  const place = tidyPlace(rest.slice(0, cut))
  const task = tidyTask(rest.slice(cut))
  if (!place || !task) return null
  return { place, task }
}

/**
 * "I'm" is neither "i " nor the start of "am in", so every contraction missed
 * every pattern. Expanding first is far simpler than doubling each alternative.
 */
function expandContractions(input: string): string {
  // Straight and curly apostrophes both, since phones produce the curly one.
  return input
    .replace(/\bi['’]m\b/gi, 'I am')
    .replace(/\bi['’]ll\b/gi, 'I will')
    .replace(/\bi['’]ve\b/gi, 'I have')
}

const BEING_THERE =
  '(?:go(?:ing)?\\s+to|goto|am\\s+in|am\\s+at|am\\s+near|visit|reach|get\\s+to)'

export function parseIntention(input: string): ParsedIntention | null {
  const text = expandContractions(input.trim())
  if (!text) return null

  // "When I go to Mathura, remind me to buy peda"
  const contextFirst = new RegExp(
    `\\b(?:when|whenever|next\\s+time)\\s+(?:i\\s+)?${BEING_THERE}\\s+(.+)$`,
    'i',
  ).exec(text)
  if (contextFirst) {
    const split = splitPlaceAndTask(contextFirst[1]!)
    if (split) return { placeLabel: split.place, title: split.task }
  }

  // "Buy peda when I go to Mathura"
  const taskFirst = new RegExp(
    `^(.+?)\\s+(?:when|whenever)\\s+(?:i\\s+)?${BEING_THERE}\\s+(.+)$`,
    'i',
  ).exec(text)
  if (taskFirst) {
    const place = tidyPlace(taskFirst[2]!)
    const task = tidyTask(taskFirst[1]!)
    if (place && task) return { placeLabel: place, title: task }
  }

  // "Pack charger and passport for the Delhi trip", "buy sunscreen for my
  // trip to Goa": for a trip, not on any day of its own.
  const forTrip =
    /^(.+?)\s+for\s+(?:the|my|our|this|next|upcoming)\s+(?:(.{2,30}?)\s+trip|trip\s+to\s+(.{2,30}?))[\s.!]*$/i.exec(text)
  if (forTrip) {
    const place = tidyPlace((forTrip[2] ?? forTrip[3])!)
    const task = tidyTask(forTrip[1]!)
    if (place && task && !/^(?:work|business|office|weekend|long|short|next|road)$/i.test(place)) {
      return { placeLabel: place, title: task }
    }
  }

  // "Try the local food while I'm in Mathura"
  const whileThere = /^(.+?)\s+while\s+(?:i\s+am|im)\s+(?:in|at)\s+(.+)$/i.exec(text)
  if (whileThere) {
    const place = tidyPlace(whileThere[2]!)
    const task = tidyTask(whileThere[1]!)
    // "while I'm there" names no place — the caller has to supply the context.
    if (place && task && !/^there$/i.test(place)) {
      return { placeLabel: place, title: task }
    }
  }

  return null
}

// -------------------------------------------------------------------- trips

export interface ParsedTrip {
  placeLabel: string
  /** YYYY-MM-DD, day granularity: a trip has no start time. */
  startsOn: string
  endsOn: string
}

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
}

function iso(year: number, month: number, day: number): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

/** Rolls a bare day/month forward when it has already gone this year. */
function resolveYear(now: Date, month: number, day: number): number {
  const candidate = new Date(now.getFullYear(), month, day)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return candidate < today ? now.getFullYear() + 1 : now.getFullYear()
}

const MONTH_NAMES = Object.keys(MONTHS).join('|')
const ORD = '(?:st|nd|rd|th)?'
const TO = '(?:to|till|until|through|[-–—])'

export function parseTrip(input: string, now: Date = new Date()): ParsedTrip | null {
  const text = expandContractions(input.trim())
  if (!text) return null

  // "... 12th to 14th October" / "12-14 Oct"
  const dayRange = new RegExp(
    `\\b(\\d{1,2})${ORD}\\s*${TO}\\s*(\\d{1,2})${ORD}\\s+(?:of\\s+)?(${MONTH_NAMES})\\b`,
    'i',
  ).exec(text)

  // "... October 12 to 14"
  const monthFirst = new RegExp(
    `\\b(${MONTH_NAMES})\\s+(\\d{1,2})${ORD}\\s*${TO}\\s*(\\d{1,2})${ORD}\\b`,
    'i',
  ).exec(text)

  // "2 oct to 4 oct", and the cross-month "30 sep to 2 oct". Naming the month
  // on both sides is the commonest way people write a range, and neither
  // pattern above can read it — the month sits where the "to" is expected.
  const bothMonths = new RegExp(
    `\\b(\\d{1,2})${ORD}\\s+(${MONTH_NAMES})\\s*${TO}\\s*(\\d{1,2})${ORD}\\s+(${MONTH_NAMES})\\b`,
    'i',
  ).exec(text)

  // "oct 2 to oct 4"
  const monthBoth = new RegExp(
    `\\b(${MONTH_NAMES})\\s+(\\d{1,2})${ORD}\\s*${TO}\\s*(${MONTH_NAMES})\\s+(\\d{1,2})${ORD}\\b`,
    'i',
  ).exec(text)

  let month: number
  let from: number
  let to: number
  let rangeAt: number
  /** Set when the range crosses into a different month. */
  let endMonth: number | null = null

  if (bothMonths) {
    from = Number(bothMonths[1])
    month = MONTHS[bothMonths[2]!.toLowerCase()]!
    to = Number(bothMonths[3])
    endMonth = MONTHS[bothMonths[4]!.toLowerCase()]!
    rangeAt = bothMonths.index
  } else if (monthBoth) {
    month = MONTHS[monthBoth[1]!.toLowerCase()]!
    from = Number(monthBoth[2])
    endMonth = MONTHS[monthBoth[3]!.toLowerCase()]!
    to = Number(monthBoth[4])
    rangeAt = monthBoth.index
  } else if (dayRange) {
    from = Number(dayRange[1])
    to = Number(dayRange[2])
    month = MONTHS[dayRange[3]!.toLowerCase()]!
    rangeAt = dayRange.index
  } else if (monthFirst) {
    month = MONTHS[monthFirst[1]!.toLowerCase()]!
    from = Number(monthFirst[2])
    to = Number(monthFirst[3])
    rangeAt = monthFirst.index
  } else {
    // "visiting Agra for 3 days on 2 Oct" — a length and a start, which is how
    // people describe a trip at least as often as they give both ends.
    const span = /\bfor\s+(\d{1,2})\s*(day|days|night|nights)\b/i.exec(text)
    if (!span) return null

    const start = parseWhen(text, now)
    if (!start) return null

    const nights = /night/i.test(span[2]!)
    // Three days means the 2nd, 3rd and 4th; three nights means you come back
    // on the 5th. People mean different things and say them precisely.
    const length = Math.max(1, Number(span[1]))
    const startDate = new Date(start.date.getFullYear(), start.date.getMonth(), start.date.getDate())
    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + (nights ? length : length - 1))

    const where =
      /\b(?:go(?:ing)?\s+to|travel(?:ling|ing)?\s+to|trip\s+to|visiting|off\s+to|heading\s+to|away\s+in|in)\s+(.+)$/i.exec(
        text.slice(0, span.index) || text,
      )
    const label = where ? tidyPlace(where[1]!) : ''
    if (!label) return null

    return {
      placeLabel: label,
      startsOn: iso(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
      endsOn: iso(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()),
    }
  }

  // A backwards range is a typo, not a trip. Refuse rather than silently swap.
  // Only within one month: "30 sep to 2 oct" is perfectly ordinary.
  const sameMonth = endMonth === null || endMonth === month
  if (from < 1 || from > 31 || to < 1 || to > 31) return null
  if (sameMonth && to < from) return null

  // Where the trip is: whatever follows "going to", "trip to" and friends.
  const place =
    /\b(?:go(?:ing)?\s+to|travel(?:ling|ing)?\s+to|trip\s+to|visiting|off\s+to|heading\s+to|away\s+in|in)\s+(.+)$/i.exec(
      text.slice(0, rangeAt) || text,
    )

  const placeLabel = place ? tidyPlace(place[1]!) : ''
  if (!placeLabel) return null

  const year = resolveYear(now, month, from)
  // A range that runs backwards across months has rolled into the next year:
  // "30 Dec to 2 Jan" ends in January.
  const endYear = endMonth !== null && endMonth < month ? year + 1 : year
  return {
    placeLabel,
    startsOn: iso(year, month, from),
    endsOn: iso(endYear, endMonth ?? month, to),
  }
}
