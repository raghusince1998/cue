import type { FastifyInstance } from 'fastify'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createTripInput,
  isAbroad,
  packingItems,
  updateTripInput,
  type TravelMode,
  type TripDTO,
  type TripItemDTO,
  type TripStrictness,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { scheduleFirstReminder } from '../services/reminders.ts'

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
    packingId: row.packingId ?? null,
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

    const c = schema.commitments
    const planned = await db
      .select({
        row: c,
        checklistCount: sql<number>`(select count(*)::int from checklist_items ci where ci.commitment_id = ${c.id})`,
        checklistDone: sql<number>`(select count(*)::int from checklist_items ci where ci.commitment_id = ${c.id} and ci.done)`,
      })
      .from(c)
      .where(and(eq(c.tripId, id), eq(c.orgId, orgId), ne(c.status, 'deleted')))
      .orderBy(asc(c.dueAt))

    // The trip day by day: each journey with when to leave for it, each stay
    // with its check-out, the way a trip is actually lived.
    const items: TripItemDTO[] = planned.map(({ row, checklistCount, checklistDone }) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      dueAt: row.dueAt.toISOString(),
      durationMinutes: row.durationMinutes,
      flexibility: row.flexibility,
      preferredWindow: row.preferredWindow as TripItemDTO['preferredWindow'],
      allDay: row.allDay,
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      status: row.status,
      priority: row.priority,
      notes: row.notes,
      booking: row.booking
        ? {
            type: row.booking.type,
            ref: row.booking.ref,
            provider: row.booking.provider,
            from: row.booking.from,
            city: row.booking.city,
            endsOn: row.booking.endsOn ?? null,
            leaveAt: ['flight', 'train', 'bus'].includes(row.booking.type)
              ? new Date(row.dueAt.getTime() - row.booking.remindBeforeMinutes * 60_000).toISOString()
              : null,
          }
        : null,
      checklistCount: Number(checklistCount),
      checklistDone: Number(checklistDone),
    }))

    return {
      trip: toDTO(trip),
      planned: items,
      waiting: await waitingFor(userId, trip.placeLabel),
    }
  })

  /**
   * The trip's packing list: a plan the evening before it starts, "Pack for
   * Goa", whose checklist is the list — made for this trip's nights, journeys
   * and purpose. Made once; asked again, the same one comes back.
   */
  app.post('/trips/:id/packing', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = req.params as { id: string }
    const { purpose } = z.object({ purpose: z.enum(['work', 'leisure']) }).parse(req.body)

    const [trip] = await db
      .select()
      .from(schema.trips)
      .where(and(eq(schema.trips.id, id), eq(schema.trips.orgId, orgId), eq(schema.trips.userId, userId)))
      .limit(1)
    if (!trip) return reply.code(404).send({ error: 'not_found' })

    if (trip.packingId) {
      const [existing] = await db
        .select({ id: schema.commitments.id })
        .from(schema.commitments)
        .where(and(eq(schema.commitments.id, trip.packingId), ne(schema.commitments.status, 'deleted')))
      if (existing) return { id: existing.id, created: false }
    }

    const journeys = await db
      .select({ booking: schema.commitments.booking })
      .from(schema.commitments)
      .where(and(eq(schema.commitments.tripId, id), sql`${schema.commitments.booking} is not null`))
    const modes = [
      ...new Set(
        journeys
          .map((j) => j.booking?.type)
          .filter((t): t is TravelMode => t === 'flight' || t === 'train' || t === 'bus'),
      ),
    ]
    const nights = Math.round(
      (new Date(`${trip.endsOn}T00:00:00`).getTime() - new Date(`${trip.startsOn}T00:00:00`).getTime()) / DAY_MS,
    )
    const items = packingItems({ nights, purpose, modes, international: isAbroad(trip.placeLabel) })

    // The evening before it starts, at eight; sooner if that has gone.
    const [y, m, d] = trip.startsOn.split('-').map(Number)
    const eve = new Date(y!, m! - 1, d! - 1, 20, 0)
    const now = new Date()
    const dueAt = eve.getTime() > now.getTime() + 30 * 60_000 ? eve : new Date(now.getTime() + 30 * 60_000)

    const created = await db.transaction(async (tx) => {
      const row = takeFirst(
        await tx
          .insert(schema.commitments)
          .values({
            orgId,
            userId,
            title: `Pack for ${trip.placeLabel}`,
            kind: 'task',
            dueAt,
            durationMinutes: 30,
            tripId: id,
            flexibility: 'fixed',
            sphere: purpose === 'work' ? 'work' : 'personal',
          })
          .returning(),
        'commitment',
      )
      await tx.insert(schema.checklistItems).values(items.map((text, position) => ({ orgId, commitmentId: row.id, text, position })))
      await scheduleFirstReminder({ orgId, commitmentId: row.id, fireAt: dueAt }, tx)
      await tx.update(schema.trips).set({ packingId: row.id }).where(eq(schema.trips.id, id))
      return row
    })
    return reply.code(201).send({ id: created.id, created: true, items: items.length })
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
