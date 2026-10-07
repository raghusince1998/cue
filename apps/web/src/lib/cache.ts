import type { ContactDTO, PlaceDTO } from '@cue/shared'
import { api } from './api.ts'
import { STORE_CACHE, idbGet, idbPut, idbSupported } from './idb.ts'

/**
 * Reference data kept on the device so the capture screen still works with no
 * signal. Refreshed opportunistically whenever a request succeeds — this is a
 * fallback, never the primary source.
 */

const PLACES_KEY = 'places'
const CONTACTS_KEY = 'contacts'

async function cached<T>(key: string): Promise<T[]> {
  if (!idbSupported()) return []
  return (await idbGet<T[]>(STORE_CACHE, key)) ?? []
}

async function store(key: string, value: unknown): Promise<void> {
  if (!idbSupported()) return
  await idbPut(STORE_CACHE, value, key)
}

export async function loadPlaces(): Promise<{ places: PlaceDTO[]; fromCache: boolean }> {
  try {
    const places = await api<PlaceDTO[]>('/places')
    await store(PLACES_KEY, places)
    return { places, fromCache: false }
  } catch {
    return { places: await cached<PlaceDTO>(PLACES_KEY), fromCache: true }
  }
}

export async function loadContacts(): Promise<{ contacts: ContactDTO[]; fromCache: boolean }> {
  try {
    const contacts = await api<ContactDTO[]>('/contacts')
    await store(CONTACTS_KEY, contacts)
    return { contacts, fromCache: false }
  } catch {
    return { contacts: await cached<ContactDTO>(CONTACTS_KEY), fromCache: true }
  }
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
 * The same match the server does, computed on the device. Place matching is
 * pure arithmetic over data we already hold, so there is no reason for it to
 * need a connection.
 */
export function matchPlacesLocally(
  places: PlaceDTO[],
  lat: number,
  lng: number,
  searchRadiusM = 1000,
): PlaceDTO[] {
  return places
    .map((p) => {
      const d = distanceM(lat, lng, p.lat, p.lng)
      return { ...p, distanceM: d, withinRadius: d <= p.radiusM }
    })
    .filter((p) => (p.distanceM ?? Infinity) <= searchRadiusM)
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
    .slice(0, 8)
}
