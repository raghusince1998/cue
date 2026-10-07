import { env } from '../env.ts'

/**
 * Looks up real businesses at a set of coordinates.
 *
 * Worth being precise about what this can and cannot do: there is no public API
 * that maps coordinates to a *registered* company (GST/MCA registry data is not
 * queryable by location). What is available is point-of-interest data — trading
 * name, address, phone, category — which is what a field rep actually needs.
 *
 * Two providers, same shape:
 *  - OpenStreetMap via Overpass. Free, no key, works out of the box. Coverage of
 *    small Indian clinics is patchy — big names and hospitals are usually there,
 *    a two-room dermatology practice often is not.
 *  - Google Places. Far better coverage, needs an API key and billing.
 */

export interface PlaceCandidate {
  source: 'osm' | 'google'
  externalId: string
  name: string
  category: string | null
  address: string | null
  phone: string | null
  lat: number
  lng: number
  distanceM: number
}

const EARTH_RADIUS_M = 6_371_000

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))))
}

/**
 * Overpass asks people not to hammer it, and the capture screen can fire this
 * on every retry. Coordinates are rounded to ~11 m so standing still reuses one
 * entry rather than making a request per GPS jitter.
 */
const cache = new Map<string, { at: number; value: PlaceCandidate[] }>()
const CACHE_TTL_MS = 10 * 60_000

function cacheKey(lat: number, lng: number, radiusM: number) {
  return `${lat.toFixed(4)},${lng.toFixed(4)},${radiusM}`
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 15_000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------------ OSM

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

const OSM_CATEGORY_KEYS = ['healthcare', 'amenity', 'shop', 'office', 'leisure', 'craft']

function osmAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'],
    tags['addr:city'],
    tags['addr:postcode'],
  ].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length > 0 ? parts.join(', ') : null
}

async function lookupOsm(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<PlaceCandidate[]> {
  // Only named features that carry a business-ish tag — otherwise every bench
  // and lamppost in OSM comes back.
  const query = `[out:json][timeout:20];
nwr(around:${radiusM},${lat},${lng})["name"][~"^(${OSM_CATEGORY_KEYS.join('|')})$"~"."];
out center 40;`

  const data = (await fetchJson('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      // Overpass's usage policy asks for an identifying User-Agent.
      'user-agent': 'Cue/0.1 (personal planner)',
    },
    body: new URLSearchParams({ data: query }).toString(),
  })) as { elements?: OverpassElement[] }

  const candidates: PlaceCandidate[] = []

  for (const el of data.elements ?? []) {
    const tags = el.tags
    const pointLat = el.lat ?? el.center?.lat
    const pointLng = el.lon ?? el.center?.lon
    if (!tags?.name || pointLat === undefined || pointLng === undefined) continue

    const categoryKey = OSM_CATEGORY_KEYS.find((k) => tags[k])
    candidates.push({
      source: 'osm',
      externalId: `${el.type}/${el.id}`,
      name: tags.name,
      category: categoryKey ? (tags[categoryKey] ?? null) : null,
      address: osmAddress(tags),
      phone: tags.phone ?? tags['contact:phone'] ?? null,
      lat: pointLat,
      lng: pointLng,
      distanceM: distanceM(lat, lng, pointLat, pointLng),
    })
  }

  return candidates
}

// --------------------------------------------------------------- Google

interface GooglePlace {
  id?: string
  displayName?: { text?: string }
  formattedAddress?: string
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  primaryType?: string
  location?: { latitude?: number; longitude?: number }
}

async function lookupGoogle(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<PlaceCandidate[]> {
  const data = (await fetchJson('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': env.googlePlacesApiKey,
      // Only pay for the fields we actually show.
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.nationalPhoneNumber',
        'places.primaryType',
        'places.location',
      ].join(','),
    },
    body: JSON.stringify({
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusM } },
      maxResultCount: 20,
      rankPreference: 'DISTANCE',
    }),
  })) as { places?: GooglePlace[] }

  const candidates: PlaceCandidate[] = []

  for (const place of data.places ?? []) {
    const name = place.displayName?.text
    const pointLat = place.location?.latitude
    const pointLng = place.location?.longitude
    if (!name || !place.id || pointLat === undefined || pointLng === undefined) continue

    candidates.push({
      source: 'google',
      externalId: place.id,
      name,
      category: place.primaryType ?? null,
      address: place.formattedAddress ?? null,
      phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
      lat: pointLat,
      lng: pointLng,
      distanceM: distanceM(lat, lng, pointLat, pointLng),
    })
  }

  return candidates
}

// ----------------------------------------------------------------- api

export function lookupProvider(): 'osm' | 'google' | 'none' {
  if (env.placeLookupProvider === 'none') return 'none'
  if (env.placeLookupProvider === 'google') return 'google'
  if (env.placeLookupProvider === 'osm') return 'osm'
  // 'auto': prefer Google when a key is configured, fall back to free OSM.
  return env.googlePlacesApiKey ? 'google' : 'osm'
}

export async function lookupNearby(
  lat: number,
  lng: number,
  radiusM: number,
): Promise<{ provider: string; candidates: PlaceCandidate[] }> {
  const provider = lookupProvider()
  if (provider === 'none') return { provider, candidates: [] }

  const key = `${provider}:${cacheKey(lat, lng, radiusM)}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { provider, candidates: hit.value }
  }

  const candidates =
    provider === 'google'
      ? await lookupGoogle(lat, lng, radiusM)
      : await lookupOsm(lat, lng, radiusM)

  candidates.sort((a, b) => a.distanceM - b.distanceM)
  const top = candidates.slice(0, 20)

  cache.set(key, { at: Date.now(), value: top })
  return { provider, candidates: top }
}
