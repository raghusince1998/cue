import { and, desc, eq, sql } from 'drizzle-orm'
import { CALL_OUTCOME_LABELS, shortName, type LogCallInput } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'

/**
 * Logging a call the moment it ends.
 *
 * The call becomes an interaction, like a visit, so it shows in the person's
 * history, counts towards an account's last contact (when you spoke), and
 * appears in the daily report. What comes next is a plan with a reminder: try
 * again, something to do, or something they will send. A call made from a
 * plan — a call back — closes that plan, or moves it when nobody answered.
 */

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** The last ten digits: "+91 98200 11223" and "098200-11223" are the same phone. */
export function phoneKey(phone: string): string {
  return phone.replace(/\D/g, '').slice(-10)
}

/** Who a call was with: the contact named, or the saved person with that number or name. */
async function resolveContact(
  orgId: string,
  input: Pick<LogCallInput, 'contactId' | 'phone' | 'name'>,
): Promise<{ id: string; name: string } | null> {
  const ct = schema.contacts
  if (input.contactId) {
    const [row] = await db
      .select({ id: ct.id, name: ct.name })
      .from(ct)
      .where(and(eq(ct.id, input.contactId), eq(ct.orgId, orgId)))
      .limit(1)
    if (row) return row
  }
  const key = input.phone ? phoneKey(input.phone) : ''
  if (key.length >= 6) {
    const [row] = await db
      .select({ id: ct.id, name: ct.name })
      .from(ct)
      .where(and(eq(ct.orgId, orgId), sql`right(regexp_replace(coalesce(${ct.phone}, ''), '[^0-9]', '', 'g'), 10) = ${key}`))
      .limit(1)
    if (row) return row
  }
  if (input.name?.trim()) {
    const [row] = await db
      .select({ id: ct.id, name: ct.name })
      .from(ct)
      .where(and(eq(ct.orgId, orgId), sql`lower(btrim(${ct.name})) = lower(${input.name.trim()})`))
      .limit(1)
    if (row) return row
  }
  return null
}

export interface LoggedCall {
  interactionId: string
  /** The plan made for what comes next, if one was. */
  nextId: string | null
  /** The plan the call was made from, moved to the next try. */
  rescheduled: boolean
  closed: boolean
}

export async function logCall(
  orgId: string,
  userId: string,
  input: LogCallInput,
  now = new Date(),
): Promise<LoggedCall> {
  const contact = await resolveContact(orgId, input)
  const who = contact?.name ?? input.name?.trim() ?? input.phone?.trim() ?? 'them'
  const startedAt = input.startedAt ? new Date(input.startedAt) : now
  const outcome = CALL_OUTCOME_LABELS[input.outcome]

  const c = schema.commitments
  const [source] = input.commitmentId
    ? await db
        .select({ id: c.id, status: c.status })
        .from(c)
        .where(and(eq(c.id, input.commitmentId), eq(c.userId, userId)))
        .limit(1)
    : []

  return db.transaction(async (tx) => {
    const [interaction] = await tx
      .insert(schema.interactions)
      .values({
        orgId,
        userId,
        contactId: contact?.id ?? null,
        contactName: contact ? null : (input.name?.trim() || input.phone?.trim() || null),
        purpose: 'business',
        channel: 'call',
        connected: input.outcome === 'spoke',
        outcome,
        notes: input.notes?.trim() || null,
        startedAt,
      })
      .returning({ id: schema.interactions.id })

    let rescheduled = false
    let closed = false
    let nextId: string | null = null
    const next = input.next ?? null

    if (source && source.status === 'pending') {
      if (next?.kind === 'again') {
        // Nobody answered the call back: it moves to the next try rather
        // than leaving one overdue and adding another.
        const dueAt = new Date(next.dueAt)
        await cancelPendingReminders(source.id, tx)
        await tx.update(c).set({ dueAt, escalationCount: 0 }).where(eq(c.id, source.id))
        await scheduleFirstReminder({ orgId, commitmentId: source.id, fireAt: dueAt }, tx)
        rescheduled = true
      } else if (input.markDone) {
        await tx.update(c).set({ status: 'done', completedAt: now }).where(eq(c.id, source.id))
        await cancelPendingReminders(source.id, tx)
        closed = true
      }
    }

    if (next && !rescheduled) {
      const short = shortName(who)
      const what = next.title?.trim()
      const title =
        next.kind === 'again'
          ? `Call ${who} again`
          : next.kind === 'waiting'
            ? `Waiting on ${short}: ${what || 'what they promised'}`
            : what || `Follow up with ${who}`
      const dueAt = new Date(next.dueAt)
      const [row] = await tx
        .insert(c)
        .values({
          orgId,
          userId,
          title,
          kind: next.kind === 'again' ? 'callback' : next.kind === 'waiting' ? 'followup' : 'task',
          dueAt,
          durationMinutes: 15,
          contactId: contact?.id ?? null,
          waitingOn: next.kind === 'waiting' ? short : null,
          notes: `From a call on ${dateLabel(startedAt)}: ${outcome.toLowerCase()}.`,
          status: 'pending',
        })
        .returning({ id: c.id })
      if (row) {
        nextId = row.id
        if (dueAt.getTime() > now.getTime()) {
          await scheduleFirstReminder({ orgId, commitmentId: row.id, fireAt: dueAt }, tx)
        }
      }
    }

    return { interactionId: interaction!.id, nextId, rescheduled, closed }
  })
}

/** A person's recent calls, newest first. */
export async function recentCalls(orgId: string, contactId: string, limit = 5) {
  const i = schema.interactions
  const rows = await db
    .select({ at: i.startedAt, outcome: i.outcome, notes: i.notes, connected: i.connected })
    .from(i)
    .where(and(eq(i.orgId, orgId), eq(i.contactId, contactId), eq(i.channel, 'call')))
    .orderBy(desc(i.startedAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }))
}
