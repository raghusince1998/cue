import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { env } from '../env.ts'

/**
 * Estimating how long it takes to get from one place to another, and resolving
 * a typed city name to coordinates.
 *
 * Deliberately an estimate, not a routing call. The spec allows it for the
 * first cut, and the point of the warning is "this looks impractical, have a
 * look" — not "your journey takes 3h 14m". A number to the minute would imply a
 * precision nobody has, and would need a paid maps key to be honest about.
 */

const EARTH_RADIUS_KM = 6371

/**
 * Roads are not straight lines. 1.35 is a reasonable multiplier on the
 * as-the-crow-flies distance for Indian road networks.
 */
const ROAD_WINDING_FACTOR = 1.35

/** Getting out of the door, parking, finding the room. */
const FIXED_OVERHEAD_MINUTES = 30

export interface TravelEstimate {
  distanceKm: number
  minutes: number
  /** How much to trust it — the UI says so rather than implying precision. */
  basis: 'estimated'
}

export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function estimateTravel(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): TravelEstimate {
  const straight = haversineKm(from.lat, from.lng, to.lat, to.lng)
  const byRoad = straight * ROAD_WINDING_FACTOR

  // Short hops are dominated by overhead, not distance; long ones by speed.
  const driving = (byRoad / env.travelSpeedKmh) * 60
  return {
    distanceKm: Math.round(byRoad),
    minutes: Math.round(driving + FIXED_OVERHEAD_MINUTES),
    basis: 'estimated',
  }
}

/** Two labels naming the same place, allowing for case and stray punctuation. */
export function sameLabel(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const clean = (s: string) => s.trim().toLowerCase().replace(/[.,]/g, '')
  return clean(a) === clean(b)
}

interface Coords {
  lat: number
  lng: number
}

/**
 * Resolves a place name to coordinates via OpenStreetMap's free geocoder,
 * caching both hits and misses. A miss is cached too: a label nobody can
 * resolve must not be retried on every conflict check.
 */
export async function geocode(label: string): Promise<Coords | null> {
  const key = label.trim().toLowerCase()
  if (!key) return null

  const cached = await db
    .select()
    .from(schema.geocodeCache)
    .where(eq(schema.geocodeCache.label, key))
    .limit(1)

  if (cached[0]) {
    const row = cached[0]
    return row.resolved && row.lat !== null && row.lng !== null
      ? { lat: row.lat, lng: row.lng }
      : null
  }

  let found: { lat: number; lng: number; displayName: string } | null = null
  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', label)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      const res = await fetch(url, {
        // Nominatim's usage policy requires an identifying User-Agent.
        headers: { 'user-agent': 'Cue/0.1 (personal planner)' },
        signal: controller.signal,
      })
      if (res.ok) {
        const data = (await res.json()) as { lat?: string; lon?: string; display_name?: string }[]
        const hit = data[0]
        if (hit?.lat && hit.lon) {
          found = {
            lat: Number(hit.lat),
            lng: Number(hit.lon),
            displayName: hit.display_name ?? label,
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }
  } catch {
    // Offline or rate-limited. Do not cache a network failure as "unresolvable"
    // — that would poison the cache permanently for a temporary problem.
    return null
  }

  await db
    .insert(schema.geocodeCache)
    .values({
      label: key,
      lat: found?.lat ?? null,
      lng: found?.lng ?? null,
      displayName: found?.displayName ?? null,
      resolved: found !== null,
    })
    .onConflictDoNothing()

  return found ? { lat: found.lat, lng: found.lng } : null
}
