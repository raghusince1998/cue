import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { estimateTravel, geocode, sameLabel, type TravelEstimate } from './travel.ts'

/**
 * "You are supposed to be in Mathura on the 13th, and this event is in Jaipur."
 *
 * Two independent checks, deliberately:
 *
 *  1. Against trips — needs no coordinates at all. If you have said you will be
 *     in Mathura and something lands in Jaipur, that is worth mentioning
 *     regardless of how far apart they are.
 *  2. Against neighbouring commitments — needs coordinates, and estimates
 *     whether the gap between them is enough to actually travel.
 *
 * Nothing here blocks a save. The spec is emphatic and correct on this: the app
 * says "I noticed something", never "you cannot do that".
 */

export type LocationSeverity = 'impossible' | 'tight' | 'review' | 'none'

export interface LocationConflict {
  severity: LocationSeverity
  kind: 'trip_elsewhere' | 'travel_between'
  /** Plain language, because the user has to make the call, not the app. */
  reason: string
  travel?: TravelEstimate
  availableMinutes?: number
  trip?: { id: string; placeLabel: string; startsOn: string; endsOn: string; strictness: string }
  other?: { id: string; title: string; placeLabel: string | null; dueAt: string }
  suggestedActions: string[]
}

/** How far either side of the proposed time to look for a travel problem. */
const NEIGHBOUR_WINDOW_HOURS = 14

function hours(minutes: number): string {
  if (minutes < 90) return `${Math.round(minutes)} minutes`
  const h = minutes / 60
  return `${h % 1 === 0 ? h : h.toFixed(1)} hours`
}

/** A trip you called "strict" makes an outside event a louder problem. */
function severityForTrip(strictness: string): LocationSeverity {
  if (strictness === 'strict') return 'impossible'
  if (strictness === 'tentative') return 'review'
  return 'tight'
}

async function coordsFor(input: {
  lat?: number | null
  lng?: number | null
  placeLabel?: string | null
}): Promise<{ lat: number; lng: number } | null> {
  if (input.lat != null && input.lng != null) return { lat: input.lat, lng: input.lng }
  if (input.placeLabel) return geocode(input.placeLabel)
  return null
}

export interface ProposedPlan {
  startsAt: Date
  durationMinutes: number
  placeLabel?: string | null
  lat?: number | null
  lng?: number | null
  /** Excluded from the check when editing an existing item. */
  excludeCommitmentId?: string
}

export async function detectLocationConflicts(
  userId: string,
  proposed: ProposedPlan,
): Promise<LocationConflict[]> {
  if (!proposed.placeLabel && proposed.lat == null) return []

  const conflicts: LocationConflict[] = []
  const day = proposed.startsAt.toISOString().slice(0, 10)

  // ---------------------------------------------------------------- trips
  const trips = await db
    .select()
    .from(schema.trips)
    .where(
      and(
        eq(schema.trips.userId, userId),
        lte(schema.trips.startsOn, day),
        gte(schema.trips.endsOn, day),
      ),
    )

  for (const trip of trips) {
    if (sameLabel(trip.placeLabel, proposed.placeLabel ?? null)) continue

    const severity = severityForTrip(trip.strictness)
    const [tripCoords, planCoords] = await Promise.all([
      coordsFor(trip),
      coordsFor(proposed),
    ])

    const travel =
      tripCoords && planCoords ? estimateTravel(tripCoords, planCoords) : undefined

    conflicts.push({
      severity,
      kind: 'trip_elsewhere',
      reason: travel
        ? `You are due to be in ${trip.placeLabel} on this date. Getting to ${proposed.placeLabel ?? 'there'} is roughly ${travel.distanceKm} km, about ${hours(travel.minutes)} each way.`
        : `You are due to be in ${trip.placeLabel} on this date, and this is in ${proposed.placeLabel ?? 'somewhere else'}.`,
      ...(travel ? { travel } : {}),
      trip: {
        id: trip.id,
        placeLabel: trip.placeLabel,
        startsOn: trip.startsOn,
        endsOn: trip.endsOn,
        strictness: trip.strictness,
      },
      suggestedActions: [
        'Keep both',
        'Move this one',
        'Adjust the trip',
        'Mark this tentative',
      ],
    })
  }

  // ------------------------------------------------- neighbouring plans
  const from = new Date(proposed.startsAt.getTime() - NEIGHBOUR_WINDOW_HOURS * 3600_000)
  const to = new Date(proposed.startsAt.getTime() + NEIGHBOUR_WINDOW_HOURS * 3600_000)

  const neighbours = await db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        eq(schema.commitments.flexibility, 'fixed'),
        eq(schema.commitments.allDay, false),
        gte(schema.commitments.dueAt, from),
        lte(schema.commitments.dueAt, to),
        proposed.excludeCommitmentId
          ? ne(schema.commitments.id, proposed.excludeCommitmentId)
          : undefined,
        sql`(${schema.commitments.placeLabel} is not null or ${schema.commitments.lat} is not null)`,
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  const planCoords = await coordsFor(proposed)
  if (!planCoords) return conflicts

  const planEnd = new Date(
    proposed.startsAt.getTime() + proposed.durationMinutes * 60_000,
  )

  for (const other of neighbours) {
    if (sameLabel(other.placeLabel, proposed.placeLabel ?? null)) continue

    const otherCoords = await coordsFor(other)
    if (!otherCoords) continue

    const travel = estimateTravel(otherCoords, planCoords)
    // Under 25 km is the same town; travel is not the interesting problem.
    if (travel.distanceKm < 25) continue

    const otherEnd = new Date(other.dueAt.getTime() + other.durationMinutes * 60_000)
    const gapMinutes =
      other.dueAt < proposed.startsAt
        ? (proposed.startsAt.getTime() - otherEnd.getTime()) / 60_000
        : (other.dueAt.getTime() - planEnd.getTime()) / 60_000

    // Overlapping in time is already reported by the time-conflict check.
    if (gapMinutes < 0) continue

    let severity: LocationSeverity = 'none'
    if (gapMinutes < travel.minutes) severity = 'impossible'
    else if (gapMinutes < travel.minutes * 1.5) severity = 'tight'
    if (severity === 'none') continue

    const earlier = other.dueAt < proposed.startsAt ? other.title : 'this'
    conflicts.push({
      severity,
      kind: 'travel_between',
      reason:
        severity === 'impossible'
          ? `Only ${hours(gapMinutes)} between ${earlier} and the other, but the journey is about ${travel.distanceKm} km — roughly ${hours(travel.minutes)}.`
          : `${hours(gapMinutes)} between them, and the journey is about ${hours(travel.minutes)}. Doable, but tight.`,
      travel,
      availableMinutes: Math.round(gapMinutes),
      other: {
        id: other.id,
        title: other.title,
        placeLabel: other.placeLabel,
        dueAt: other.dueAt.toISOString(),
      },
      suggestedActions: ['Keep both', 'Move this one', `Move ${other.title}`],
    })
  }

  return conflicts
}
