import type { FastifyInstance } from 'fastify'
import { and, asc, count, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createRecurrenceInput,
  updateRecurrenceInput,
  describeRecurrence,
  type CommitmentKind,
  type Lang,
  type Priority,
  type RecurrenceDTO,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { langOf } from '../i18n.ts'
import { anchorOf, detach, materialise, regenerate, ruleOf, stopSeries } from '../services/recurrence.ts'

type RecurrenceRow = typeof schema.recurrences.$inferSelect

function toDTO(
  row: RecurrenceRow,
  extra: { placeName?: string | null; nextAt?: Date | null; upcomingCount?: number } = {},
  lang: Lang = 'en',
): RecurrenceDTO {
  const rule = ruleOf(row)
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as CommitmentKind,
    notes: row.notes,
    durationMinutes: row.durationMinutes,
    priority: row.priority as Priority,
    placeId: row.placeId,
    placeName: extra.placeName ?? null,
    placeLabel: row.placeLabel,
    contactId: row.contactId,
    startsOn: row.startsOn,
    hour: row.hour,
    minute: row.minute,
    rule,
    status: row.status,
    summary: describeRecurrence(rule, anchorOf(row), lang),
    nextAt: extra.nextAt ? extra.nextAt.toISOString() : null,
    upcomingCount: extra.upcomingCount ?? 0,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * What is actually still ahead, read from the generated commitments rather
 * than recomputed from the rule. They can differ — an occurrence completed
 * early or detached and moved — and what the user has is the truth.
 */
async function upcoming(recurrenceId: string, now: Date) {
  const rows = await db
    .select({ dueAt: schema.commitments.dueAt })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.recurrenceId, recurrenceId),
        eq(schema.commitments.status, 'pending'),
        gte(schema.commitments.dueAt, now),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  return { nextAt: rows[0]?.dueAt ?? null, upcomingCount: rows.length }
}

export async function recurrenceRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  async function own(id: string, userId: string): Promise<RecurrenceRow | null> {
    const [row] = await db
      .select()
      .from(schema.recurrences)
      .where(and(eq(schema.recurrences.id, id), eq(schema.recurrences.userId, userId)))
      .limit(1)
    return row ?? null
  }

  app.get('/recurrences', async (req) => {
    const { sub: userId } = scope(req)
    const now = new Date()
    const lang = await langOf(userId)

    const rows = await db
      .select({ r: schema.recurrences, placeName: schema.places.name })
      .from(schema.recurrences)
      .leftJoin(schema.places, eq(schema.places.id, schema.recurrences.placeId))
      .where(eq(schema.recurrences.userId, userId))
      .orderBy(asc(schema.recurrences.createdAt))

    return {
      recurrences: await Promise.all(
        rows.map(async ({ r, placeName }) =>
          toDTO(r, { placeName, ...(await upcoming(r.id, now)) }, lang),
        ),
      ),
    }
  })

  app.post('/recurrences', async (req, reply) => {
    const { sub: userId, orgId } = scope(req)
    const input = createRecurrenceInput.parse(req.body)
    const { rule, ...rest } = input

    const row = await db.transaction(async (tx) => {
      const created = takeFirst(
        await tx
          .insert(schema.recurrences)
          .values({
            orgId,
            userId,
            ...rest,
            notes: rest.notes ?? null,
            placeId: rest.placeId ?? null,
            contactId: rest.contactId ?? null,
            placeLabel: rest.placeLabel ?? null,
            freq: rule.freq,
            interval: rule.interval,
            byWeekday: rule.byWeekday ?? null,
            byMonthDay: rule.byMonthDay ?? null,
            byMonth: rule.byMonth ?? null,
            setPos: rule.setPos ?? null,
            untilOn: rule.until ?? null,
            count: rule.count ?? null,
          })
          .returning(),
        'recurrence',
      )

      // Generate straight away rather than waiting for the sweep: the user is
      // looking at the screen now and expects to see the dates appear.
      await materialise(created, {}, tx)
      return created
    })

    return reply.code(201).send({ recurrence: toDTO(row, await upcoming(row.id, new Date()), await langOf(userId)) })
  })

  app.get('/recurrences/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const row = await own(id, userId)
    if (!row) return reply.code(404).send({ error: 'not_found' })

    const occurrences = await db
      .select({
        id: schema.commitments.id,
        dueAt: schema.commitments.dueAt,
        status: schema.commitments.status,
        detached: schema.commitments.detached,
        title: schema.commitments.title,
      })
      .from(schema.commitments)
      .where(eq(schema.commitments.recurrenceId, id))
      .orderBy(asc(schema.commitments.dueAt))

    return {
      recurrence: toDTO(row, await upcoming(id, new Date()), await langOf(userId)),
      occurrences: occurrences.map((o) => ({
        id: o.id,
        title: o.title,
        dueAt: o.dueAt.toISOString(),
        status: o.status,
        detached: o.detached,
      })),
    }
  })

  /**
   * Editing the series. Everything still ahead and untouched is rebuilt from
   * the new rule; the past, and any occurrence the user moved by hand, is left
   * alone.
   */
  app.patch('/recurrences/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const input = updateRecurrenceInput.parse(req.body)

    const existing = await own(id, userId)
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const { rule, ...rest } = input

    const row = await db.transaction(async (tx) => {
      const updated = takeFirst(
        await tx
          .update(schema.recurrences)
          .set({
            ...rest,
            ...(rule
              ? {
                  freq: rule.freq,
                  interval: rule.interval,
                  byWeekday: rule.byWeekday ?? null,
                  byMonthDay: rule.byMonthDay ?? null,
                  byMonth: rule.byMonth ?? null,
                  setPos: rule.setPos ?? null,
                  untilOn: rule.until ?? null,
                  count: rule.count ?? null,
                }
              : {}),
          })
          .where(eq(schema.recurrences.id, id))
          .returning(),
        'recurrence',
      )

      await regenerate(updated, {}, tx)
      return updated
    })

    return { recurrence: toDTO(row, await upcoming(id, new Date()), await langOf(userId)) }
  })

  /**
   * Ending a series. Future untouched occurrences go; the ones already done
   * stay, because eight attended classes are still eight attended classes.
   */
  app.delete('/recurrences/:id', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const existing = await own(id, userId)
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const [{ value: kept } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.commitments)
      .where(
        // Occurrences already acted on are kept when the series stops.
        // One deleted is not kept, and counting it overstates what
        // stopping the series leaves behind.
        and(
          eq(schema.commitments.recurrenceId, id),
          sql`${schema.commitments.status} not in ('pending', 'deleted')`,
        ),
      )

    await stopSeries(id)
    return { ok: true, keptOccurrences: kept }
  })

  /** "Change just this one" — the occurrence stops following the series. */
  app.post('/recurrences/:id/detach/:commitmentId', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id, commitmentId } = z
      .object({ id: z.string().uuid(), commitmentId: z.string().uuid() })
      .parse(req.params)

    if (!(await own(id, userId))) return reply.code(404).send({ error: 'not_found' })

    await detach(commitmentId)
    return { ok: true }
  })
}
