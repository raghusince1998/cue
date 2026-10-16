import { and, eq, sql } from 'drizzle-orm'
import { examLineHi, splitExamStep, type Lang } from '@cue/shared'
import { langOf, localeOf, msg, t } from '../i18n.ts'
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

/** A booking's start, said three ways: now, within the next hour and a half, or on a day. */
const BOOKING_WHEN = {
  leaves: { now: msg('Leaves now'), soon: msg('Leaves in {minutes} min, at {time}'), later: msg('Leaves {day} at {time}') },
  checkIn: { now: msg('Check-in now'), soon: msg('Check-in in {minutes} min, at {time}'), later: msg('Check-in {day} at {time}') },
  starts: { now: msg('Starts now'), soon: msg('Starts in {minutes} min, at {time}'), later: msg('Starts {day} at {time}') },
}

/** "Leaves tomorrow at 5:00 pm from Mumbai Central · PNR 2345678901 · 3A · B2 45" */
function bookingLine(
  dueAt: Date,
  booking: { type: string; from: string | null },
  notes: string | null,
  lang: Lang,
): string {
  const time = dueAt.toLocaleTimeString(localeOf(lang), { hour: 'numeric', minute: '2-digit' })
  const minutes = Math.round((dueAt.getTime() - Date.now()) / 60_000)
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(dueAt) - startOf(new Date())) / 86_400_000)
  if (booking.type === 'service') {
    const due =
      days <= 0
        ? t(lang, 'Service due today: book a slot')
        : days === 1
          ? t(lang, 'Service due tomorrow: book a slot')
          : t(lang, 'Service due in {days} days: book a slot', { days })
    return `${due}${notes ? ` · ${notes}` : ''}`
  }
  const said = BOOKING_WHEN[['train', 'flight', 'bus'].includes(booking.type) ? 'leaves' : booking.type === 'hotel' ? 'checkIn' : 'starts']
  const day =
    days <= 0
      ? t(lang, 'today')
      : days === 1
        ? t(lang, 'tomorrow')
        : dueAt.toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })
  const when =
    minutes <= 0
      ? t(lang, said.now)
      : minutes < 90
        ? t(lang, said.soon, { minutes, time })
        : t(lang, said.later, { day, time })
  const from = booking.from && booking.type !== 'hotel' ? t(lang, ' from {place}', { place: booking.from }) : ''
  return `${when}${from}${notes ? ` · ${notes}` : ''}`
}

/**
 * An exam's date, said as what to do about it: "Last date tomorrow: fill the
 * form and keep the confirmation page", "Exam tomorrow at 7:30 am · Kendriya
 * Vidyalaya No. 3 · admit card, photo ID and photos".
 */
function examLine(dueAt: Date, step: string, place: string | null): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOf(dueAt) - startOf(new Date())) / 86_400_000)
  const day = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${dueAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`
  const time = dueAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  switch (splitExamStep(step)?.step) {
    case 'apply_by':
      return `${days <= 0 ? 'Today is the last date' : `Last date ${day}`}: fill the form and keep the confirmation page.`
    case 'fee_by':
      return `${days <= 0 ? 'Today is the last date for the fee' : `Fee due ${day}`}: pay, and keep the receipt.`
    case 'correction':
      return `Correction window ${day}: check every detail in the form.`
    case 'admit_card':
      return `Admit card ${days <= 0 ? 'out today' : `due ${day}`}: download it and print it.`
    case 'exam':
      return `Exam ${day} at ${time}${place ? ` · ${place}` : ''} · admit card, photo ID and photos.`
    case 'answer_key':
      return `Answer key ${day}: check your answers while objections are open.`
    case 'result':
      return `Result ${days <= 0 ? 'today' : `expected ${day}`}.`
    default:
      return days <= 0 ? 'Today.' : `${day[0]!.toUpperCase()}${day.slice(1)}.`
  }
}

function describe(dueAt: Date, escalation: number, lang: Lang): string {
  const overdueMin = Math.round((Date.now() - dueAt.getTime()) / 60_000)
  if (escalation === 0) return t(lang, 'Due now')
  if (overdueMin < 60) return t(lang, 'Still open — {n} min overdue', { n: overdueMin })
  const hours = Math.floor(overdueMin / 60)
  return t(lang, 'Still open — {n}h overdue', { n: hours })
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
  // An exam's date: said as what to do. Only the last day to apply or pay is
  // chased, and only once that day has come; days ahead, it is said once.
  const exam = commitment.examStep !== null
  const examStep = splitExamStep(commitment.examStep)?.step
  const chaseExam =
    exam && (examStep === 'apply_by' || examStep === 'fee_by') && Date.now() >= commitment.dueAt.getTime() - 60 * 60_000

  // Work and personal kept apart. Only what nags waits — a chase after the
  // first reminder, or a plan with no set time. A time someone chose is kept.
  const nags = claim.attempt > 0 || commitment.flexibility === 'flexible'
  if (nags && !mirrored && !focusing && !waiting && !booked && !exam && commitment.priority !== 'critical') {
    const until = holdUntil(await workLifeOf(commitment.userId), planSphere(commitment), new Date())
    if (until) {
      await db
        .update(schema.reminders)
        .set({ status: 'pending', fireAt: until, held: true })
        .where(eq(schema.reminders.id, claim.id))
      return
    }
  }

  const lang = await langOf(commitment.userId)
  await sendToUser(commitment.userId, {
    title: commitment.title,
    body: focusing
      ? t(lang, 'Focus time starts now — reminders will wait until {time}.', {
          time: new Date(commitment.dueAt.getTime() + commitment.durationMinutes * 60_000).toLocaleTimeString(
            localeOf(lang),
            { hour: 'numeric', minute: '2-digit' },
          ),
        })
      : waiting
      ? t(lang, 'Time to check in. Tap to send a nudge.')
      : booked
      ? bookingLine(commitment.dueAt, commitment.booking!, commitment.notes, lang)
      : exam
      ? lang === 'hi'
        ? examLineHi(commitment.dueAt, examStep, commitment.placeLabel ?? row.placeName)
        : examLine(commitment.dueAt, commitment.examStep!, commitment.placeLabel ?? row.placeName)
      : `${mirrored ? t(lang, 'Starting now') : describe(commitment.dueAt, claim.attempt, lang)}${suffix}`,
    lang,
    tag: `commitment-${commitment.id}`,
    // Lets the notification offer a Call button instead of only a nag.
    phone: row.contactPhone ?? undefined,
    // The root route, so Today opens it: the plan itself (or, for a check-in,
    // the nudge). A deeper path would hit the SPA catch-all, which redirects
    // to "/" and drops the query string with it.
    url: waiting ? `/?nudge=${commitment.id}` : `/?edit=${commitment.id}`,
    // Done and Snooze only where they cannot do harm: snoozing a train moves
    // the train, a calendar meeting is the calendar's, and a focus block ends
    // from its own button.
    commitmentId: booked || mirrored || focusing ? undefined : commitment.id,
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
  if (!mirrored && !waiting && !focusing && !booked && (!exam || chaseExam) && nextAttempt < env.maxEscalations) {
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
