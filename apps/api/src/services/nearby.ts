import { sql } from 'drizzle-orm'
import { schema } from '../db/index.ts'

/**
 * Great-circle distance in metres, computed in SQL so we can filter and sort
 * on it. Plain lat/lng is deliberate — PostGIS is overkill until we have
 * thousands of places per org.
 */
export function distanceExpr(lat: number, lng: number) {
  return sql<number>`
    6371000 * acos(least(1.0, greatest(-1.0,
      cos(radians(${lat})) * cos(radians(${schema.places.lat})) *
      cos(radians(${schema.places.lng}) - radians(${lng})) +
      sin(radians(${lat})) * sin(radians(${schema.places.lat}))
    )))`
}
