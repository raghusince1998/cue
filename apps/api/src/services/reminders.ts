import { and, eq, inArray } from 'drizzle-orm'
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
