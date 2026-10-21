import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'
import { checkConflicts } from './scheduling.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'
import { meetingEnd } from './overdue.ts'
import { tracked } from './health.ts'

/**
 * Focus time: protected blocks for real work.
 *
 * A block is a commitment of kind 'focus'. It occupies time like a meeting —
 * the clash check sees it, shared free times skip it — and while one is under
 * way, routine reminders are held back until it ends. Critical items and the
 * meeting-prep note still come through: those are the interruptions worth
 * having. A finished block is done, never overdue.
 */

const c = schema.commitments

export interface ActiveFocus {
  id: string
  title: string
  endsAt: Date
}

/** The focus block under way for this person at `now`, if there is one. */
export async function activeFocus(
  userId: string,
  now = new Date(),
  exec: Executor = db,
): Promise<ActiveFocus | null> {
  const at = now.toISOString()
  const [row] = await exec
    .select({ id: c.id, title: c.title, endsAt: sql<string>`${meetingEnd()}` })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        eq(c.status, 'pending'),
        eq(c.kind, 'focus'),
        lte(c.dueAt, now),
        sql`${meetingEnd()} > ${at}::timestamptz`,
      ),
    )
    .orderBy(desc(c.dueAt))
    .limit(1)
  return row ? { id: row.id, title: row.title, endsAt: new Date(row.endsAt) } : null
}

export type StartResult =
  | { ok: true; id: string; startsAt: Date; endsAt: Date }
  | { ok: false; conflicts: { title: string; dueAt: string }[] }

export async function startFocus(
  orgId: string,
  userId: string,
  input: { minutes: number; startAt?: Date; title?: string | null; allowConflict?: boolean },
  now = new Date(),
): Promise<StartResult> {
  const startsAt = input.startAt && input.startAt > now ? input.startAt : now
  const minutes = input.minutes

  if (!input.allowConflict) {
    const report = await checkConflicts(userId, { startsAt, durationMinutes: minutes })
    if (report.conflicts.length > 0) {
      return {
        ok: false,
        conflicts: report.conflicts.map((x) => ({ title: x.title, dueAt: x.dueAt })),
      }
    }
  }

  const what = input.title?.trim()
  const [row] = await db
    .insert(c)
    .values({
      orgId,
      userId,
      title: what ? `Focus: ${what}` : 'Focus time',
      kind: 'focus',
      dueAt: startsAt,
      durationMinutes: minutes,
      flexibility: 'fixed',
      status: 'pending',
    })
    .returning({ id: c.id })
  if (!row) throw new Error('could not start focus time')

  // A block booked for later announces itself when it starts; one starting
  // now has just been started by hand and needs no telling.
  if (startsAt.getTime() - now.getTime() > 60_000) {
    await scheduleFirstReminder({ orgId, commitmentId: row.id, fireAt: startsAt })
  }
  return { ok: true, id: row.id, startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) }
}

/** Reminders being held for this person, now that nothing is holding them. */
async function releaseHeld(userId: string, now: Date, exec: Executor = db): Promise<number> {
  const released = await exec
    .update(schema.reminders)
    .set({ fireAt: now, held: false })
    .where(
      and(
        eq(schema.reminders.held, true),
        eq(schema.reminders.status, 'pending'),
        inArray(
          schema.reminders.commitmentId,
          exec.select({ id: c.id }).from(c).where(eq(c.userId, userId)),
        ),
      ),
    )
    .returning({ id: schema.reminders.id })
  return released.length
}

/**
 * Ends a block early, or calls off one that has not started. What was held
 * during it is let through at once. Null when it is not this person's.
 */
export async function endFocus(
  userId: string,
  id: string,
  now = new Date(),
): Promise<{ released: number } | null> {
  const [block] = await db
    .select()
    .from(c)
    .where(and(eq(c.id, id), eq(c.userId, userId), eq(c.kind, 'focus')))
    .limit(1)
  if (!block) return null

  return db.transaction(async (tx) => {
    if (block.status === 'pending') {
      if (block.dueAt > now) {
        await tx.update(c).set({ status: 'cancelled', cancelledAt: now }).where(eq(c.id, id))
      } else {
        // Keep the record honest: the time actually spent, not the time planned.
        const spent = Math.max(5, Math.round((now.getTime() - block.dueAt.getTime()) / 60_000))
        await tx
          .update(c)
          .set({ status: 'done', completedAt: now, durationMinutes: Math.min(spent, block.durationMinutes) })
          .where(eq(c.id, id))
      }
      await cancelPendingReminders(id, tx)
    }
    return { released: await releaseHeld(userId, now, tx) }
  })
}

/** How many reminders are waiting for this person's focus to end. */
export async function heldCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.reminders)
    .innerJoin(c, eq(c.id, schema.reminders.commitmentId))
    .where(and(eq(c.userId, userId), eq(schema.reminders.held, true), eq(schema.reminders.status, 'pending')))
  return row?.n ?? 0
}

/** Blocks whose time is up are done; anything they held fires at their end anyway. */
export async function closeFinishedFocus(now = new Date()): Promise<number> {
  const at = now.toISOString()
  const rows = await db
    .update(c)
    .set({ status: 'done', completedAt: sql`${meetingEnd()}` })
    .where(and(eq(c.kind, 'focus'), eq(c.status, 'pending'), sql`${meetingEnd()} <= ${at}::timestamptz`))
    .returning({ id: c.id })
  return rows.length
}

export function startFocusWorker(intervalMs = 2 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await tracked('focus', intervalMs, closeFinishedFocus)
    } catch (err) {
      console.error('[focus] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  return () => clearInterval(handle)
}
