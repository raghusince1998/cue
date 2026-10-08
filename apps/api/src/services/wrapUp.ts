import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { managedByCue, meetingEnd } from './overdue.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'

/**
 * Closing a meeting, and keeping what came out of it.
 *
 * Each follow-up is its own plan with a reminder: something to do yourself,
 * or something you are waiting on from someone else — the second kind is a
 * date to check in, because "they said they would send it" is how a week
 * goes by. Either way the meeting is then done.
 */

export interface WrapUpItem {
  title: string
  /** Someone else's to do; this becomes a check-in reminder for you. */
  waitingOn?: string | null
  dueAt: string
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Returns how many follow-ups were made, or null if the meeting is not theirs. */
export async function wrapUpMeeting(
  userId: string,
  meetingId: string,
  items: WrapUpItem[],
  now = new Date(),
): Promise<{ created: number } | null> {
  const [meeting] = await db
    .select()
    .from(schema.commitments)
    .where(and(eq(schema.commitments.id, meetingId), eq(schema.commitments.userId, userId)))
    .limit(1)
  if (!meeting) return null

  return db.transaction(async (tx) => {
    let created = 0
    for (const item of items) {
      const title = item.title.trim()
      if (!title) continue
      const who = item.waitingOn?.trim()
      const dueAt = new Date(item.dueAt)
      const [row] = await tx
        .insert(schema.commitments)
        .values({
          orgId: meeting.orgId,
          userId,
          title: who ? `Waiting on ${who}: ${title}` : title,
          kind: who ? 'followup' : 'task',
          dueAt,
          durationMinutes: 15,
          notes: `From the meeting "${meeting.title}" on ${dateLabel(meeting.dueAt)}.`,
          fromCommitmentId: meeting.id,
          status: 'pending',
        })
        .returning({ id: schema.commitments.id })
      if (row) {
        if (dueAt.getTime() > now.getTime()) {
          await scheduleFirstReminder({ orgId: meeting.orgId, commitmentId: row.id, fireAt: dueAt }, tx)
        }
        created += 1
      }
    }

    if (meeting.status === 'pending') {
      await tx
        .update(schema.commitments)
        .set({ status: 'done', completedAt: now })
        .where(eq(schema.commitments.id, meeting.id))
      await cancelPendingReminders(meeting.id, tx)
    }
    return { created }
  })
}

/** How recently a meeting must have ended to be worth a notification. */
const PROMPT_WITHIN_MINUTES = 30

interface JustEnded {
  id: string
  user_id: string
  title: string
}

/**
 * One pass: ask about every meeting that ended in the last half hour.
 *
 * Marked before sending, as the evening nudge is: a failed notification is a
 * smaller problem than asking about the same meeting every two minutes. Only
 * one-off meetings: a daily standup asking "any follow-ups?" every morning
 * would teach people to ignore the question. They still appear on Today.
 */
export async function promptFollowUps(now = new Date()): Promise<number> {
  const c = schema.commitments
  // Strings, cast: raw fragments do not convert Dates for the driver.
  const at = now.toISOString()
  const since = new Date(now.getTime() - PROMPT_WITHIN_MINUTES * 60_000).toISOString()
  const rows = (await db.execute(sql`
    update commitments set wrapup_prompted_at = ${at}::timestamptz
    where id in (
      select ${c.id} from commitments
      join users u on u.id = ${c.userId}
      where u.followup_prompts
        and ${c.status} = 'pending'
        and ${c.kind} = 'meeting'
        and not ${c.allDay}
        and ${c.recurrenceId} is null
        and ${c.wrapupPromptedAt} is null
        and ${managedByCue()}
        and ${meetingEnd()} <= ${at}::timestamptz
        and ${meetingEnd()} > ${since}::timestamptz
      for update of commitments skip locked
    )
    returning id, user_id, title
  `)) as unknown as JustEnded[]

  for (const row of rows) {
    try {
      await sendToUser(row.user_id, {
        title: `${row.title} just ended`,
        body: 'Anything to follow up on? Tap to note it while it is fresh.',
        tag: `wrapup-${row.id}`,
        url: `/?wrapup=${row.id}`,
      })
    } catch (err) {
      console.error('[followups] could not send for', row.id, (err as Error).message)
    }
  }
  return rows.length
}

export function startFollowUpWorker(intervalMs = 2 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const n = await promptFollowUps()
      if (n > 0) console.log(`[followups] asked about ${n} meeting(s)`)
    } catch (err) {
      console.error('[followups] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[followups] after-meeting prompts checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
