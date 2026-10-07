import { and, desc, eq, gte, ilike, lt, ne, or } from 'drizzle-orm'
import type { ParsedRelative } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * What this person's own history already answers.
 *
 * Every field on the capture form is a question the app could often answer
 * itself. How long is a dentist appointment? However long the last three were.
 * Where? Wherever they always are. What time do you go to the gym? The time you
 * always go. Asking anyway is what made a planner feel like paperwork.
 *
 * Deliberately built on the user's own rows and nothing else — no model, no
 * service, no shared corpus. The guesses are explainable because they are
 * arithmetic over things the person did, and every one is returned with the
 * evidence so the screen can say *why* rather than just filling a box.
 */

/** Words that carry no identity, so "call the dentist" matches "dentist". */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'at', 'in', 'on', 'for', 'with', 'my', 'me', 'and',
  'of', 'get', 'go', 'going', 'do', 'have', 'take', 'this', 'that', 'is', 'it',
])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  )
}

/**
 * Overlap weighted towards the shorter phrase.
 *
 * Plain Jaccard punishes "dentist" against "dentist appointment with Dr Shah"
 * for being short, when that is exactly the pair worth matching. Dividing by
 * the smaller set asks the useful question: is one of these essentially
 * contained in the other?
 */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared += 1
  return shared / Math.min(a.size, b.size)
}

/** How alike two titles must be before history is worth applying. */
const MATCH_THRESHOLD = 0.6
/** Enough past to learn from without dragging in a different era of someone's life. */
const LOOKBACK_DAYS = 365
const SAMPLE = 300

export interface Learned {
  durationMinutes: number | null
  kind: string | null
  placeLabel: string | null
  placeId: string | null
  contactId: string | null
  /** The hour this usually happens at, when it is consistent enough to claim. */
  hour: number | null
  minute: number | null
  /** Plain-words reason, shown to the user so the guess can be checked. Empty
   *  when nothing concrete was learned. */
  because: string
  /** Said only when the app supplied the time rather than the user. */
  becauseHour: string | null
  /**
   * The time of the most recent one, used when there is a precedent but not
   * yet a habit. A single past instance is a weaker claim than "you always do
   * this at nine", so it is reported in weaker words rather than not at all.
   */
  lastHour: number | null
  lastMinute: number | null
  timesSeen: number
  /** The title as it was actually written last time. */
  lastTitle: string
}

function mode<T>(values: T[]): { value: T; count: number } | null {
  if (values.length === 0) return null
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: { value: T; count: number } | null = null
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count }
  return best
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Looks up what happened the last few times something like this was planned.
 *
 * Returns null rather than guessing when there is no real precedent: a wrong
 * prefill costs more than an empty field, because the user has to notice it
 * before they can correct it.
 */
export async function recallSimilar(
  userId: string,
  title: string,
  opts: { excludeId?: string; now?: Date } = {},
): Promise<Learned | null> {
  const wanted = tokens(title)
  if (wanted.size === 0) return null

  const now = opts.now ?? new Date()
  const past = await db
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      kind: schema.commitments.kind,
      dueAt: schema.commitments.dueAt,
      durationMinutes: schema.commitments.durationMinutes,
      allDay: schema.commitments.allDay,
      placeLabel: schema.commitments.placeLabel,
      placeId: schema.commitments.placeId,
      contactId: schema.commitments.contactId,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        gte(schema.commitments.dueAt, new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)),
        opts.excludeId ? ne(schema.commitments.id, opts.excludeId) : undefined,
      ),
    )
    .orderBy(desc(schema.commitments.dueAt))
    .limit(SAMPLE)

  const matches = past.filter((row) => similarity(wanted, tokens(row.title)) >= MATCH_THRESHOLD)
  if (matches.length === 0) return null

  // An all-day item and a 30-minute one are different animals; learning a
  // duration across both would produce a number that fits neither.
  const timed = matches.filter((m) => !m.allDay)
  const durations = timed.map((m) => m.durationMinutes)
  const kinds = mode(matches.map((m) => m.kind))
  const places = mode(
    matches.map((m) => m.placeLabel).filter((p): p is string => Boolean(p)),
  )
  const hours = mode(timed.map((m) => m.dueAt.getHours()))

  const newest = matches[0]!
  const reasons: string[] = []

  const durationMinutes = durations.length > 0 ? median(durations) : null
  if (durationMinutes !== null && timed.length > 1) {
    reasons.push(`usually ${durationMinutes} min`)
  }

  // Only claim a usual time when it really is usual — a mode of two out of
  // seven is not "the time you always go", it is a coincidence.
  const consistentHour =
    hours && timed.length >= 3 && hours.count / timed.length >= 0.6 ? hours.value : null

  const placeLabel = places && places.count >= 2 ? places.value : (newest.placeLabel ?? null)
  if (placeLabel) reasons.push(`at ${placeLabel}`)

  const mostRecentTimed = timed[0] ?? null

  return {
    durationMinutes,
    kind: kinds?.value ?? null,
    placeLabel,
    placeId: newest.placeId,
    contactId: newest.contactId,
    hour: consistentHour,
    minute: consistentHour !== null ? 0 : null,
    // Empty when there is nothing concrete to report, and phrased without a
    // count when there is only one precedent: "You have done this 1 time" is
    // an odd sentence that costs attention, while "Last time this was at
    // Apollo Clinic" earns its place by saying where the prefill came from.
    because:
      reasons.length === 0
        ? ''
        : matches.length === 1
          ? `Last time this was ${reasons.join(', ')}.`
          : `You have done this ${plural(matches.length, 'time')} — ${reasons.join(', ')}.`,
    lastHour: mostRecentTimed ? mostRecentTimed.dueAt.getHours() : null,
    lastMinute: mostRecentTimed ? mostRecentTimed.dueAt.getMinutes() : null,
    becauseHour:
      consistentHour !== null
        ? `You usually do this around ${consistentHour % 12 === 0 ? 12 : consistentHour % 12}${consistentHour < 12 ? 'am' : 'pm'}.`
        : mostRecentTimed
          ? `Last time this was at ${mostRecentTimed.dueAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
          : null,
    timesSeen: matches.length,
    lastTitle: newest.title,
  }
}

/**
 * The handful of things this person adds most often.
 *
 * Offered as one-tap chips, because the fastest capture is the one where
 * nothing is typed at all. Drawn from repeated titles only; something done once
 * is not a habit and putting it here would be clutter.
 */
export async function frequentTitles(userId: string, now = new Date(), limit = 5) {
  const past = await db
    .select({
      title: schema.commitments.title,
      kind: schema.commitments.kind,
      durationMinutes: schema.commitments.durationMinutes,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        gte(schema.commitments.dueAt, new Date(now.getTime() - 120 * 86_400_000)),
      ),
    )
    .orderBy(desc(schema.commitments.dueAt))
    .limit(SAMPLE)

  const groups = new Map<string, { title: string; count: number; kind: string }>()
  for (const row of past) {
    const key = [...tokens(row.title)].sort().join(' ')
    if (!key) continue
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { title: row.title, count: 1, kind: row.kind })
  }

  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

/**
 * Resolves "after the standup" against what is actually in that day.
 *
 * Kept on the server because only the server knows the day. Returns null
 * rather than guessing when the anchor is not there — a reminder pinned to a
 * meeting that does not exist is worse than one the person had to time
 * themselves, because it looks like it worked.
 */
export async function resolveAnchor(
  userId: string,
  relative: ParsedRelative,
  day: Date,
): Promise<{ at: Date; anchorTitle: string } | null> {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  const dayEnd = new Date(dayStart.getTime() + 86_400_000)

  const items = await db
    .select({
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      endsAt: schema.commitments.endsAt,
      durationMinutes: schema.commitments.durationMinutes,
      allDay: schema.commitments.allDay,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        gte(schema.commitments.dueAt, dayStart),
        lt(schema.commitments.dueAt, dayEnd),
      ),
    )
    .orderBy(schema.commitments.dueAt)

  // An all-day item has no edge to sit after, so it cannot act as an anchor.
  const timed = items.filter((i) => !i.allDay)
  if (timed.length === 0) return null

  const endOf = (i: (typeof timed)[number]) =>
    i.endsAt ?? new Date(i.dueAt.getTime() + i.durationMinutes * 60_000)

  let target: (typeof timed)[number] | undefined
  if (relative.anchor.kind === 'lastThing') {
    target = timed.reduce((latest, i) => (endOf(i) > endOf(latest) ? i : latest), timed[0]!)
  } else if (relative.anchor.kind === 'firstThing') {
    target = timed[0]
  } else {
    const wanted = tokens(relative.anchor.text)
    // Best match, not first match: a day with "standup" and "sprint planning"
    // in it should not answer "after the standup" with whichever came first.
    let best = 0
    for (const item of timed) {
      const score = similarity(wanted, tokens(item.title))
      if (score >= MATCH_THRESHOLD && score > best) {
        best = score
        target = item
      }
    }
  }

  if (!target) return null

  const at =
    relative.relation === 'after'
      ? new Date(endOf(target).getTime() + relative.offsetMinutes * 60_000)
      : new Date(target.dueAt.getTime() - relative.offsetMinutes * 60_000)

  return { at, anchorTitle: target.title }
}

/**
 * Finds or creates the contact a sentence named, and remembers where they are.
 *
 * "the dentist who lives in Sirsi" should only have to be said once. After
 * that, "appointment with the dentist" knows the place — which is the whole
 * difference between a text box and something that is paying attention.
 *
 * Matching is deliberately loose on the name and strict about not creating
 * duplicates: "dentist", "the dentist" and "Dentist" are one person.
 */
/**
 * Everyone who could be meant by a word.
 *
 * "Call the plumber" is only answerable if the app can look for a plumber, and
 * a plumber is a *role*, not a name. Matching both columns is what makes the
 * question askable at all — and when it finds two, asking which is the only
 * honest move. Guessing the wrong Ramesh is worse than taking one tap.
 */
export async function findPeople(
  orgId: string,
  text: string,
): Promise<{ id: string; name: string; role: string | null; phone: string | null; placeLabel: string | null }[]> {
  const cleaned = text.trim().replace(/^(?:the|my|our)\s+/i, '')
  if (cleaned.length < 2) return []

  const rows = await db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      role: schema.contacts.role,
      phone: schema.contacts.phone,
      notes: schema.contacts.notes,
    })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.orgId, orgId),
        or(
          ilike(schema.contacts.name, `%${cleaned}%`),
          ilike(schema.contacts.role, `%${cleaned}%`),
        ),
      ),
    )
    .limit(10)

  // An exact hit first: typing "Ramesh" when there is a Ramesh should not put
  // "Rameshwar Plumbing" ahead of him.
  const exact = (r: { name: string; role: string | null }) =>
    r.name.toLowerCase() === cleaned.toLowerCase() ||
    (r.role ?? '').toLowerCase() === cleaned.toLowerCase()

  return rows
    .sort((a, b) => Number(exact(b)) - Number(exact(a)))
    .map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      phone: r.phone,
      placeLabel: /^place:\s*(.+)$/im.exec(r.notes ?? '')?.[1]?.trim() ?? null,
    }))
}

/** Occupations, as opposed to names — the same lexicon the role parser uses. */
const OCCUPATION =
  /^(?:the\s+|my\s+|our\s+)?(dentist|doctor|physician|surgeon|therapist|physio|physiotherapist|counsellor|counselor|lawyer|advocate|accountant|auditor|banker|agent|broker|architect|contractor|plumber|electrician|carpenter|mechanic|tailor|barber|teacher|tutor|professor|client|customer|vendor|supplier|partner|investor|manager|director|recruiter|candidate|landlord|tenant|chemist|pharmacist|optician|vet|veterinarian)$/i

export async function rememberPerson(
  orgId: string,
  userId: string,
  name: string,
  placeLabel: string | null,
): Promise<{ contactId: string; placeLabel: string | null; created: boolean }> {
  void userId
  const cleaned = name.trim().replace(/^(?:the|my|our)\s+/i, '')

  const existing = await db
    .select({ id: schema.contacts.id, notes: schema.contacts.notes })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.orgId, orgId),
        // By role as well as name, or saying "the plumber" twice makes two of
        // them — the second stored under a name nobody will ever search for.
        or(ilike(schema.contacts.name, cleaned), ilike(schema.contacts.role, cleaned)),
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]!
    // A place learned later fills in a gap; it never overwrites one, because
    // the earlier answer came from the person and this one is inferred.
    const known = /^place:\s*(.+)$/im.exec(row.notes ?? '')?.[1]?.trim() ?? null
    if (!known && placeLabel) {
      await db
        .update(schema.contacts)
        .set({ notes: `${row.notes ? `${row.notes}
` : ''}place: ${placeLabel}` })
        .where(eq(schema.contacts.id, row.id))
    }
    return { contactId: row.id, placeLabel: known ?? placeLabel, created: false }
  }

  // "Plumber" goes in the role column, where it can be searched for, and the
  // name is left honest — "The plumber" until someone says which plumber.
  const occupation = OCCUPATION.exec(cleaned)?.[1] ?? null

  const [created] = await db
    .insert(schema.contacts)
    .values({
      orgId,
      name: occupation ? `The ${occupation.toLowerCase()}` : cleaned,
      role: occupation ? occupation.toLowerCase() : null,
      notes: placeLabel ? `place: ${placeLabel}` : null,
    })
    .returning({ id: schema.contacts.id })

  return { contactId: created!.id, placeLabel, created: true }
}

/** Where a known contact is, if anyone has said. */
export async function placeOfPerson(orgId: string, name: string): Promise<string | null> {
  const cleaned = name.trim().replace(/^(?:the|my|our)\s+/i, '')
  const [row] = await db
    .select({ notes: schema.contacts.notes })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), ilike(schema.contacts.name, cleaned)))
    .limit(1)
  return /^place:\s*(.+)$/im.exec(row?.notes ?? '')?.[1]?.trim() ?? null
}

/**
 * Anyone already in the contact list who is named in this sentence.
 *
 * The role grammar only spots a person where a marker word puts one — "with
 * Ramesh", "for the dentist". But "call Ramesh Yadav tomorrow" has no marker,
 * and he is sitting in the contact list with a phone number. Checking the list
 * itself is both more reliable than guessing from capitalisation and the thing
 * that makes the Call button appear.
 *
 * Longest name first, so "Ramesh Yadav" wins over a separate "Ramesh".
 */
export async function matchKnownPerson(
  orgId: string,
  text: string,
): Promise<{ id: string; name: string; role: string | null; phone: string | null; placeLabel: string | null } | null> {
  const haystack = ` ${text.toLowerCase()} `

  const rows = await db
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      role: schema.contacts.role,
      phone: schema.contacts.phone,
      notes: schema.contacts.notes,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
    .limit(500)

  const found = rows
    .filter((r) => r.name.trim().length >= 3)
    .sort((a, b) => b.name.length - a.name.length)
    .find((r) => haystack.includes(` ${r.name.toLowerCase()} `))

  if (!found) return null
  return {
    id: found.id,
    name: found.name,
    role: found.role,
    phone: found.phone,
    placeLabel: /^place:\s*(.+)$/im.exec(found.notes ?? '')?.[1]?.trim() ?? null,
  }
}
