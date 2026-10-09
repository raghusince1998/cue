/**
 * Turning a spoken sentence into a usable title, a place, and a warning about
 * anything that looked like a time but was not.
 *
 * Deliberately dependency-free so both the success path (`titleFrom`) and the
 * failure path (`diagnose`) can share it. They used to have separate ideas of
 * what a title was, which is how "hi please block my calendar for for the pause
 * awareness session at Volkswagen Pune on site the session time will be 22330
 * p.m" ended up as an event title.
 */

export const MONTH_NAMES =
  'january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec'

export const WEEKDAY_NAMES =
  'monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun'

/**
 * Conversational wrapping that carries no information. People talk to a planner
 * the way they would talk to an assistant, and none of it belongs in a title.
 */
const FILLER: RegExp[] = [
  /^\s*(?:hi|hello|hey|ok|okay|yo)\b[\s,.!-]*/i,
  /\bplease\b/gi,
  /\b(?:can you|could you|would you|kindly|i want you to|i would like you to|i need you to)\b/gi,
  /\b(?:block|blk)\s+(?:my|the)\s+calendar\b/gi,
  /\b(?:put|add)\s+(?:this\s+)?(?:in|on|to)\s+(?:my\s+)?calendar\b/gi,
  /\b(?:schedule|book)\s+(?:this|it)\b/gi,
  /\bmake\s+(?:a\s+)?note\b/gi,
  // "...on the 18th at 6 PM in my calendar" — the phrase often sits far from
  // the verb, so it needs matching on its own as well as after put/add.
  /\b(?:in|on|to)\s+(?:my|the)\s+calendar\b/gi,
  /\b(?:i\s+)?(?:need|have|want)\s+to\b/gi,
  /\bsometime\b/gi,
  /\bremind\s+me\b/gi,
  /\bthe\s+(?:session\s+)?time\s+will\s+be\b/gi,
  /\bthe\s+time\s+is\b/gi,
  /\bon[-\s]site\b/gi,
  /\bfor\s+the\s+same\b/gi,
]

/** Anything shaped like a time, valid or not — it never belongs in a title. */
const TIME_LIKE = /\b\d[\d:.]*\s*[ap]\.?m\.?(?![a-z])/gi

/** Digits glued together next to am/pm: "22330 p.m" — a typo, not a time. */
const MALFORMED_TIME = /\b(\d{3,}(?:[:.]\d+)*\s*[ap]\.?m\.?)(?![a-z])/i

/**
 * The original sentence, when it carries more than the tidied title does.
 *
 * Cleaning a title throws away real detail — "on site", "the session time will
 * be 22330 p.m", whatever else was dictated. None of that belongs in a title,
 * but discarding it entirely would lose what the person actually said. It goes
 * in the notes instead.
 *
 * Returns null when the original adds nothing: "dentist friday 6pm" against a
 * title of "dentist" is not worth repeating underneath it.
 */
export function originalIfInformative(raw: string, title: string): string | null {
  const text = raw.trim()
  if (!text || text.toLowerCase() === title.trim().toLowerCase()) return null

  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
  // Four or more extra words means real content was dropped, not just a date.
  return words(text) - words(title) >= 4 ? text : null
}

export function stripFiller(input: string): string {
  let text = input
  for (const pattern of FILLER) text = text.replace(pattern, ' ')
  return text.replace(/\s{2,}/g, ' ').trim()
}

/**
 * The thing they typed that looks like a time but is not one. Worth saying out
 * loud even when the date parsed — otherwise the app silently assumes 9am and
 * the user finds out on the day.
 */
export function findMalformedTime(input: string): string | null {
  const m = MALFORMED_TIME.exec(input)
  return m ? m[1]!.trim() : null
}

/**
 * "at Volkswagen Pune on site" -> "Volkswagen Pune".
 *
 * Capitalisation is the signal: a proper noun after "at" or "in" is a place,
 * whereas "at 6" or "in the morning" is not.
 */
export function extractPlace(input: string): string | null {
  const stopWords = /^(?:the|a|an|and|for|on|in|at|around|about|approx)$/i

  for (const pattern of [
    /\bat\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,3})/,
    /\bin\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,2})/,
  ]) {
    const m = pattern.exec(input)
    const candidate = m?.[1]?.trim()
    if (candidate && !stopWords.test(candidate)) return candidate
  }
  return null
}

/**
 * What is left once the filler, the place, any month name and anything
 * time-shaped are removed. Rough by design — it lands in an editable field.
 */
export function cleanTitle(input: string, options: { place?: string | null } = {}): string {
  let text = stripFiller(input)

  if (options.place) {
    text = text.replace(
      new RegExp(`\\b(?:at|in)\\s+${options.place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      ' ',
    )
  }

  return (
    text
      // A month left behind by a partial date match is noise, not a title.
      .replace(new RegExp(`\\b(?:${MONTH_NAMES})\\b`, 'gi'), ' ')
      .replace(TIME_LIKE, ' ')
      .replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      // Repeating groups: "for the pause awareness session" has two leading
      // filler words, and stripping only one leaves "for the" behind.
      .replace(/^\s*(?:\b(?:for|of|on|in|at|the|a|an|and)\b\s*)+/i, '')
      // And what led into a date that has been cut out: "send the quotation
      // by [friday 4pm]" is "send the quotation", not "... by".
      .replace(/(?:\b(?:for|of|on|in|at|the|a|an|and|by|before|until|till)\b\s*)+$/i, '')
      .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
      .trim()
  )
}
