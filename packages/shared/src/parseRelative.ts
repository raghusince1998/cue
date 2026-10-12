import { parseWhen } from './parseWhen.ts'

/**
 * "after my last meeting", "before the gym", "30 minutes after the standup".
 *
 * How people actually talk about their own day. Everything the parser handled
 * until now was absolute — a clock time, or a date — but nobody thinks "14:30",
 * they think "after lunch" and "once the standup is done". A planner that only
 * accepts the first kind makes you do the translation, which is the work it was
 * supposed to take off you.
 *
 * Two kinds, split because they resolve differently. Conventional phrases
 * ("end of day") mean the same thing for everyone and are handled in
 * parseWhen. These are the ones that depend on what is actually in your
 * schedule, so this module only identifies the reference — the server resolves
 * it against the day, because only the server knows what the day holds.
 */

export type RelativeAnchor =
  /** "after my last meeting" — whatever ends latest that day. */
  | { kind: 'lastThing' }
  /** "before my first meeting" — whatever starts earliest. */
  | { kind: 'firstThing' }
  /** "after the standup" — matched against titles on the day. */
  | { kind: 'named'; text: string }

export interface ParsedRelative {
  relation: 'after' | 'before'
  anchor: RelativeAnchor
  /** Stated separation, or a sensible default gap. */
  offsetMinutes: number
  /** The exact substring consumed, so the caller can cut it from the title. */
  matched: string
}

/**
 * Words that are conventions rather than things in your calendar.
 *
 * "after lunch" means early afternoon to everyone and needs no lookup, so it
 * belongs with the fixed vocabulary in parseWhen. Matching it here as a named
 * anchor would send the server hunting for a commitment called "lunch" and
 * fail for most people most days.
 */
const CONVENTIONS = /^(?:lunch|breakfast|dinner|work|school|bed|midnight|noon)$/i

/** "30 minutes", "an hour", "1 hr" — the gap, when one is given. */
const GAP =
  /(?:(\d{1,3})\s*(min|mins|minute|minutes|hr|hrs|hour|hours)|(?:an?\s+)?(half\s*(?:an\s*)?hour|hour))\s+/i

function gapToMinutes(match: RegExpExecArray | null): number | null {
  if (!match) return null
  if (match[1]) {
    const n = Number(match[1])
    return /^h/i.test(match[2]!) ? n * 60 : n
  }
  // Null, not an hour. Falling through to 60 here meant every bare "after the
  // standup" silently claimed a gap nobody asked for.
  if (!match[3]) return null
  return /half/i.test(match[3]) ? 30 : 60
}

/** A gap nobody stated: enough to travel or breathe, not enough to lose the day. */
const DEFAULT_GAP_MINUTES = 15

const LAST = /(?:my\s+)?last\s+(?:meeting|call|thing|appointment|one)/i
const FIRST = /(?:my\s+)?first\s+(?:meeting|call|thing|appointment|one)/i

/**
 * Trailing words that belong to the sentence, not the anchor's name.
 *
 * "after the standup tomorrow" refers to a standup, not to one called "standup
 * tomorrow", and leaving the date in the name would stop it ever matching.
 */
const TRAILING =
  /\s+(?:tomorrow|today|tonight|this\s+\w+|next\s+\w+|on\s+\w+|at\s+[\d:apm.\s]+|\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)$/i

/** Every trailing date and time, not just the last: "standup tomorrow 10am". */
function withoutTrailing(subject: string): string {
  let rest = subject
  for (let cut = rest.replace(TRAILING, ''); cut !== rest; cut = rest.replace(TRAILING, '')) rest = cut
  return rest
}

export function parseRelative(input: string): ParsedRelative | null {
  const pattern = new RegExp(
    // An optional gap, the relation, then whatever it is relative to.
    String.raw`\b(?:${GAP.source})?(after|before|once)\s+(.{2,60}?)(?:\s+(?:is|are)\s+(?:done|over|finished))?(?=[,.]|$)`,
    'i',
  )
  const m = pattern.exec(input)
  if (!m) return null

  const relation = /^before$/i.test(m[4]!) ? 'before' : 'after'
  let subject = withoutTrailing(m[5]!.trim()).trim()

  // "once the standup is done" reads as an after; "once" alone does not make
  // sense as a before, so it is normalised above.
  subject = subject.replace(/^(?:my|the|our)\s+/i, '').trim()
  if (!subject || CONVENTIONS.test(subject)) return null
  // "before 31 July", "after Diwali on 1 Nov", "before December": a date, not
  // something in the day to sit beside. The date parser reads those as a
  // deadline; treating "December" as a meeting to find never worked.
  if (isDatePhrase(subject)) return null

  const offsetMinutes = gapToMinutes(m as RegExpExecArray) ?? DEFAULT_GAP_MINUTES

  let anchor: RelativeAnchor
  if (LAST.test(m[5]!)) anchor = { kind: 'lastThing' }
  else if (FIRST.test(m[5]!)) anchor = { kind: 'firstThing' }
  else {
    // A bare "after the meeting" is too vague to resolve against a day that
    // holds four of them; it is left for the normal parser rather than guessed.
    if (/^(?:meeting|call|thing|appointment|one)$/i.test(subject)) return null
    anchor = { kind: 'named', text: subject }
  }

  return { relation, anchor, offsetMinutes, matched: m[0]! }
}

/** The sentence with the relative phrase removed, for use as a title. */
export function stripRelative(input: string, parsed: ParsedRelative): string {
  return input
    .replace(parsed.matched, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*(?:\b(?:and|then|to|please)\b\s*)+/i, '')
    .replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '')
    .trim()
}

/** True when nearly all of the phrase is a date: "31 July", "December", "friday". */
function isDatePhrase(subject: string): boolean {
  const when = parseWhen(`by ${subject}`)
  if (!when) return false
  const rest = subject.replace(/\b(?:by|on|the|of|this|next)\b/gi, ' ')
  const leftover = (when.pieces ?? [when.matched]).reduce((acc, piece) => acc.replace(piece.replace(/^by\s+/i, ''), ' '), rest)
  return leftover.replace(/[\s,.]+/g, '').length <= 2
}
