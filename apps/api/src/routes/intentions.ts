import type { FastifyInstance } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createIntentionInput,
  scheduleIntentionInput,
  updateIntentionInput,
  type IntentionDTO,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { scheduleFirstReminder } from '../services/reminders.ts'
import { checkConflicts } from '../services/scheduling.ts'
import { geocode, haversineKm } from '../services/travel.ts'

type Row = typeof schema.intentions.$inferSelect

function toDTO(row: Row): IntentionDTO {
  return {
    id: row.id,
    placeLabel: row.placeLabel,
    placeId: row.placeId,
    title: row.title,
    notes: row.notes,
    preferredWindow: row.preferredWindow as IntentionDTO['preferredWindow'],
    durationMinutes: row.durationMinutes,
    priority: row.priority as IntentionDTO['priority'],
    status: row.status as IntentionDTO['status'],
    commitmentId: row.commitmentId,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function intentionRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /**
   * The wishlist. Grouped by place on the client, because "everything I want to
   * do in Mathura" is the only way anyone ever wants to read this.
   */
  app.get('/intentions', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const { status } = req.query as { status?: string }

    const rows = await db
      .select()
      .from(schema.intentions)
      .where(
        and(
          eq(schema.intentions.orgId, orgId),
          eq(schema.intentions.userId, userId),
          status ? eq(schema.intentions.status, status) : undefined,
        ),
      )
      .orderBy(asc(schema.intentions.placeLabel), asc(schema.intentions.createdAt))

    return rows.map(toDTO)
  })

  /**
   * "You are near Mathura — here is what you saved for it."
   *
   * The other half of a place-bound wish. Creating a trip surfaces them ahead
   * of time; this surfaces them when you actually turn up, which is the moment
   * the peda shop is in front of you.
   *
   * Only works while the app is open: a browser cannot watch location in the
   * background, and pretending otherwise would be a lie. Distinct places are
   * geocoded once each and cached, so this is cheap to call on every open.
   */
  app.post('/intentions/nearby', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const { lat, lng, radiusKm } = z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        // A city is big; 40 km means "you are in Mathura", not "on this street".
        radiusKm: z.number().min(1).max(200).default(40),
      })
      .parse(req.body)

    const saved = await db
      .select()
      .from(schema.intentions)
      .where(
        and(
          eq(schema.intentions.orgId, orgId),
          eq(schema.intentions.userId, userId),
          eq(schema.intentions.status, 'saved'),
        ),
      )

    if (saved.length === 0) return { near: [] }

    // One geocode per distinct place, not one per wish.
    const places = [...new Set(saved.map((i) => i.placeLabel))]
    const resolved = new Map<string, { lat: number; lng: number } | null>()
    for (const place of places) {
      resolved.set(place, await geocode(place))
    }

    const near = saved
      .map((intention) => {
        const at = resolved.get(intention.placeLabel)
        if (!at) return null
        const km = haversineKm(lat, lng, at.lat, at.lng)
        return km <= radiusKm ? { intention: toDTO(intention), distanceKm: Math.round(km) } : null
      })
      .filter((x): x is { intention: IntentionDTO; distanceKm: number } => x !== null)
      .sort((a, b) => a.distanceKm - b.distanceKm)

    return { near }
  })

  app.post('/intentions', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = createIntentionInput.parse(req.body)

    const created = takeFirst(
      await db
        .insert(schema.intentions)
        .values({
          orgId,
          userId,
          placeLabel: body.placeLabel.trim(),
          placeId: body.placeId ?? null,
          title: body.title.trim(),
          notes: body.notes ?? null,
          preferredWindow: body.preferredWindow ?? null,
          durationMinutes: body.durationMinutes,
          priority: body.priority,
        })
        .returning(),
      'intention',
    )

    // Tell the caller whether this is already relevant — there may be a trip
    // to that place on the books already.
    const trips = await db
      .select({ id: schema.trips.id, startsOn: schema.trips.startsOn })
      .from(schema.trips)
      .where(
        and(
          eq(schema.trips.userId, userId),
          sql`lower(${schema.trips.placeLabel}) = lower(${created.placeLabel})`,
        ),
      )
      .orderBy(asc(schema.trips.startsOn))

    return reply.code(201).send({ intention: toDTO(created), matchingTrips: trips })
  })

  app.patch('/intentions/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const body = updateIntentionInput.parse(req.body)

    const result = await db
      .update(schema.intentions)
      .set({
        ...(body.placeLabel !== undefined ? { placeLabel: body.placeLabel.trim() } : {}),
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.preferredWindow !== undefined
          ? { preferredWindow: body.preferredWindow }
          : {}),
        ...(body.durationMinutes !== undefined
          ? { durationMinutes: body.durationMinutes }
          : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      })
      .where(and(eq(schema.intentions.id, id), eq(schema.intentions.orgId, orgId)))
      .returning()

    if (result.length === 0) return reply.code(404).send({ error: 'not_found' })
    return toDTO(takeFirst(result, 'intention'))
  })

  app.delete('/intentions/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const result = await db
      .delete(schema.intentions)
      .where(and(eq(schema.intentions.id, id), eq(schema.intentions.orgId, orgId)))
      .returning({ id: schema.intentions.id })

    if (result.length === 0) return reply.code(404).send({ error: 'not_found' })
    return { ok: true }
  })

  /**
   * The moment a wish becomes a plan.
   *
   * Defaults to flexible, because "visit the temple one evening" is exactly the
   * kind of thing that should not be pinned to 6:00 PM against the user's will.
   */
  app.post('/intentions/:id/schedule', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = req.params as { id: string }
    const body = scheduleIntentionInput.parse(req.body)

    const rows = await db
      .select()
      .from(schema.intentions)
      .where(and(eq(schema.intentions.id, id), eq(schema.intentions.orgId, orgId)))
      .limit(1)

    const intention = rows[0]
    if (!intention) return reply.code(404).send({ error: 'not_found' })
    if (intention.status === 'scheduled' && intention.commitmentId) {
      return reply.code(409).send({ error: 'already_scheduled', commitmentId: intention.commitmentId })
    }

    const dueAt = new Date(body.dueAt)
    const durationMinutes = body.durationMinutes ?? intention.durationMinutes

    // Only a fixed placement can clash; a flexible one is still an intention.
    if (body.flexibility === 'fixed' && !body.allowConflict) {
      const report = await checkConflicts(userId, { startsAt: dueAt, durationMinutes })
      if (report.conflicts.length > 0) {
        return reply.code(409).send({ error: 'time_conflict', ...report })
      }
    }

    const commitment = await db.transaction(async (tx) => {
      const created = takeFirst(
        await tx
          .insert(schema.commitments)
          .values({
            orgId,
            userId,
            title: intention.title,
            kind: 'task',
            notes: intention.notes,
            dueAt,
            durationMinutes,
            placeId: intention.placeId,
            tripId: body.tripId ?? null,
            flexibility: body.flexibility,
            preferredWindow: intention.preferredWindow,
            priority: intention.priority,
          })
          .returning(),
        'commitment',
      )

      await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: dueAt }, tx)

      await tx
        .update(schema.intentions)
        .set({ status: 'scheduled', commitmentId: created.id })
        .where(eq(schema.intentions.id, id))

      return created
    })

    return reply.code(201).send({ commitmentId: commitment.id })
  })
}
