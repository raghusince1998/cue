import type { FastifyInstance } from 'fastify'
import { and, asc, desc, eq, gt, gte, lt, lte, ne, or, sql, isNull, isNotNull, inArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  COMMITMENT_KIND,
  DEFAULT_DURATION_MINUTES,
  FLEXIBILITY,
  PRIORITIES,
  TIME_WINDOWS,
  conflictCheckInput,
  rescheduleInput,
  snoozeInput,
  updateCommitmentInput,
  type CommitmentDTO,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { cancelPendingReminders, scheduleFirstReminder } from '../services/reminders.ts'
import { checkConflicts } from '../services/scheduling.ts'
import { findFreeSlots } from '../services/freeSlots.ts'
import { suggestSlots } from '../services/slots.ts'
import { detectLocationConflicts } from '../services/locationConflict.ts'
import { canBeOverdue, isAwaitingWrapUp, isCalendarHistory, managedByCue } from '../services/overdue.ts'
import { wrapUpMeeting } from '../services/wrapUp.ts'
import { prepOpenCount, relatedMeetings } from '../services/meetingPrep.ts'
import { activeFocus, heldCount } from '../services/focus.ts'
import { peopleSummary, personLinks } from '../services/people.ts'

const agendaQuery = z.object({
  /** Local day boundaries, supplied by the client which knows its timezone. */
  from: z.string().datetime(),
  to: z.string().datetime(),
})

const createCommitmentInput = z.object({
  title: z.string().min(1).max(300),
  kind: z.enum(COMMITMENT_KIND).default('task'),
  dueAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  placeId: z.string().uuid().nullable().optional(),
  contactId: z.string().uuid().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  allDay: z.boolean().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  placeLabel: z.string().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  flexibility: z.enum(FLEXIBILITY).default('fixed'),
  preferredWindow: z.enum(TIME_WINDOWS).nullable().optional(),
  deadline: z.string().datetime().nullable().optional(),
  priority: z.enum(PRIORITIES).default('normal'),
  allowConflict: z.boolean().optional(),
  /** Someone else's to do: a check-in date, which claims no time. */
  waitingOn: z.string().trim().min(1).max(100).nullable().optional(),
})

const selection = {
  id: schema.commitments.id,
  title: schema.commitments.title,
  kind: schema.commitments.kind,
  dueAt: schema.commitments.dueAt,
  durationMinutes: schema.commitments.durationMinutes,
  allDay: schema.commitments.allDay,
  endsAt: schema.commitments.endsAt,
  flexibility: schema.commitments.flexibility,
  preferredWindow: schema.commitments.preferredWindow,
  deadline: schema.commitments.deadline,
  priority: schema.commitments.priority,
  status: schema.commitments.status,
  escalationCount: schema.commitments.escalationCount,
  placeId: schema.commitments.placeId,
  placeName: schema.places.name,
  contactId: schema.commitments.contactId,
  // The linked contact wins; the interaction's free text is the fallback for
  // anything logged before contacts became real records.
  contactName: sql<string | null>`coalesce(${schema.contacts.name}, ${schema.interactions.contactName})`,
  contactPhone: schema.contacts.phone,
  recurrenceId: schema.commitments.recurrenceId,
  feedId: schema.commitments.feedId,
  waitingOn: schema.commitments.waitingOn,
  prepOpen: prepOpenCount(),
  history: isCalendarHistory(),
  fromTitle: sql<string | null>`(
    select f.title from commitments f where f.id = ${schema.commitments.fromCommitmentId}
  )`,
  scheduleTitle: sql<string | null>`(
    select s.title from schedules s where s.id = ${schema.commitments.scheduleId}
  )`,
  checklistCount: sql<number>`(
    select count(*)::int from checklist_items ci where ci.commitment_id = ${schema.commitments.id}
  )`,
  checklistDone: sql<number>`(
    select count(*)::int from checklist_items ci
    where ci.commitment_id = ${schema.commitments.id} and ci.done
  )`,
  notes: sql<
    string | null
  >`coalesce(${schema.commitments.notes}, ${schema.interactions.notes})`,
  createdAt: schema.commitments.createdAt,
}

type SelectedRow = {
  [K in keyof typeof selection]: unknown
}

function toDTO(row: SelectedRow): CommitmentDTO {
  return {
    id: row.id as string,
    title: row.title as string,
    kind: row.kind as CommitmentDTO['kind'],
    dueAt: (row.dueAt as Date).toISOString(),
    durationMinutes: row.durationMinutes as number,
    allDay: Boolean(row.allDay),
    endsAt: row.endsAt ? (row.endsAt as Date).toISOString() : null,
    flexibility: (row.flexibility as CommitmentDTO['flexibility']) ?? 'fixed',
    preferredWindow: (row.preferredWindow as CommitmentDTO['preferredWindow']) ?? null,
    deadline: row.deadline ? (row.deadline as Date).toISOString() : null,
    priority: (row.priority as CommitmentDTO['priority']) ?? 'normal',
    status: row.status as CommitmentDTO['status'],
    escalationCount: row.escalationCount as number,
    placeId: (row.placeId as string | null) ?? null,
    placeName: (row.placeName as string | null) ?? null,
    contactId: (row.contactId as string | null) ?? null,
    contactName: (row.contactName as string | null) ?? null,
    contactPhone: (row.contactPhone as string | null) ?? null,
    recurrenceId: (row.recurrenceId as string | null) ?? null,
    feedId: (row.feedId as string | null) ?? null,
    waitingOn: (row.waitingOn as string | null) ?? null,
    prepOpen: Number(row.prepOpen ?? 0),
    history: Boolean(row.history),
    scheduleTitle: (row.scheduleTitle as string | null) ?? null,
    fromTitle: (row.fromTitle as string | null) ?? null,
    checklistCount: Number(row.checklistCount ?? 0),
    checklistDone: Number(row.checklistDone ?? 0),
    notes: (row.notes as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
  }
}

export async function commitmentRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  function baseQuery() {
    return db
      .select(selection)
      .from(schema.commitments)
      .leftJoin(schema.places, eq(schema.places.id, schema.commitments.placeId))
      .leftJoin(schema.interactions, eq(schema.interactions.id, schema.commitments.interactionId))
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.commitments.contactId))
  }

  /**
   * Everything overlapping a window, for the calendar views.
   *
   * Separate from /agenda rather than a parameter on it: the agenda answers
   * "what needs me now" and deliberately caps what is ahead, while a month
   * grid needs every single item in its range or it draws a lie.
   */
  app.get('/commitments/range', async (req) => {
    const { orgId } = scope(req)
    const { from, to } = z
      .object({ from: z.string().datetime(), to: z.string().datetime() })
      .parse(req.query)

    const start = new Date(from)
    const end = new Date(to)

    const rows = await baseQuery()
      .where(
        and(
          eq(schema.commitments.orgId, orgId),
          // Cancelled stays on the grid, struck through: that is how you
          // know the slot is free and why. Only a deleted item is hidden.
          ne(schema.commitments.status, 'deleted'),
          // A multi-day item belongs to every day it covers, so the test is
          // overlap, not "starts inside the window".
          lte(schema.commitments.dueAt, end),
          or(
            gte(schema.commitments.dueAt, start),
            gte(schema.commitments.endsAt, start),
          ),
        ),
      )
      .orderBy(asc(schema.commitments.dueAt))
      .limit(2000)

    // Trips live in their own table and were never fetched here, so a planned
    // trip was invisible on the very screens whose job is to show what a day
    // holds. A trip is the strongest kind of "that day is spoken for" the app
    // knows about; leaving it off the grid made the grid wrong.
    const { sub: userId } = scope(req)
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

    const trips = await db
      .select({
        id: schema.trips.id,
        placeLabel: schema.trips.placeLabel,
        startsOn: schema.trips.startsOn,
        endsOn: schema.trips.endsOn,
        strictness: schema.trips.strictness,
        status: schema.trips.status,
      })
      .from(schema.trips)
      .where(
        and(
          eq(schema.trips.userId, userId),
          ne(schema.trips.status, 'cancelled'),
          // Overlap, so a trip already under way still shows on today.
          lte(schema.trips.startsOn, day(end)),
          gte(schema.trips.endsOn, day(start)),
        ),
      )
      .orderBy(asc(schema.trips.startsOn))

    return { commitments: rows.map(toDTO), trips }
  })

  /**
   * One call powers the whole Today screen. `overdue` is the important bucket:
   * it has no lower bound in time, so a commitment dropped three weeks ago is
   * still sitting there staring at you.
   */
  app.get('/commitments/agenda', async (req) => {
    const { orgId, sub: userId } = scope(req)
    const { from, to } = agendaQuery.parse(req.query)
    const now = new Date()
    const mine = eq(schema.commitments.orgId, orgId)
    const pending = eq(schema.commitments.status, 'pending')

    // Waiting-on items have their own list; the others leave them out.
    const own = isNull(schema.commitments.waitingOn)
    const [overdue, today, upcoming, doneToday, justFinished, waiting] = await Promise.all([
      baseQuery()
        .where(and(mine, pending, own, canBeOverdue(now), lt(schema.commitments.dueAt, now)))
        .orderBy(asc(schema.commitments.dueAt)),
      baseQuery()
        .where(
          and(
            mine,
            pending,
            own,
            gte(schema.commitments.dueAt, now),
            lte(schema.commitments.dueAt, new Date(to)),
          ),
        )
        .orderBy(asc(schema.commitments.dueAt)),
      baseQuery()
        .where(and(mine, pending, own, gt(schema.commitments.dueAt, new Date(to))))
        .orderBy(asc(schema.commitments.dueAt))
        .limit(20),
      baseQuery()
        .where(
          and(
            mine,
            // Closed today covers both ways of closing something. Cancelling
            // from Today used to make the card vanish mid-screen, which reads
            // as a bug however deliberate the tap was.
            or(
              and(
                eq(schema.commitments.status, 'done'),
                gte(schema.commitments.completedAt, new Date(from)),
              ),
              and(
                eq(schema.commitments.status, 'cancelled'),
                gte(schema.commitments.cancelledAt, new Date(from)),
              ),
            ),
          ),
        )
        .orderBy(asc(schema.commitments.dueAt)),
      // Meetings under way or ended this week, waiting for "any follow-ups?".
      baseQuery()
        .where(
          and(
            mine,
            pending,
            managedByCue(),
            isAwaitingWrapUp(now),
            lt(schema.commitments.dueAt, now),
          ),
        )
        .orderBy(desc(schema.commitments.dueAt))
        .limit(30),
      // Everything other people owe you, soonest check-in first.
      baseQuery()
        .where(and(mine, pending, isNotNull(schema.commitments.waitingOn)))
        .orderBy(asc(schema.commitments.dueAt))
        .limit(50),
    ])

    // Focus time under way: it started before now, so no other bucket has it.
    const active = await activeFocus(userId, now)
    const [activeBlock] = active
      ? await baseQuery().where(eq(schema.commitments.id, active.id)).limit(1)
      : []

    return {
      overdue: overdue.map(toDTO),
      justFinished: justFinished.map(toDTO),
      waiting: waiting.map(toDTO),
      focus: {
        active: activeBlock ? toDTO(activeBlock) : null,
        held: activeBlock ? await heldCount(userId) : 0,
      },
      today: today.map(toDTO),
      upcoming: upcoming.map(toDTO),
      doneToday: doneToday.map(toDTO),
    }
  })

  /**
   * Called by the capture screen as soon as a time is picked, so the clash is
   * shown while the user is still deciding rather than after they hit save.
   */
  app.post('/commitments/check-conflicts', async (req) => {
    const { sub: userId } = scope(req)
    const body = conflictCheckInput.parse(req.body)
    const startsAt = new Date(body.dueAt)

    // Where-based problems apply even to an all-day item: a three-day trip to
    // Jaipur during your Mathura week is exactly the case worth catching.
    const locationConflicts = await detectLocationConflicts(userId, {
      startsAt,
      durationMinutes: body.durationMinutes,
      placeLabel: body.placeLabel ?? null,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      excludeCommitmentId: body.excludeId,
    })

    if (body.allDay) return { conflicts: [], suggestions: [], locationConflicts }

    const timing = await checkConflicts(
      userId,
      {
        startsAt,
        durationMinutes: body.durationMinutes,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
      },
      body.excludeId,
    )
    return { ...timing, locationConflicts }
  })

  /**
   * "You are free at 3:20 — shall I put the plumber call there?"
   *
   * The payoff for recording something as flexible: the app can propose a real
   * gap instead of leaving a vague intention sitting in a list.
   */
  app.post('/commitments/suggest-slots', async (req) => {
    const { sub: userId } = scope(req)
    const body = z
      .object({
        day: z.string().datetime(),
        window: z.enum(TIME_WINDOWS),
        durationMinutes: z.number().int().min(5).max(480).default(15),
      })
      .parse(req.body)

    const rows = await db
      .select({ timeWindows: schema.users.timeWindows })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)

    return {
      slots: await suggestSlots({
        userId,
        day: new Date(body.day),
        window: body.window,
        durationMinutes: body.durationMinutes,
        customWindows: (rows[0]?.timeWindows ?? null) as never,
      }),
    }
  })

  app.post('/commitments', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const body = createCommitmentInput.parse(req.body)
    const dueAt = new Date(body.dueAt)
    const durationMinutes = body.durationMinutes ?? DEFAULT_DURATION_MINUTES[body.kind]

    // Re-checked here even though the UI already asked: the pre-check and the
    // save are separate requests, so something else could have taken the slot
    // in between.
    const endsAt = body.endsAt ? new Date(body.endsAt) : null
    if (endsAt && endsAt <= dueAt) {
      return reply.code(400).send({ error: 'ends_before_it_starts' })
    }

    // Neither an all-day item nor a flexible one claims a slot, so there is
    // nothing for them to clash with.
    if (!body.allowConflict && !body.allDay && body.flexibility === 'fixed' && !body.waitingOn) {
      const report = await checkConflicts(userId, { startsAt: dueAt, durationMinutes, endsAt })
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
            title: body.title,
            kind: body.kind,
            waitingOn: body.waitingOn ?? null,
            dueAt,
            durationMinutes,
            placeId: body.placeId ?? null,
            contactId: body.contactId ?? null,
            notes: body.notes ?? null,
            allDay: body.allDay ?? false,
            endsAt,
            placeLabel: body.placeLabel ?? null,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            flexibility: body.flexibility,
            preferredWindow: body.preferredWindow ?? null,
            deadline: body.deadline ? new Date(body.deadline) : null,
            priority: body.priority,
          })
          .returning(),
        'commitment',
      )
      await scheduleFirstReminder({ orgId, commitmentId: created.id, fireAt: dueAt }, tx)
      return created
    })

    return reply.code(201).send(commitment)
  })

  async function owned(orgId: string, id: string) {
    const rows = await db
      .select()
      .from(schema.commitments)
      .where(and(eq(schema.commitments.id, id), eq(schema.commitments.orgId, orgId)))
      .limit(1)
    return rows[0]
  }

  /** Single commitment, for populating the edit form. */
  /**
   * Where this could go instead.
   *
   * An overdue card offered Done, three snoozes and Edit. Snoozing something
   * by fifteen minutes is exactly what has already failed — four times, in the
   * case that prompted this — and Edit means a form. What a late but important
   * thing needs is a real time, chosen from times that are genuinely free.
   */
  app.get('/commitments/:id/slots', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const [row] = await db
      .select({
        id: schema.commitments.id,
        durationMinutes: schema.commitments.durationMinutes,
        preferredWindow: schema.commitments.preferredWindow,
      })
      .from(schema.commitments)
      .where(and(eq(schema.commitments.id, id), eq(schema.commitments.orgId, orgId)))
      .limit(1)

    if (!row) return reply.code(404).send({ error: 'not_found' })

    // The item being moved must not count as busy against itself, or its own
    // old time blocks the best answer.
    const slots = await findFreeSlots(userId, row.durationMinutes, 3, {
      excludeId: row.id,
      window: row.preferredWindow as never,
    })

    // A window it asked for but cannot have should not mean no answer at all;
    // better to offer a time outside it and say so.
    const relaxed =
      slots.length === 0 && row.preferredWindow
        ? await findFreeSlots(userId, row.durationMinutes, 3, { excludeId: row.id })
        : []

    return {
      slots: (slots.length > 0 ? slots : relaxed).map((d) => d.toISOString()),
      durationMinutes: row.durationMinutes,
      preferredWindow: row.preferredWindow,
      outsideWindow: slots.length === 0 && relaxed.length > 0,
    }
  })

  app.get('/commitments/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }

    const rows = await baseQuery()
      .where(and(eq(schema.commitments.orgId, orgId), eq(schema.commitments.id, id)))
      .limit(1)

    const row = rows[0]
    if (!row) return reply.code(404).send({ error: 'not_found' })
    return toDTO(row)
  })

  /**
   * Partial edit. Only the fields present in the body change, so the client can
   * send just what the user touched.
   */
  app.patch('/commitments/:id', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = req.params as { id: string }
    const body = updateCommitmentInput.parse(req.body)

    const existing = await owned(orgId, id)
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    const dueAt = body.dueAt ? new Date(body.dueAt) : existing.dueAt
    const durationMinutes = body.durationMinutes ?? existing.durationMinutes
    const status = body.status ?? existing.status

    const timingChanged =
      dueAt.getTime() !== existing.dueAt.getTime() ||
      durationMinutes !== existing.durationMinutes
    const statusChanged = status !== existing.status

    // Only worth checking if it will actually occupy a slot afterwards.
    if (timingChanged && status === 'pending' && !body.allowConflict) {
      const report = await checkConflicts(userId, { startsAt: dueAt, durationMinutes }, id)
      if (report.conflicts.length > 0) {
        return reply.code(409).send({ error: 'time_conflict', ...report })
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.commitments)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.kind !== undefined ? { kind: body.kind } : {}),
          ...(body.placeId !== undefined ? { placeId: body.placeId } : {}),
          ...(body.contactId !== undefined ? { contactId: body.contactId } : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.allDay !== undefined ? { allDay: body.allDay } : {}),
          ...(body.flexibility !== undefined ? { flexibility: body.flexibility } : {}),
          ...(body.preferredWindow !== undefined
            ? { preferredWindow: body.preferredWindow }
            : {}),
          ...(body.deadline !== undefined
            ? { deadline: body.deadline ? new Date(body.deadline) : null }
            : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.endsAt !== undefined
            ? { endsAt: body.endsAt ? new Date(body.endsAt) : null }
            : {}),
          dueAt,
          durationMinutes,
          status,
          // Moving a commitment forgives its history — you are not "3 hours
          // late" for a time you just changed.
          ...(timingChanged ? { escalationCount: 0 } : {}),
          // Each terminal state records the moment it was decided, because
          // that — not the due time — is when it happened. Reopening clears
          // both, so a reopened item leaves History entirely.
          ...(statusChanged
            ? {
                completedAt: status === 'done' ? new Date() : null,
                cancelledAt: status === 'cancelled' ? new Date() : null,
              }
            : {}),
        })
        .where(eq(schema.commitments.id, id))

      if (!timingChanged && !statusChanged) return

      await cancelPendingReminders(id, tx)
      // Only a pending commitment gets a fresh chain; done and cancelled stay quiet.
      if (status === 'pending') {
        await scheduleFirstReminder({ orgId, commitmentId: id, fireAt: dueAt }, tx)
      }
    })

    const rows = await baseQuery()
      .where(and(eq(schema.commitments.orgId, orgId), eq(schema.commitments.id, id)))
      .limit(1)
    return toDTO(takeFirst(rows, 'commitment'))
  })

  /**
   * Soft delete: off every list, still in the record.
   *
   * This used to wipe the row, which made deleting the one action in the app
   * that could not be looked back on. What somebody repeatedly abandons is
   * worth being able to see, so the row stays and History shows it as "let go".
   *
   * Deliberately different from cancelling. Cancelled means the thing still
   * exists and is still on Tuesday's calendar with a line through it; deleted
   * means take it off my lists. Both are remembered, under different words.
   *
   * The one place a hard delete survives is Undo straight after capture
   * (`DELETE /quick/:kind/:id`) — undoing a two-second-old mistake should not
   * leave a trail.
   */
  app.delete('/commitments/:id', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    await db.transaction(async (tx) => {
      await tx
        .update(schema.commitments)
        .set({ status: 'deleted', deletedAt: new Date() })
        .where(eq(schema.commitments.id, id))
      await cancelPendingReminders(id, tx)
    })
    return { ok: true }
  })

  app.post('/commitments/:id/done', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    await db.transaction(async (tx) => {
      await tx
        .update(schema.commitments)
        .set({ status: 'done', completedAt: new Date() })
        .where(eq(schema.commitments.id, id))
      await cancelPendingReminders(id, tx)
    })

    return { ok: true }
  })

  /** For the People list: what is open with each person, and names not yet saved. */
  app.get('/people/summary', async (req) => {
    const { orgId, sub: userId } = scope(req)
    return peopleSummary(orgId, userId)
  })

  /** One person: what they owe you, what you owe them, your meetings, history. */
  app.get('/people/:id/overview', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const links = await personLinks(orgId, userId, id)
    if (!links) return reply.code(404).send({ error: 'not_found' })

    const ids = [
      ...links.waitingOnThem,
      ...links.youOwe,
      ...links.nextMeetings,
      ...(links.lastMeeting ? [links.lastMeeting] : []),
      ...links.lastMeetingFollowUps,
    ]
    const rows = ids.length
      ? await baseQuery().where(inArray(schema.commitments.id, [...new Set(ids)]))
      : []
    const byId = new Map(rows.map((r) => [r.id as string, toDTO(r)]))
    const pick = (list: string[]) => list.map((x) => byId.get(x)).filter(Boolean)

    return {
      waitingOnThem: pick(links.waitingOnThem),
      youOwe: pick(links.youOwe),
      nextMeetings: pick(links.nextMeetings),
      lastMeeting: links.lastMeeting ? (byId.get(links.lastMeeting) ?? null) : null,
      lastMeetingFollowUps: pick(links.lastMeetingFollowUps),
      meetingCount: links.meetingCount,
      firstMet: links.firstMet ? links.firstMet.toISOString() : null,
    }
  })

  /**
   * Prep for a meeting: the last related meeting, what is still open from all
   * the earlier ones, and what from the last one has been done since.
   */
  app.get('/commitments/:id/prep', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const related = await relatedMeetings(userId, id)
    if (!related) return reply.code(404).send({ error: 'not_found' })

    const ids = related.map((m) => m.id)
    const last = related[0] ?? null
    const open = ids.length
      ? await baseQuery()
          .where(
            and(
              inArray(schema.commitments.fromCommitmentId, ids),
              eq(schema.commitments.status, 'pending'),
            ),
          )
          .orderBy(asc(schema.commitments.dueAt))
      : []
    const done = last
      ? await baseQuery()
          .where(
            and(
              eq(schema.commitments.fromCommitmentId, last.id),
              eq(schema.commitments.status, 'done'),
            ),
          )
          .orderBy(asc(schema.commitments.dueAt))
      : []

    return {
      last: last ? { id: last.id, title: last.title, dueAt: last.dueAt.toISOString() } : null,
      earlierCount: related.length,
      open: open.map(toDTO),
      doneSinceLast: done.map(toDTO),
    }
  })

  /**
   * Wrapping up a meeting: what came out of it becomes plans of their own, and
   * the meeting is done. An empty list is "nothing came out of it".
   */
  app.post('/commitments/:id/wrap-up', async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const { items } = z
      .object({
        items: z
          .array(
            z.object({
              title: z.string().min(1).max(300),
              waitingOn: z.string().max(100).nullable().optional(),
              dueAt: z.string().datetime(),
            }),
          )
          .max(20),
      })
      .parse(req.body)
    const result = await wrapUpMeeting(userId, id, items)
    if (!result) return reply.code(404).send({ error: 'not_found' })
    return result
  })

  app.post('/commitments/:id/cancel', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    await db.transaction(async (tx) => {
      await tx
        .update(schema.commitments)
        .set({ status: 'cancelled', cancelledAt: new Date() })
        .where(eq(schema.commitments.id, id))
      await cancelPendingReminders(id, tx)
    })

    return { ok: true }
  })

  /**
   * Snoozing resets the escalation chain rather than clearing it: the item
   * comes back at the new time and starts chasing again from attempt zero.
   */
  app.post('/commitments/:id/snooze', async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = req.params as { id: string }
    const { minutes } = snoozeInput.parse(req.body)

    if (!(await owned(orgId, id))) return reply.code(404).send({ error: 'not_found' })

    const nextDue = new Date(Date.now() + minutes * 60_000)

    await db.transaction(async (tx) => {
      await cancelPendingReminders(id, tx)
      await tx
        .update(schema.commitments)
        .set({ dueAt: nextDue, status: 'pending', escalationCount: 0 })
        .where(eq(schema.commitments.id, id))
      await scheduleFirstReminder({ orgId, commitmentId: id, fireAt: nextDue }, tx)
    })

    return { ok: true, dueAt: nextDue.toISOString() }
  })

  /**
   * Move an existing commitment to an absolute time. This is the "shift the
   * other one" branch of a clash — snooze only ever pushes forward from now,
   * which is the wrong tool when you are rearranging a day.
   */
  app.post('/commitments/:id/reschedule', async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = req.params as { id: string }
    const body = rescheduleInput.parse(req.body)

    const commitment = await owned(orgId, id)
    if (!commitment) return reply.code(404).send({ error: 'not_found' })

    const dueAt = new Date(body.dueAt)
    const durationMinutes = body.durationMinutes ?? commitment.durationMinutes

    if (!body.allowConflict) {
      // Exclude itself, or moving something by five minutes would always
      // report a clash with its own old slot.
      const report = await checkConflicts(userId, { startsAt: dueAt, durationMinutes }, id)
      if (report.conflicts.length > 0) {
        return reply.code(409).send({ error: 'time_conflict', ...report })
      }
    }

    await db.transaction(async (tx) => {
      await cancelPendingReminders(id, tx)
      await tx
        .update(schema.commitments)
        .set({ dueAt, durationMinutes, status: 'pending', escalationCount: 0 })
        .where(eq(schema.commitments.id, id))
      await scheduleFirstReminder({ orgId, commitmentId: id, fireAt: dueAt }, tx)
    })

    return { ok: true, dueAt: dueAt.toISOString() }
  })

  /** Diagnostic: how many buzzes are queued and when the next one lands. */
  app.get('/commitments/queue', async (req) => {
    const { orgId } = scope(req)
    const rows = await db
      .select({
        pending: sql<number>`count(*) filter (where ${schema.reminders.status} = 'pending')`,
        nextFireAt: sql<
          Date | null
        >`min(${schema.reminders.fireAt}) filter (where ${schema.reminders.status} = 'pending')`,
      })
      .from(schema.reminders)
      .where(eq(schema.reminders.orgId, orgId))

    return takeFirst(rows, 'queue stats')
  })
}
