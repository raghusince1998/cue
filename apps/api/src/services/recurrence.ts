import { and, eq, gte, isNull, inArray, or, sql } from 'drizzle-orm'
import {
  expandRecurrence,
  type RecurrenceAnchor,
  type RecurrenceRule,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * Turning a rule into real commitments.
 *
 * Occurrences are written ahead of time rather than expanded on read, so every
 * other part of the system — the nag engine above all, which needs a row to
 * queue a reminder against — carries on working with no idea recurrence exists.
 *
 * The window is rolling: a sweep keeps roughly `HORIZON_DAYS` of future
 * occurrences on the books and no more, so an unbounded weekly rule does not
 * write a thousand rows on the day it is created.
 */

const HORIZON_DAYS = 120

type RecurrenceRow = typeof schema.recurrences.$inferSelect

/** The date column comes back as 'YYYY-MM-DD'; parse it as local, never UTC. */
function localDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function ruleOf(row: RecurrenceRow): RecurrenceRule {
  return {
    freq: row.freq as RecurrenceRule['freq'],
    interval: row.interval,
    byWeekday: row.byWeekday ?? undefined,
    byMonthDay: row.byMonthDay,
    byMonth: row.byMonth,
    setPos: row.setPos,
    until: row.untilOn,
    count: row.count,
    exdates: row.exdates,
  }
}

export function anchorOf(row: RecurrenceRow): RecurrenceAnchor {
  return { startsOn: localDate(row.startsOn), hour: row.hour, minute: row.minute }
}

/**
 * Writes any missing occurrences for one series up to the horizon.
 *
 * Idempotent by construction: the unique index on (recurrence_id,
 * occurrence_on) means a second run, or a second API instance, inserts
 * nothing. Reminders are only queued for rows that were actually inserted,
 * which is why the insert has to report back what it did.
 */
export async function materialise(
  row: RecurrenceRow,
  opts: { now?: Date; horizonDays?: number; remind?: boolean } = {},
  exec: Executor = db,
): Promise<number> {
  if (row.status !== 'active') return 0

  const now = opts.now ?? new Date()
  const horizon = new Date(now.getTime())
  horizon.setDate(horizon.getDate() + (opts.horizonDays ?? HORIZON_DAYS))

  // Start from the day after whatever already exists, but never before the
  // series itself begins, and never so far back that completed occurrences get
  // recreated behind the user.
  const from = row.materialisedTo
    ? new Date(localDate(row.materialisedTo).getTime() + 86_400_000)
    : localDate(row.startsOn)

  const dates = expandRecurrence(ruleOf(row), anchorOf(row), { from, to: horizon })
  let written = 0

  if (dates.length > 0) {
    const inserted = await exec
      .insert(schema.commitments)
      .values(
        dates.map((dueAt) => ({
          orgId: row.orgId,
          userId: row.userId,
          recurrenceId: row.id,
          // Carried down from the series so an occurrence can say where it
          // came from, and so a mirrored one is recognisable as a copy.
          feedId: row.feedId,
          externalUid: row.externalUid,
          occurrenceOn: ymd(dueAt),
          title: row.title,
          kind: row.kind,
          notes: row.notes,
          dueAt,
          durationMinutes: row.durationMinutes,
          priority: row.priority,
          placeId: row.placeId,
          contactId: row.contactId,
          placeLabel: row.placeLabel,
          // Work or personal, if the person sorted the series themselves.
          sphere: row.sphere ?? null,
          status: 'pending' as const,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: schema.commitments.id, dueAt: schema.commitments.dueAt })

    // A subscribed calendar whose owner turned reminders off still gets its
    // occurrences mirrored — it just does not buzz, because the source calendar
    // is already doing that.
    if (opts.remind !== false) {
      for (const c of inserted) {
        await scheduleFirstReminder(
          { orgId: row.orgId, commitmentId: c.id, fireAt: c.dueAt },
          exec,
        )
      }
    }
    // What was actually written, not what was considered — on a repeat sweep
    // every date is a candidate and none of them are new.
    written = inserted.length
  }

  await exec
    .update(schema.recurrences)
    .set({ materialisedTo: ymd(horizon) })
    .where(eq(schema.recurrences.id, row.id))

  return written
}

/**
 * Re-applies a changed rule to everything still ahead.
 *
 * Deliberately narrow about what it is allowed to destroy. Occurrences that
 * are in the past, already completed, or individually edited are left exactly
 * as they are — history is not the rule's to rewrite, and "change just this
 * one" has to survive the next edit of the series or it means nothing.
 */
export async function regenerate(
  row: RecurrenceRow,
  opts: { now?: Date; remind?: boolean } = {},
  exec: Executor = db,
): Promise<void> {
  const now = opts.now ?? new Date()

  await exec
    .delete(schema.commitments)
    .where(
      and(
        eq(schema.commitments.recurrenceId, row.id),
        eq(schema.commitments.status, 'pending'),
        eq(schema.commitments.detached, false),
        gte(schema.commitments.dueAt, now),
      ),
    )

  await exec
    .update(schema.recurrences)
    .set({ materialisedTo: null })
    .where(eq(schema.recurrences.id, row.id))

  await materialise({ ...row, materialisedTo: null }, { now, remind: opts.remind }, exec)
}

/**
 * Ends a series without erasing it.
 *
 * Future untouched occurrences go, past and edited ones stay. Someone who
 * cancels their Tuesday class still wants to see the eight they attended.
 */
export async function stopSeries(
  recurrenceId: string,
  opts: { now?: Date } = {},
  exec: Executor = db,
): Promise<void> {
  const now = opts.now ?? new Date()

  await exec
    .delete(schema.commitments)
    .where(
      and(
        eq(schema.commitments.recurrenceId, recurrenceId),
        eq(schema.commitments.status, 'pending'),
        eq(schema.commitments.detached, false),
        gte(schema.commitments.dueAt, now),
      ),
    )

  await exec
    .update(schema.recurrences)
    .set({ status: 'ended' })
    .where(eq(schema.recurrences.id, recurrenceId))
}

/**
 * Keeps the rolling window topped up for every active series.
 *
 * Runs on a timer rather than on read: a reminder has to be queued before the
 * user opens the app, or the whole point of the app is lost.
 */
export async function sweep(opts: { now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date()
  // Only series whose horizon is running out. `materialised_to is null` covers
  // one that has never run, including after a rule change.
  const due = await db
    .select()
    .from(schema.recurrences)
    .where(
      and(
        eq(schema.recurrences.status, 'active'),
        or(
          isNull(schema.recurrences.materialisedTo),
          sql`${schema.recurrences.materialisedTo} < ${ymd(now)}::date + 30`,
        ),
      ),
    )

  let total = 0
  for (const row of due) {
    try {
      total += await materialise(row, { now })
    } catch (err) {
      // One broken rule must not stop the rest from being generated.
      console.error('[recurrence] failed to materialise', row.id, (err as Error).message)
    }
  }
  return total
}

/** Marks one occurrence as edited, so the series stops overwriting it. */
export async function detach(commitmentId: string, exec: Executor = db): Promise<void> {
  await exec
    .update(schema.commitments)
    .set({ detached: true })
    .where(
      and(
        eq(schema.commitments.id, commitmentId),
        inArray(schema.commitments.status, ['pending', 'snoozed']),
      ),
    )
}
