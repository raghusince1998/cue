import type { FastifyInstance } from 'fastify'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  createPlaceInput,
  lookupPlaceInput,
  matchPlaceInput,
  type PlaceDTO,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { lookupNearby, lookupProvider } from '../services/placeLookup.ts'
import { suggestForPlace } from '../services/suggestion.ts'

/**
 * Great-circle distance in metres, computed in SQL so we can filter and sort
 * on it. Plain lat/lng is deliberate — PostGIS is overkill until we have
 * thousands of places per org.
 */
function distanceExpr(lat: number, lng: number) {
  return sql<number>`
    6371000 * acos(least(1.0, greatest(-1.0,
      cos(radians(${lat})) * cos(radians(${schema.places.lat})) *
      cos(radians(${schema.places.lng}) - radians(${lng})) +
      sin(radians(${lat})) * sin(radians(${schema.places.lat}))
    )))`
}

export async function placeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  app.get('/places', async (req) => {
    const { orgId } = scope(req)
    const rows = await db
      .select()
      .from(schema.places)
      .where(eq(schema.places.orgId, orgId))
      .orderBy(schema.places.name)

    return rows.map(
      (p): PlaceDTO => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        address: p.address,
        lat: p.lat,
        lng: p.lng,
        radiusM: p.radiusM,
        phone: p.phone,
        category: p.category,
        source: p.source,
        externalId: p.externalId,
      }),
    )
  })

  /**
   * "What businesses are at these coordinates?" Answered by an external
   * provider, never written to the database — the user picks one and only then
   * does it become a place.
   */
  app.post('/places/lookup', async (req) => {
    const { lat, lng, radiusM } = lookupPlaceInput.parse(req.body)
    try {
      const { provider, candidates } = await lookupNearby(lat, lng, radiusM)
      return { provider, candidates }
    } catch (err) {
      // A provider being slow or rate-limited must never break capture — the
      // user can always type the name themselves.
      req.log.warn({ err }, 'place lookup failed')
      return { provider: lookupProvider(), candidates: [], error: 'lookup_unavailable' }
    }
  })

  app.post('/places', async (req) => {
    const { orgId } = scope(req)
    const body = createPlaceInput.parse(req.body)
    const place = takeFirst(
      await db.insert(schema.places).values({ ...body, orgId }).returning(),
      'place',
    )
    return place
  })

  /**
   * Given the device's current coordinates, return the nearest known places.
   * `withinRadius` is the confident match — anything else is a suggestion the
   * user can accept or ignore in favour of saving a new place.
   */
  app.post('/places/match', async (req) => {
    const { orgId } = scope(req)
    const { lat, lng, searchRadiusM } = matchPlaceInput.parse(req.body)
    const distance = distanceExpr(lat, lng)

    const rows = await db
      .select({
        id: schema.places.id,
        name: schema.places.name,
        kind: schema.places.kind,
        address: schema.places.address,
        lat: schema.places.lat,
        lng: schema.places.lng,
        radiusM: schema.places.radiusM,
        distanceM: distance,
      })
      .from(schema.places)
      .where(and(eq(schema.places.orgId, orgId), sql`${distance} <= ${searchRadiusM}`))
      .orderBy(sql`${distance} asc`)
      .limit(8)

    return rows.map(
      (r): PlaceDTO => ({
        ...r,
        distanceM: Math.round(Number(r.distanceM)),
        withinRadius: Number(r.distanceM) <= r.radiusM,
      }),
    )
  })

  /**
   * What this visit will probably look like, from what happened here before.
   * Declared before /places/:id so the literal segment wins the route match.
   */
  app.get('/places/:id/suggestion', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const suggestion = await suggestForPlace(orgId, id)
    if (!suggestion) return reply.code(404).send({ error: 'not_found' })
    return suggestion
  })

  /** The account file: everything that has ever happened at one place. */
  app.get('/places/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const places = await db
      .select()
      .from(schema.places)
      .where(and(eq(schema.places.id, id), eq(schema.places.orgId, orgId)))
      .limit(1)

    const place = places[0]
    if (!place) return reply.code(404).send({ error: 'not_found' })

    const interactions = await db
      .select()
      .from(schema.interactions)
      .where(and(eq(schema.interactions.placeId, id), eq(schema.interactions.orgId, orgId)))
      .orderBy(desc(schema.interactions.startedAt))
      .limit(50)

    const commitments = await db
      .select()
      .from(schema.commitments)
      .where(and(eq(schema.commitments.placeId, id), eq(schema.commitments.orgId, orgId)))
      .orderBy(desc(schema.commitments.dueAt))
      .limit(50)

    return { place, interactions, commitments }
  })
}
