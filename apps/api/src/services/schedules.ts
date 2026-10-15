import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { offsetLabel, stepDate, type CreateScheduleInput, type ScheduleDTO } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * Booking a schedule, reading its progress, and stopping what is left of it.
 *
 * Every step is booked up front as an ordinary commitment. A vaccination
 * schedule runs for years, but it is a dozen rows, not the hundreds an open
 * repeating rule would generate, and booking them all means each one shows
 * on the calendar, reminds on its day, and can be moved on its own when the
 * doctor says "come back next week instead".
 */

function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export interface CreatedSchedule {
  schedule: ScheduleDTO
  booked: number
  /** Steps whose date had already passed, so were not booked. */
  skippedPast: number
}

export async function createSchedule(
  orgId: string,
  userId: string,
  input: CreateScheduleInput,
  now = new Date(),
): Promise<CreatedSchedule> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.schedules)
      .values({ orgId, userId, title: input.title.trim(), startsOn: input.startsOn })
      .returning()
    if (!row) throw new Error('could not save the schedule')

    let booked = 0
    let skippedPast = 0

    for (const step of input.steps) {
      const ymd = stepDate(input.startsOn, step)
      if (!ymd) continue
      const [y, m, d] = ymd.split('-').map(Number)
      const dueAt = new Date(y!, m! - 1, d!, input.hour, input.minute)

      // Anything already past is not booked: it would be overdue the moment
      // it was made, and Cue cannot know whether it happened.
      if (dueAt.getTime() < now.getTime()) {
        skippedPast += 1
        continue
      }

      // The card has to make sense on its own in the Today list, months from
      // now, without the schedule beside it.
      const what =
        step.title?.trim() || (step.offset ? offsetLabel(step.offset) : dayLabel(ymd))
      const [commitment] = await tx
        .insert(schema.commitments)
        .values({
          orgId,
          userId,
          scheduleId: row.id,
          title: `${row.title} — ${what}`,
          kind: input.kind,
          dueAt,
          durationMinutes: input.durationMinutes,
          notes: input.notes?.trim() || null,
          status: 'pending',
        })
        .returning({ id: schema.commitments.id })
      if (commitment) {
        await scheduleFirstReminder({ orgId, commitmentId: commitment.id, fireAt: dueAt }, tx)
        booked += 1
      }
    }

    const [schedule] = await listSchedules(userId, now, row.id, tx)
    return { schedule: schedule!, booked, skippedPast }
  })
}

type Exec = Pick<typeof db, 'select'>

/** Every schedule with its progress; or just one, by id. */
export async function listSchedules(
  userId: string,
  now = new Date(),
  onlyId?: string,
  exec: Exec = db,
): Promise<ScheduleDTO[]> {
  const rows = await exec
    .select()
    .from(schema.schedules)
    .where(
      and(
        eq(schema.schedules.userId, userId),
        onlyId ? eq(schema.schedules.id, onlyId) : undefined,
      ),
    )
    .orderBy(asc(schema.schedules.createdAt))
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const counts = await exec
    .select({
      scheduleId: schema.commitments.scheduleId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${schema.commitments.status} = 'done')::int`,
    })
    .from(schema.commitments)
    .where(inArray(schema.commitments.scheduleId, ids))
    .groupBy(schema.commitments.scheduleId)

  const upcoming = await exec
    .select({
      id: schema.commitments.id,
      scheduleId: schema.commitments.scheduleId,
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
    })
    .from(schema.commitments)
    .where(
      and(
        inArray(schema.commitments.scheduleId, ids),
        eq(schema.commitments.status, 'pending'),
        gte(schema.commitments.dueAt, now),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  return rows.map((r) => {
    const c = counts.find((x) => x.scheduleId === r.id)
    const next = upcoming.find((x) => x.scheduleId === r.id)
    return {
      id: r.id,
      title: r.title,
      startsOn: r.startsOn,
      status: r.status,
      total: c?.total ?? 0,
      done: c?.done ?? 0,
      next: next ? { id: next.id, title: next.title, dueAt: next.dueAt.toISOString() } : null,
      createdAt: r.createdAt.toISOString(),
    }
  })
}

/**
 * Stops a schedule: what is still ahead is removed, what was done is kept.
 * Returns how many upcoming steps were removed, or null if it is not theirs.
 */
export async function stopSchedule(
  userId: string,
  id: string,
  now = new Date(),
): Promise<number | null> {
  const [row] = await db
    .select({ id: schema.schedules.id })
    .from(schema.schedules)
    .where(and(eq(schema.schedules.id, id), eq(schema.schedules.userId, userId)))
    .limit(1)
  if (!row) return null

  const removed = await db
    .delete(schema.commitments)
    .where(
      and(
        eq(schema.commitments.scheduleId, id),
        eq(schema.commitments.status, 'pending'),
        gte(schema.commitments.dueAt, now),
      ),
    )
    .returning({ id: schema.commitments.id })

  await db.update(schema.schedules).set({ status: 'stopped' }).where(eq(schema.schedules.id, id))
  return removed.length
}
