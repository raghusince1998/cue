import { and, eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { env } from '../env.ts'
import { sendToUser } from '../push.ts'
import { activeFocus } from '../services/focus.ts'
import { holdUntil, planSphere, workLifeOf } from '../services/workLife.ts'

interface ClaimedReminder {
  id: string
  org_id: string
  commitment_id: string
  attempt: number
}

/**
 * Claims a batch of due reminders in one statement. `FOR UPDATE SKIP LOCKED`
 * means several API instances can run this loop concurrently without ever
 * double-sending the same buzz.
 */
async function claimDue(limit: number): Promise<ClaimedReminder[]> {
  const rows = await db.execute(sql`
    update reminders set status = 'sending'
    where id in (
      select id from reminders
      where status = 'pending' and fire_at <= now()
      order by fire_at asc
      limit ${limit}
      for update skip locked
    )
    returning id, org_id, commitment_id, attempt
  `)
  return rows as unknown as ClaimedReminder[]
}

/** "Leaves tomorrow at 5:00 pm from Mumbai Central · PNR 2345678901 · 3A · B2 45" */
function bookingLine(
  dueAt: Date,
  booking: { type: string; from: string | null },
  notes: string | null,
): string {
  const time = dueAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const minutes = Math.round((dueAt.getTime() - Date.now()) / 60_000)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(dueAt) - startOf(new Date())) / 86_400_000)
  if (booking.type === 'service') {
    return `Service due ${days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}: book a slot${notes ? ` · ${notes}` : ''}`
  }
  const verb = ['train', 'flight', 'bus'].includes(booking.type) ? 'Leaves' : booking.type === 'hotel' ? 'Check-in' : 'Starts'
  const day = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : dueAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  const when =
    minutes <= 0
      ? `${verb} now`
      : minutes < 90
        ? `${verb} in ${minutes} min, at ${time}`
        : `${verb} ${day} at ${time}`
  const from = booking.from && booking.type !== 'hotel' ? ` from ${booking.from}` : ''
  return `${when}${from}${notes ? ` · ${notes}` : ''}`
}

function describe(dueAt: Date, escalation: number): string {
  const overdueMin = Math.round((Date.now() - dueAt.getTime()) / 60_000)
  if (escalation === 0) return 'Due now'
  if (overdueMin < 60) return `Still open — ${overdueMin} min overdue`
  const hours = Math.floor(overdueMin / 60)
  return `Still open — ${hours}h overdue`
}

async function processOne(claim: ClaimedReminder) {
  const [row] = await db
    .select({
      commitment: schema.commitments,
      placeName: schema.places.name,
      contactName: schema.contacts.name,
      contactPhone: schema.contacts.phone,
    })
    .from(schema.commitments)
    .leftJoin(schema.places, eq(schema.places.id, schema.commitments.placeId))
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.commitments.contactId))
    .where(eq(schema.commitments.id, claim.commitment_id))
    .limit(1)

  // Commitment closed out (or deleted) between queueing and firing — drop it.
  if (!row || row.commitment.status !== 'pending') {
    await db
      .update(schema.reminders)
      .set({ status: 'cancelled' })
      .where(eq(schema.reminders.id, claim.id))
    return
  }

  const { commitment } = row

  // Focus time: routine reminders wait until the block ends. Critical items
  // still interrupt — that is what critical means — and a focus block's own
  // "starting now" obviously goes.
  if (commitment.kind !== 'focus' && commitment.priority !== 'critical') {
    const focus = await activeFocus(commitment.userId)
    if (focus) {
      await db
        .update(schema.reminders)
        .set({ status: 'pending', fireAt: focus.endsAt, held: true })
        .where(eq(schema.reminders.id, claim.id))
      return
    }
  }
  const where = [row.placeName, row.contactName].filter(Boolean).join(' · ')
  const suffix = where ? ` · ${where}` : ''

  // A meeting from a connected calendar is announced once, as it starts. It is
  // not a task, so "Still open — 2h overdue" every fifteen minutes would be
  // nagging about something that has already happened.
  const mirrored = commitment.feedId !== null
  // A focus block announces its start, once.
  const focusing = commitment.kind === 'focus'
  // A check-in with someone else: once, and straight to the nudge.
  const waiting = commitment.waitingOn !== null
  // A booking: ahead of time, with the reference to hand, and never chased.
  const booked = commitment.booking !== null

  // Work and personal kept apart. Only what nags waits — a chase after the
  // first reminder, or a plan with no set time. A time someone chose is kept.
  const nags = claim.attempt > 0 || commitment.flexibility === 'flexible'
  if (nags && !mirrored && !focusing && !waiting && !booked && commitment.priority !== 'critical') {
    const until = holdUntil(await workLifeOf(commitment.userId), planSphere(commitment), new Date())
    if (until) {
      await db
        .update(schema.reminders)
        .set({ status: 'pending', fireAt: until, held: true })
        .where(eq(schema.reminders.id, claim.id))
      return
    }
  }

  await sendToUser(commitment.userId, {
    title: commitment.title,
    body: focusing
      ? `Focus time starts now — reminders will wait until ${new Date(
          commitment.dueAt.getTime() + commitment.durationMinutes * 60_000,
        ).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
      : waiting
      ? 'Time to check in. Tap to send a nudge.'
      : booked
      ? bookingLine(commitment.dueAt, commitment.booking!, commitment.notes)
      : `${mirrored ? 'Starting now' : describe(commitment.dueAt, claim.attempt)}${suffix}`,
    tag: `commitment-${commitment.id}`,
    // Lets the notification offer a Call button instead of only a nag.
    phone: row.contactPhone ?? undefined,
    // Deliberately the root route: the service worker appends ?action=&id= and
    // the Today screen acts on them. A deeper path would hit the SPA catch-all,
    // which redirects to "/" and drops the query string with it.
    url: waiting ? `/?nudge=${commitment.id}` : '/',
    commitmentId: commitment.id,
  })

  await db
    .update(schema.reminders)
    .set({ status: 'sent', sentAt: new Date() })
    .where(eq(schema.reminders.id, claim.id))

  const nextAttempt = claim.attempt + 1

  await db
    .update(schema.commitments)
    .set({ escalationCount: nextAttempt })
    .where(eq(schema.commitments.id, commitment.id))

  // Keep chasing. Once the chain is exhausted the item simply stays in the
  // Overdue list until the user closes it — it is never silently dropped.
  if (!mirrored && !waiting && !focusing && !booked && nextAttempt < env.maxEscalations) {
    await db.insert(schema.reminders).values({
      orgId: claim.org_id,
      commitmentId: commitment.id,
      fireAt: new Date(Date.now() + env.escalationMinutes * 60_000),
      attempt: nextAttempt,
      status: 'pending',
    })
  }
}

/**
 * One pass of the loop.
 *
 * Exported so tests can await the work instead of sleeping and hoping. A fixed
 * sleep is calibrated for whatever database the author had: 400ms is plenty
 * against localhost and not nearly enough against a database across a network,
 * where each query in the pass costs a round trip. That produces failures that
 * look like a broken worker and are really a stopwatch.
 */
export async function runOnce() {
  const claimed = await claimDue(50)
  if (claimed.length === 0) return

  for (const claim of claimed) {
    try {
      await processOne(claim)
    } catch (err) {
      console.error('[reminders] failed to process', claim.id, err)
      // Put it back so the next tick retries rather than losing the reminder.
      await db
        .update(schema.reminders)
        .set({ status: 'pending' })
        .where(and(eq(schema.reminders.id, claim.id), eq(schema.reminders.status, 'sending')))
    }
  }
}

export function startReminderWorker() {
  let running = false

  const run = async () => {
    if (running) return
    running = true
    try {
      await runOnce()
    } catch (err) {
      // Message only — a full stack every 20s just buries the real cause, which
      // at this level is almost always the database being unreachable.
      console.error('[reminders] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }

  void run()
  const handle = setInterval(run, env.reminderPollMs)
  console.log(`[reminders] worker polling every ${env.reminderPollMs}ms`)
  return () => clearInterval(handle)
}
