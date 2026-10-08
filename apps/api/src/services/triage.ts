import { and, asc, eq, gte, lt, lte, ne, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { env } from '../env.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'
import { nextFreeSlot } from './freeSlots.ts'
import { canBeOverdue } from './overdue.ts'

/**
 * The moment the app admits its own nagging failed.
 *
 * The whole promise is "nothing gets dropped", and the mechanism behind it is
 * an escalating chain of reminders. But that chain is finite: after
 * MAX_ESCALATIONS it stops queuing and goes quiet, and the commitment sits in
 * the overdue list for as long as the account exists. Something thirty-three
 * days past its time is not being chased — it is being accumulated.
 *
 * So this is a reckoning rather than another reminder. It finds what is stuck,
 * says plainly why it thinks so, and offers the four things that are actually
 * true: it already happened, it needs a real slot, it has no deadline, or it
 * is not going to happen. Every planner can show a red list. Admitting the red
 * list means the tool failed, and helping clear it, is the part nobody does.
 */

const DAY_MS = 86_400_000
/** Past this, "overdue" has stopped meaning "late" and started meaning "stuck". */
const STUCK_AFTER_DAYS = 5

export type TriageReason =
  /** Chased to the end of the chain and still open. */
  | 'chased-out'
  /** Flexible, so it never claimed a slot and nothing ever forced the issue. */
  | 'never-scheduled'
  /** Due on the weekday this person reliably loses things on. */
  | 'bad-day'
  /** Simply old. */
  | 'just-old'
  /** Late but not yet stuck — only listed when every overdue item is asked for. */
  | 'late'

export type TriageAction = 'done' | 'reschedule' | 'someday' | 'drop'

export interface StuckItem {
  id: string
  title: string
  dueAt: string
  daysOverdue: number
  escalationCount: number
  reason: TriageReason
  /** Plain words, naming the evidence rather than asserting a verdict. */
  because: string
  /** What the app would do, if the person agrees. */
  suggested: TriageAction
  /** A real free slot, when rescheduling is the suggestion. */
  suggestedAt: string | null
}

export interface TriageReport {
  items: StuckItem[]
  /** The weekday things reliably die on, when there is one. */
  worstWeekday: string | null
  /** How many are merely late rather than stuck, for honest framing. */
  merelyLate: number
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Which weekday this person's commitments reliably die on, if any. */
async function worstWeekdayFor(userId: string, now: Date): Promise<number | null> {
  const rows = await db
    .select({ dueAt: schema.commitments.dueAt })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        canBeOverdue(),
        lt(schema.commitments.dueAt, now),
        gte(schema.commitments.dueAt, new Date(now.getTime() - 90 * DAY_MS)),
      ),
    )

  if (rows.length < 4) return null
  const counts = new Array(7).fill(0)
  for (const r of rows) counts[r.dueAt.getDay()] += 1
  const worst = counts.indexOf(Math.max(...counts))
  // Lopsided, not merely the largest of seven similar numbers.
  return counts[worst] >= Math.max(3, Math.ceil(rows.length * 0.4)) ? worst : null
}

/**
 * What has stopped moving, and what to do about each.
 *
 * `all` lists every overdue item rather than only the stuck ones. "Clear
 * them", under the overdue count, means all of them; a panel that then left
 * out everything less than five days late answered a different question.
 */
export async function buildTriage(
  userId: string,
  now = new Date(),
  opts: { all?: boolean } = {},
): Promise<TriageReport> {
  const overdue = await db
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      durationMinutes: schema.commitments.durationMinutes,
      escalationCount: schema.commitments.escalationCount,
      flexibility: schema.commitments.flexibility,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        canBeOverdue(),
        lt(schema.commitments.dueAt, now),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  const cutoff = new Date(now.getTime() - STUCK_AFTER_DAYS * DAY_MS)
  const stuckRows = overdue.filter(
    (c) => c.dueAt < cutoff || c.escalationCount >= env.maxEscalations,
  )
  const worst = await worstWeekdayFor(userId, now)

  const items: StuckItem[] = []
  const claimed: { from: Date; to: Date }[] = []

  const stuckIds = new Set(stuckRows.map((c) => c.id))
  for (const c of opts.all ? overdue : stuckRows) {
    const daysOverdue = Math.floor((now.getTime() - c.dueAt.getTime()) / DAY_MS)

    let reason: TriageReason = 'just-old'
    let because = `${plural(daysOverdue, 'day')} past its time, and nothing has moved.`

    if (!stuckIds.has(c.id)) {
      reason = 'late'
      const hoursLate = Math.max(1, Math.round((now.getTime() - c.dueAt.getTime()) / 3_600_000))
      because =
        daysOverdue >= 1
          ? `${plural(daysOverdue, 'day')} past its time.`
          : `${plural(hoursLate, 'hour')} past its time.`
    } else if (c.escalationCount >= env.maxEscalations) {
      reason = 'chased-out'
      because = `Chased ${plural(c.escalationCount, 'time')} and still open. The reminders are not working for this one.`
    } else if (c.flexibility === 'flexible') {
      reason = 'never-scheduled'
      because = `It has never had a real time, so nothing ever forced the issue — ${plural(daysOverdue, 'day')} now.`
    } else if (worst !== null && c.dueAt.getDay() === worst) {
      reason = 'bad-day'
      because = `Due on a ${WEEKDAYS[worst]}, which is where your plans reliably slip.`
    }

    // Suggesting "drop" for something merely late would be the app giving up
    // on the person's behalf; suggesting "reschedule" for something chased
    // four times is pretending the mechanism works. Neither is honest.
    const suggested: TriageAction =
      reason === 'chased-out' && daysOverdue > 21
        ? 'drop'
        : reason === 'chased-out'
          ? 'someday'
          : 'reschedule'

    const suggestedAt =
      suggested === 'reschedule'
        ? await nextFreeSlot(userId, c.durationMinutes, { now, claimed })
        : null

    if (suggestedAt) {
      claimed.push({
        from: suggestedAt,
        to: new Date(suggestedAt.getTime() + c.durationMinutes * 60_000),
      })
    }

    items.push({
      id: c.id,
      title: c.title,
      dueAt: c.dueAt.toISOString(),
      daysOverdue,
      escalationCount: c.escalationCount,
      reason,
      because,
      suggested,
      suggestedAt: suggestedAt ? suggestedAt.toISOString() : null,
    })
  }

  return {
    items,
    worstWeekday: worst !== null ? WEEKDAYS[worst]! : null,
    merelyLate: opts.all ? 0 : overdue.length - stuckRows.length,
  }
}

export interface Decision {
  id: string
  action: TriageAction
  /** Required for 'reschedule'. */
  at?: string
}

/**
 * Applies what was decided.
 *
 * Every path is scoped to the owner and to items that are still pending, so a
 * stale panel cannot reopen something closed in the meantime or touch another
 * account's rows.
 */
export async function applyTriage(
  userId: string,
  decisions: Decision[],
  now = new Date(),
): Promise<{ done: number; rescheduled: number; someday: number; dropped: number }> {
  const result = { done: 0, rescheduled: 0, someday: 0, dropped: 0 }

  for (const decision of decisions) {
    const [row] = await db
      .select({ id: schema.commitments.id, orgId: schema.commitments.orgId })
      .from(schema.commitments)
      .where(
        and(
          eq(schema.commitments.id, decision.id),
          eq(schema.commitments.userId, userId),
          eq(schema.commitments.status, 'pending'),
        ),
      )
      .limit(1)
    if (!row) continue

    if (decision.action === 'done') {
      await db
        .update(schema.commitments)
        .set({ status: 'done', completedAt: now })
        .where(eq(schema.commitments.id, row.id))
      await cancelPendingReminders(row.id)
      result.done += 1
      continue
    }

    if (decision.action === 'drop') {
      // "Let go" means off the list, which is a delete — and a soft one, so
      // the record survives. It is deliberately not a cancel: cancelling keeps
      // the thing on the calendar struck through, which is the wrong answer
      // for something you have just admitted you are never going to do.
      await db
        .update(schema.commitments)
        .set({ status: 'deleted', deletedAt: new Date() })
        .where(eq(schema.commitments.id, row.id))
      await cancelPendingReminders(row.id)
      result.dropped += 1
      continue
    }

    if (decision.action === 'someday') {
      // Still yours, still listed, but it stops pretending to have a deadline
      // and stops buzzing about one. The escalation count resets because the
      // chasing is what failed.
      await db
        .update(schema.commitments)
        .set({ flexibility: 'flexible', preferredWindow: null, escalationCount: 0 })
        .where(eq(schema.commitments.id, row.id))
      await cancelPendingReminders(row.id)
      result.someday += 1
      continue
    }

    if (decision.action === 'reschedule' && decision.at) {
      const at = new Date(decision.at)
      if (Number.isNaN(at.getTime()) || at < now) continue

      await db
        .update(schema.commitments)
        .set({ dueAt: at, flexibility: 'fixed', escalationCount: 0 })
        .where(eq(schema.commitments.id, row.id))

      // A fresh chain from the new time. The old one is cancelled first, or
      // the item is immediately overdue again against reminders it already
      // exhausted.
      await cancelPendingReminders(row.id)
      await scheduleFirstReminder({ orgId: row.orgId, commitmentId: row.id, fireAt: at })
      result.rescheduled += 1
    }
  }

  return result
}
