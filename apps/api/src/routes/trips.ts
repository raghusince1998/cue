import type { FastifyInstance } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  createTripInput,
  updateTripInput,
  type TripDTO,
  type TripStrictness,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'

const DAY_MS = 86_400_000

function daysUntil(startsOn: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(`${startsOn}T00:00:00`)
  return Math.round((start.getTime() - today.getTime()) / DAY_MS)
}

type TripRow = typeof schema.trips.$inferSelect

function toDTO(row: TripRow, counts?: { planned: number; waiting: number }): TripDTO {
  return {
    id: row.id,
    placeLabel: row.placeLabel,
    placeId: row.placeId,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    strictness: row.strictness as TripStrictness,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    daysUntil: daysUntil(row.startsOn),
    nights: Math.round(
      (new Date(`${row.endsOn}T00:00:00`).getTime() -
        new Date(`${row.startsOn}T00:00:00`).getTime()) /
        DAY_MS,
    ),
    ...(counts ? { plannedCount: counts.planned, waitingCount: counts.waiting } : {}),
  }
}

export async function tripRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * Wishes saved for this place and still waiting. Matched on the label,
   * case-insensitively, because "Mathura" typed in June and "mathura" typed in
   * October are obviously the same intent.
   */
  async function waitingFor(userId: string, placeLabel: string) {
    return db
      .select()
      .from(schema.intentions)
      .where(
        and(
          eq(schema.intentions.userId, userId),
          eq(schema.intentions.status, 'saved'),
          sql`lower(${schema.intentions.placeLabel}) = lower(${placeLabel})`,
        ),
      )
      .orderBy(asc(schema.intentions.createdAt))
  }

  /** The journeys dashboard: what is coming, and what is still unplanned. */
  app.get('/trips', async (req) => {
    const { orgId, sub: userId } = scope(req)

    const rows = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.orgId, orgId), eq(schema.trips.userId, userId)))
      .orderBy(asc(schema.trips.startsOn))

    // Two grouped queries rather than one per trip — this is a list screen.
    const planned = await db
      .select({
        tripId: schema.commitments.tripId,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.commitments)
      .where(
        and(eq(schema.commitments.userId, userId), eq(schema.commitments.status, 'pending')),
      )
      .groupBy(schema.commitments.tripId)

    const waiting = await db
      .select({
        label: sql<string>`lower(${schema.intentions.placeLabel})`,
        n: sql<number>`count(*)::int`,
      })
      .from(schema.intentions)
      .where(
        and(eq(schema.intentions.userId, userId), eq(schema.intentions.status, 'saved')),
      )
      .groupBy(sql`lower(${schema.intentions.placeLabel})`)

    const plannedBy = new Map(planned.map((p) => [p.tripId, p.n]))
    const waitingBy = new Map(waiting.map((w) => [w.label, w.n]))

    return rows.map((row) =>
      toDTO(row, {
        planned: plannedBy.get(row.id) ?? 0,
        waiting: waitingBy.get(row.placeLabel.toLowerCase()) ?? 0,
      }),
    )
  })

  /**
   * Creating a trip is the moment saved wishes become relevant, so the response
   * carries them. That surfacing is the whole point of storing them dateless.
   */
  app.post('/trips', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = createTripInput.parse(req.body)

    if (body.endsOn < body.startsOn) {
      return reply.code(400).send({ error: 'ends_before_it_starts' })
    }

    const trip = takeFirst(
      await db
        .insert(schema.trips)
        .values({
          orgId,
          userId,
          placeLabel: body.placeLabel.trim(),
          placeId: body.placeId ?? null,
          startsOn: body.startsOn,
          endsOn: body.endsOn,
          strictness: body.strictness,
          notes: body.notes ?? null,
        })
        .returning(),
      'trip',
    )

    return reply.code(201).send({
      trip: toDTO(trip),
      waiting: await waitingFor(userId, trip.placeLabel),
    })
  })

  app.get('/trips/:id', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = req.params as { id: string }

    const rows = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.id, id), eq(schema.trips.orgId, orgId)))
      .limit(1)

    const trip = rows[0]
    if (!trip) return reply.code(404).send({ error: 'not_found' })

    const planned = await db
      .select()
      .from(schema.commitments)
      .where(and(eq(schema.commitments.tripId, id), eq(schema.commitments.orgId, orgId)))
      .orderBy(asc(schema.commitments.dueAt))

    return {
      trip: toDTO(trip),
      planned: planned.map((c) => ({
        id: c.id,
        title: c.title,
        dueAt: c.dueAt.toISOString(),
        durationMinutes: c.durationMinutes,
        flexibility: c.flexibility,
        preferredWindow: c.preferredWindow,
        allDay: c.allDay,
        endsAt: c.endsAt ? c.endsAt.toISOString() : null,
        status: c.status,
        priority: c.priority,
      })),
      waiting: await waitingFor(userId, trip.placeLabel),
    }
  })

  app.patch('/trips/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const body = updateTripInput.parse(req.body)

    const existing = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.id, id), eq(schema.trips.orgId, orgId)))
      .limit(1)
    if (existing.length === 0) return reply.code(404).send({ error: 'not_found' })

    const startsOn = body.startsOn ?? existing[0]!.startsOn
    const endsOn = body.endsOn ?? existing[0]!.endsOn
    if (endsOn < startsOn) return reply.code(400).send({ error: 'ends_before_it_starts' })

    await db
      .update(schema.trips)
      .set({
        ...(body.placeLabel !== undefined ? { placeLabel: body.placeLabel.trim() } : {}),
        ...(body.placeId !== undefined ? { placeId: body.placeId } : {}),
        ...(body.strictness !== undefined ? { strictness: body.strictness } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        startsOn,
        endsOn,
      })
      .where(eq(schema.trips.id, id))

    const updated = await db.select().from(schema.trips).where(eq(schema.trips.id, id)).limit(1)
    return toDTO(takeFirst(updated, 'trip'))
  })

  /**
   * Deleting a trip detaches its plans rather than deleting them. Cancelling a
   * journey does not cancel the dentist appointment you happened to file under
   * it — the database enforces this with `on delete set null`.
   */
  app.delete('/trips/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const existing = await db
      .select({ id: schema.trips.id })
      .from(schema.trips)
      .where(and(eq(schema.trips.id, id), eq(schema.trips.orgId, orgId)))
      .limit(1)
    if (existing.length === 0) return reply.code(404).send({ error: 'not_found' })

    const detached = await db
      .update(schema.commitments)
      .set({ tripId: null })
      .where(eq(schema.commitments.tripId, id))
      .returning({ id: schema.commitments.id })

    await db.delete(schema.trips).where(eq(schema.trips.id, id))
    return { ok: true, detached: detached.length }
  })
}
