import { and, asc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm'
import { findCity, nameParts, samePlace } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { matchersFor, wordRe } from './people.ts'

/**
 * What a sentence typed into the capture box already knows about.
 *
 * "call raghu tomorrow" — there may be a Raghu Kumar in People, or two
 * Raghus, or a Raghunath. "demo at mehta physio" — that is probably the Mehta
 * Physio Clinic account. "client meeting in Pune" — Pune is a city, so this
 * is a trip, and there may be things saved for the next time you are there.
 *
 * Certain matches (a full name, the only Raghu) are attached with a way to say
 * "not them"; anything less is offered as a choice, because attaching a plan
 * to the wrong person is worse than asking.
 */

export interface PersonLink {
  id: string
  name: string
  /** "Purchase manager at Infosys" — enough to tell two Raghus apart. */
  detail: string | null
  phone: string | null
  certain: boolean
}

export interface PlaceLink {
  id: string
  name: string
  detail: string | null
}

export interface AccountLink {
  name: string
  people: number
}

export interface Links {
  people: PersonLink[]
  places: PlaceLink[]
  accounts: AccountLink[]
}

export interface TripLink {
  placeLabel: string
  /** YYYY-MM-DD: the day of the plan, and of the trip if one is made. */
  day: string
  /** A trip there already covering that day: the plan joins it. */
  existing: { id: string; startsOn: string; endsOn: string } | null
  /** Things saved for "when I go to …", still waiting. */
  waiting: { id: string; title: string }[]
}

/** Words that are never a name, however a contact happens to be called. */
const NOT_NAMES = new Set(
  (
    'call calls meet meeting meetings with the and for send about tomorrow today tonight morning evening ' +
    'afternoon night next this that from after before until till demo visit review follow followup remind ' +
    'reminder check sync team client clients office order quote quotation proposal price pricing invoice ' +
    'payment report update plan week month year day days back again lunch dinner coffee breakfast pick drop ' +
    'buy get going come bring take give ask tell share discuss confirm book cancel reschedule doctor dentist ' +
    'monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun january february ' +
    'march april may june july august september october november december jan feb mar apr jun jul aug sep ' +
    'sept oct nov dec noon hour hours min mins minutes deck samples sample agreement contract document docs ' +
    'email mail message whatsapp text new old trial site branch head team'
  ).split(' '),
)

/** Words that say what kind of organisation it is, not which. */
const GENERIC_ORG = new Set(
  (
    'the and of clinic clinics hospital hospitals medical centre center care health healthcare pharma ' +
    'pharmacy labs lab diagnostics ltd limited pvt private inc llp llc co company corp corporation group ' +
    'technologies technology tech solutions services systems industries enterprises international india ' +
    'global physio dental eye skin'
  ).split(' '),
)

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}{3,}/gu) ?? []).filter((w) => !NOT_NAMES.has(w))
}

function personDetail(c: { role: string | null; organization: string | null }): string | null {
  if (c.role && c.organization) return `${c.role} at ${c.organization}`
  return c.role ?? c.organization ?? null
}

export async function findLinks(orgId: string, text: string, preset: { contactId: string | null }): Promise<Links> {
  const ct = schema.contacts
  const [contacts, places] = await Promise.all([
    db
      .select({ id: ct.id, name: ct.name, role: ct.role, organization: ct.organization, phone: ct.phone })
      .from(ct)
      .where(eq(ct.orgId, orgId))
      .limit(2000),
    db
      .select({ id: schema.places.id, name: schema.places.name, kind: schema.places.kind })
      .from(schema.places)
      .where(eq(schema.places.orgId, orgId))
      .limit(500),
  ])
  const words = wordsOf(text)

  // ---- people
  const matchers = matchersFor(contacts)
  const people = contacts
    .map((c) => {
      const parts = nameParts(c.name)
      const tokens = parts.bare.toLowerCase().split(' ')
      // Certain: the whole name, or a short form only this person has — and
      // not one that is also an ordinary word, or "Monday Group" would claim
      // every plan made for a Monday.
      const whole = wordRe(c.name.trim()).test(text) || (parts.bare.includes(' ') && wordRe(parts.bare).test(text))
      const shortOk = !NOT_NAMES.has(parts.given.toLowerCase())
      const certain = c.id === preset.contactId || whole || (shortOk && matchers.get(c.id)!.inTitle(text))
      const exact = words.some((w) => tokens.includes(w))
      // "raghu" for Raghunath; not "ram" for Ramakrishnan-the-whole-team.
      const prefix = words.some(
        (w) => w.length >= 4 && tokens.some((t) => t !== w && t.startsWith(w) && t.length - w.length <= 4),
      )
      const score = certain ? 3 : exact ? 2 : prefix ? 1 : 0
      return { c, certain, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.name.localeCompare(b.c.name))
    .slice(0, 5)
    .map(
      ({ c, certain }): PersonLink => ({
        id: c.id,
        name: c.name,
        detail: personDetail(c),
        phone: c.phone,
        certain,
      }),
    )

  // ---- saved places
  const placeLinks = places
    .filter((p) => {
      if (p.name.trim().length < 4) return false
      if (wordRe(p.name.trim()).test(text)) return true
      const distinctive = p.name.toLowerCase().split(/\s+/).filter((t) => t.length >= 5 && !GENERIC_ORG.has(t))
      return distinctive.some((t) => words.includes(t))
    })
    .slice(0, 3)
    .map((p): PlaceLink => ({ id: p.id, name: p.name, detail: p.kind }))

  // ---- clinics and companies, from where people work
  const counts = new Map<string, { name: string; people: number }>()
  for (const c of contacts) {
    const org = c.organization?.trim().replace(/\s+/g, ' ')
    if (!org) continue
    const key = org.toLowerCase()
    const entry = counts.get(key) ?? { name: org, people: 0 }
    entry.people += 1
    counts.set(key, entry)
  }
  const saved = await db
    .select({ name: schema.accounts.name })
    .from(schema.accounts)
    .where(eq(schema.accounts.orgId, orgId))
  for (const a of saved) {
    const key = a.name.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!counts.has(key)) counts.set(key, { name: a.name.trim(), people: 0 })
  }
  // The person's own workplace is reached through them; offering it too is noise.
  const certainOrgs = new Set(
    people.filter((p) => p.certain).map((p) => contacts.find((c) => c.id === p.id)?.organization?.trim().toLowerCase()),
  )
  const accounts = [...counts.entries()]
    .filter(([key, a]) => {
      if (certainOrgs.has(key)) return false
      // Named in full, it is already linked by the title.
      if (wordRe(a.name).test(text)) return false
      const core = key.split(' ').filter((t) => !GENERIC_ORG.has(t))
      if (core.length && core.join(' ').length >= 4 && wordRe(core.join(' ')).test(text)) return true
      return core.some((t) => t.length >= 5 && words.includes(t))
    })
    .slice(0, 3)
    .map(([, a]) => a)

  return { people, places: placeLinks, accounts }
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Saved for "when I go to …", and still waiting. */
export async function waitingFor(userId: string, placeLabel: string) {
  return db
    .select({ id: schema.intentions.id, title: schema.intentions.title })
    .from(schema.intentions)
    .where(
      and(
        eq(schema.intentions.userId, userId),
        eq(schema.intentions.status, 'saved'),
        sql`lower(btrim(${schema.intentions.placeLabel})) = lower(btrim(${placeLabel}))`,
      ),
    )
    .orderBy(asc(schema.intentions.createdAt))
}

/** Places this person has planned trips to or saved things for: cities, by their own say-so. */
async function knownPlaces(userId: string): Promise<string[]> {
  const [trips, wishes] = await Promise.all([
    db.selectDistinct({ label: schema.trips.placeLabel }).from(schema.trips).where(eq(schema.trips.userId, userId)),
    db
      .selectDistinct({ label: schema.intentions.placeLabel })
      .from(schema.intentions)
      .where(and(eq(schema.intentions.userId, userId), isNotNull(schema.intentions.placeLabel))),
  ])
  return [...trips, ...wishes].map((r) => r.label).filter(Boolean)
}

/** A plan in a city that is not home: which trip it belongs to, or would. */
export async function tripLinkFor(userId: string, text: string, placeLabel: string | null, at: Date): Promise<TripLink | null> {
  const [user] = await db
    .select({ home: schema.users.homeCity })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const known = await knownPlaces(userId)
  const city = findCity(text, known) ?? (placeLabel ? findCity(placeLabel, known) : null)
  if (!city || samePlace(city, user?.home)) return null

  const day = ymd(at)
  const t = schema.trips
  const [existing] = await db
    .select({ id: t.id, startsOn: t.startsOn, endsOn: t.endsOn })
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        sql`lower(btrim(${t.placeLabel})) = lower(${city})`,
        lte(t.startsOn, day),
        gte(t.endsOn, day),
      ),
    )
    .limit(1)

  return { placeLabel: city, day, existing: existing ?? null, waiting: await waitingFor(userId, city) }
}

/** The next trip to a place, for a "when I go there" saved just now. */
export async function upcomingTripTo(userId: string, placeLabel: string, now = new Date()) {
  const t = schema.trips
  const [trip] = await db
    .select({ id: t.id, placeLabel: t.placeLabel, startsOn: t.startsOn, endsOn: t.endsOn })
    .from(t)
    .where(and(eq(t.userId, userId), sql`lower(btrim(${t.placeLabel})) = lower(btrim(${placeLabel}))`, gte(t.endsOn, ymd(now))))
    .orderBy(asc(t.startsOn))
    .limit(1)
  return trip ?? null
}
