import { and, desc, eq } from 'drizzle-orm'
import type { CommitmentKind, PlaceSuggestionDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/** How many past visits to a place inform the guess. */
const HISTORY_LIMIT = 10
const DAY_MS = 86_400_000

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The value that appears most often; ties break towards the most recent. */
function mostCommon<T>(values: T[]): T | null {
  const first = values[0]
  if (first === undefined) return null

  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)

  let best: T = first
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * Builds the "same again?" proposal for a place.
 *
 * History is org-wide rather than per-user: the account belongs to the company,
 * so a rep picking up someone else's clinic should inherit what is known about
 * it rather than starting blind.
 */
export async function suggestForPlace(
  orgId: string,
  placeId: string,
): Promise<PlaceSuggestionDTO | null> {
  const places = await db
    .select({ id: schema.places.id, name: schema.places.name })
    .from(schema.places)
    .where(and(eq(schema.places.id, placeId), eq(schema.places.orgId, orgId)))
    .limit(1)

  const place = places[0]
  if (!place) return null

  const rows = await db
    .select({
      interaction: schema.interactions,
      commitment: schema.commitments,
      contact: schema.contacts,
    })
    .from(schema.interactions)
    .leftJoin(
      schema.commitments,
      eq(schema.commitments.interactionId, schema.interactions.id),
    )
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.interactions.contactId))
    .where(
      and(
        eq(schema.interactions.placeId, placeId),
        eq(schema.interactions.orgId, orgId),
        eq(schema.interactions.purpose, 'business'),
      ),
    )
    .orderBy(desc(schema.interactions.startedAt))
    .limit(HISTORY_LIMIT)

  const base: PlaceSuggestionDTO = {
    placeId: place.id,
    placeName: place.name,
    visitCount: rows.length,
    lastVisitAt: null,
    daysSinceLast: null,
    contact: null,
    outcome: null,
    typicalIntervalDays: null,
    lastCommitment: null,
    confidence: 'none',
  }

  if (rows.length === 0) return base

  const latest = rows[0]!
  base.lastVisitAt = latest.interaction.startedAt.toISOString()
  base.daysSinceLast = Math.round(
    (Date.now() - latest.interaction.startedAt.getTime()) / DAY_MS,
  )

  // Who you actually deal with here, not just whoever you saw once.
  const contactRows = rows.filter((r) => r.contact !== null)
  const usualContactId = mostCommon(contactRows.map((r) => r.contact!.id))
  const usualContact = contactRows.find((r) => r.contact!.id === usualContactId)?.contact
  if (usualContact) {
    base.contact = {
      id: usualContact.id,
      name: usualContact.name,
      role: usualContact.role,
      phone: usualContact.phone,
    }
  }

  base.outcome = mostCommon(
    rows.map((r) => r.interaction.outcome).filter((o): o is string => Boolean(o)),
  )

  // Median, not mean: one "call me in six months" should not drag every future
  // suggestion out with it.
  const intervals = rows
    .filter((r) => r.commitment !== null)
    .map(
      (r) =>
        (r.commitment!.dueAt.getTime() - r.interaction.startedAt.getTime()) / DAY_MS,
    )
    .filter((days) => days > 0 && days < 120)

  const typical = median(intervals)
  base.typicalIntervalDays = typical === null ? null : Math.round(typical * 10) / 10

  const lastWithCommitment = rows.find((r) => r.commitment !== null)
  if (lastWithCommitment?.commitment) {
    const c = lastWithCommitment.commitment
    base.lastCommitment = {
      title: c.title,
      kind: c.kind as CommitmentKind,
      durationMinutes: c.durationMinutes,
      dueAt: c.dueAt.toISOString(),
    }
  }

  // One prior visit is a coincidence; a repeat pattern is worth one-tapping.
  base.confidence =
    rows.length >= 2 && base.lastCommitment !== null
      ? 'strong'
      : rows.length >= 1
        ? 'weak'
        : 'none'

  return base
}
