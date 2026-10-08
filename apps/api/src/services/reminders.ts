import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'

/** Queue the first buzz for a commitment. Escalations are added as they fire. */
export async function scheduleFirstReminder(
  input: { orgId: string; commitmentId: string; fireAt: Date },
  exec: Executor = db,
) {
  await exec.insert(schema.reminders).values({
    orgId: input.orgId,
    commitmentId: input.commitmentId,
    fireAt: input.fireAt,
    attempt: 0,
    status: 'pending',
  })
}

/**
 * Drop anything still queued for a commitment. Called when it is completed,
 * cancelled or snoozed — a snooze then queues a fresh chain.
 */
export async function cancelPendingReminders(commitmentId: string, exec: Executor = db) {
  await exec
    .update(schema.reminders)
    .set({ status: 'cancelled' })
    .where(
      and(
        eq(schema.reminders.commitmentId, commitmentId),
        inArray(schema.reminders.status, ['pending']),
      ),
    )
}

/**
 * A calendar's "Remind me about these too", applied to what it already holds.
 *
 * Reminders were only ever queued as events arrived, so ticking the box on a
 * calendar that was already being read changed nothing: every event in it had
 * been imported before, and none got a reminder. Unticking it left the queued
 * ones to fire anyway. Returns how many reminders were queued or cancelled.
 */
export async function applyFeedReminders(
  feedId: string,
  remind: boolean,
  now = new Date(),
  exec: Executor = db,
): Promise<number> {
  const c = schema.commitments

  if (!remind) {
    const cancelled = await exec
      .update(schema.reminders)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(schema.reminders.status, 'pending'),
          inArray(
            schema.reminders.commitmentId,
            exec.select({ id: c.id }).from(c).where(eq(c.feedId, feedId)),
          ),
        ),
      )
      .returning({ id: schema.reminders.id })
    return cancelled.length
  }

  // Only what is still ahead and still open, and never a second reminder for
  // something that already has one queued.
  const due = await exec
    .select({ id: c.id, orgId: c.orgId, dueAt: c.dueAt })
    .from(c)
    .where(
      and(
        eq(c.feedId, feedId),
        eq(c.status, 'pending'),
        gt(c.dueAt, now),
        sql`not exists (select 1 from reminders r where r.commitment_id = ${c.id} and r.status = 'pending')`,
      ),
    )
  if (due.length === 0) return 0

  await exec.insert(schema.reminders).values(
    due.map((row) => ({
      orgId: row.orgId,
      commitmentId: row.id,
      fireAt: row.dueAt,
      attempt: 0,
      status: 'pending',
    })),
  )
  return due.length
}

