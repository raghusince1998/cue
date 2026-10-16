import { stripWaitingOn } from '@cue/shared'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, notInArray, sql } from 'drizzle-orm'
import type { Lang } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { langOf, t } from '../i18n.ts'
import { sendToUser } from '../push.ts'

/**
 * The daily report: what happened today, written up for whoever you report to.
 *
 * Meetings that took place, visits logged, what got finished, the next steps
 * agreed in those meetings, who still owes you something, and the next
 * working day — all from what is already in Cue, so writing it is reading it.
 * The same day read the next morning is a standup: yesterday, today, blockers.
 */

const DAY_MS = 86_400_000
/** How late after the chosen hour the reminder will still send. */
const LATE_CUTOFF_HOURS = 4

export interface ReportItem {
  title: string
  /** ISO time, when the time matters: a meeting, or when something is due. */
  at: string | null
  /** Who it was with: "Dr. Anil Mehta (Mehta Physio Clinic)". */
  who: string | null
  /** A first line of notes or the outcome. */
  note: string | null
}

export interface DayReport {
  /** YYYY-MM-DD, the day reported on. */
  date: string
  meetings: ReportItem[]
  visits: ReportItem[]
  /** Calls logged: who as the title, how it went as `who`, what was said as the note. */
  calls: ReportItem[]
  done: ReportItem[]
  /** Next steps agreed in the day's meetings: yours, and what others will do. */
  agreed: ReportItem[]
  /** Everything still owed to you, oldest check-in first. */
  waiting: ReportItem[]
  next: { date: string; items: ReportItem[] }
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** "Waiting on Vikram: signed contract" → "signed contract" */
function waitingWhat(title: string): string {
  return stripWaitingOn(title)
}

/** One line of notes, short enough for a message. */
function firstLine(text: string | null): string | null {
  const line = text?.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
  if (!line) return null
  return line.length > 160 ? `${line.slice(0, 157).trimEnd()}…` : line
}

function withWhom(name: string | null, organization: string | null): string | null {
  if (!name) return organization
  return organization ? `${name} (${organization})` : name
}

/** Has anything been recorded on this day? Used to find the last working day. */
async function hadActivity(userId: string, start: Date): Promise<boolean> {
  const end = new Date(start.getTime() + DAY_MS)
  const c = schema.commitments
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        sql`(
          (${c.kind} = 'meeting' and ${c.status} not in ('cancelled', 'deleted')
            and ${c.dueAt} >= ${start.toISOString()}::timestamptz and ${c.dueAt} < ${end.toISOString()}::timestamptz)
          or (${c.status} = 'done' and ${c.completedAt} >= ${start.toISOString()}::timestamptz
            and ${c.completedAt} < ${end.toISOString()}::timestamptz)
        )`,
      ),
    )
  return (row?.n ?? 0) > 0
}

/**
 * The day a standup's "yesterday" means: the day before, unless that was a
 * weekend with nothing in it — on a Monday, Friday is yesterday.
 */
export async function previousWorkingDay(userId: string, today: Date): Promise<Date> {
  const start = dayStart(today)
  for (let back = 1; back <= 3; back += 1) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - back)
    const weekend = d.getDay() === 0 || d.getDay() === 6
    if (!weekend || (await hadActivity(userId, d))) return d
  }
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1)
}

/** The next day there is likely to be work: tomorrow, or Monday after a quiet weekend. */
async function nextWorkingDay(userId: string, day: Date): Promise<Date> {
  const c = schema.commitments
  for (let ahead = 1; ahead <= 3; ahead += 1) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate() + ahead)
    if (d.getDay() !== 0 && d.getDay() !== 6) return d
    const end = new Date(d.getTime() + DAY_MS)
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(c)
      .where(and(eq(c.userId, userId), eq(c.status, 'pending'), gte(c.dueAt, d), lt(c.dueAt, end), isNull(c.waitingOn)))
    if ((row?.n ?? 0) > 0) return d
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)
}

export async function dayReport(
  userId: string,
  day: Date,
  now = new Date(),
  /**
   * The day "next" covers. A standup passes today; otherwise the next working
   * day. The words Cue adds ("Received from Vikram: …") are in the person's
   * language, looked up when not given.
   */
  opts: { next?: Date; lang?: Lang } = {},
): Promise<DayReport> {
  const lang = opts.lang ?? (await langOf(userId))
  const start = dayStart(day)
  const end = new Date(start.getTime() + DAY_MS)
  // Only what has happened: a meeting at five is not part of a report sent at four.
  const until = end < now ? end : now
  const c = schema.commitments
  const ct = schema.contacts
  const mine = eq(c.userId, userId)
  const notCancelled = notInArray(c.status, ['cancelled', 'deleted'])

  const meetingRows = await db
    .select({ id: c.id, title: c.title, dueAt: c.dueAt, notes: c.notes, who: ct.name, org: ct.organization })
    .from(c)
    .leftJoin(ct, eq(ct.id, c.contactId))
    .where(and(mine, eq(c.kind, 'meeting'), notCancelled, eq(c.allDay, false), gte(c.dueAt, start), lt(c.dueAt, until)))
    .orderBy(asc(c.dueAt))

  const i = schema.interactions
  const visitRows = await db
    .select({
      channel: i.channel,
      startedAt: i.startedAt,
      outcome: i.outcome,
      notes: i.notes,
      contact: sql<string | null>`coalesce(${ct.name}, ${i.contactName})`,
      org: ct.organization,
      place: schema.places.name,
    })
    .from(i)
    .leftJoin(ct, eq(ct.id, i.contactId))
    .leftJoin(schema.places, eq(schema.places.id, i.placeId))
    .where(and(eq(i.userId, userId), gte(i.startedAt, start), lt(i.startedAt, until)))
    .orderBy(asc(i.startedAt))

  const doneRows = await db
    .select({ title: c.title, waitingOn: c.waitingOn, who: ct.name, org: ct.organization })
    .from(c)
    .leftJoin(ct, eq(ct.id, c.contactId))
    .where(
      and(
        mine,
        eq(c.status, 'done'),
        notInArray(c.kind, ['meeting', 'focus']),
        gte(c.completedAt, start),
        lt(c.completedAt, until),
      ),
    )
    .orderBy(asc(c.completedAt))

  const meetingIds = meetingRows.map((m) => m.id)
  const agreedRows = meetingIds.length
    ? await db
        .select({ title: c.title, dueAt: c.dueAt, waitingOn: c.waitingOn })
        .from(c)
        .where(and(mine, inArray(c.fromCommitmentId, meetingIds), inArray(c.status, ['pending', 'done'])))
        .orderBy(asc(c.dueAt))
    : []

  const waitingRows = await db
    .select({ title: c.title, waitingOn: c.waitingOn, dueAt: c.dueAt, createdAt: c.createdAt })
    .from(c)
    .where(and(mine, eq(c.status, 'pending'), isNotNull(c.waitingOn)))
    .orderBy(asc(c.dueAt))
    .limit(8)

  const nextDay = opts.next ? dayStart(opts.next) : await nextWorkingDay(userId, start)
  const nextEnd = new Date(nextDay.getTime() + DAY_MS)
  const nextRows = await db
    .select({ title: c.title, dueAt: c.dueAt, allDay: c.allDay, kind: c.kind, who: ct.name, org: ct.organization })
    .from(c)
    .leftJoin(ct, eq(ct.id, c.contactId))
    .where(
      and(
        mine,
        // The day's plan as a whole: a standup written at noon still lists
        // the meeting that was at ten, though it is done.
        notCancelled,
        isNull(c.waitingOn),
        ne(c.kind, 'focus'),
        gte(c.dueAt, nextDay),
        lt(c.dueAt, nextEnd),
      ),
    )
    .orderBy(asc(c.dueAt))
    .limit(12)

  return {
    date: ymd(start),
    meetings: meetingRows.map((m) => ({
      title: m.title,
      at: m.dueAt.toISOString(),
      who: withWhom(m.who, m.org),
      note: firstLine(m.notes),
    })),
    visits: visitRows.filter((v) => v.channel !== 'call').map((v) => ({
      title: v.place ?? v.org ?? t(lang, 'Visit'),
      at: v.startedAt.toISOString(),
      who: v.contact,
      note: firstLine([v.outcome, v.notes].filter(Boolean).join(' — ') || null),
    })),
    calls: visitRows
      .filter((v) => v.channel === 'call')
      .map((v) => ({
        title: withWhom(v.contact, v.org) ?? t(lang, 'Unknown number'),
        at: v.startedAt.toISOString(),
        who: v.outcome,
        note: firstLine(v.notes),
      })),
    done: doneRows.map((d) => ({
      // A check-in that was answered reads as what arrived, not as a chore.
      title: d.waitingOn ? t(lang, 'Received from {who}: {what}', { who: d.waitingOn, what: waitingWhat(d.title) }) : d.title,
      at: null,
      who: d.waitingOn ? null : withWhom(d.who, d.org),
      note: null,
    })),
    agreed: agreedRows.map((a) => ({
      title: a.waitingOn ? t(lang, '{who} to send: {what}', { who: a.waitingOn, what: waitingWhat(a.title) }) : a.title,
      at: a.dueAt.toISOString(),
      who: null,
      note: null,
    })),
    waiting: waitingRows.map((w) => ({
      title: `${w.waitingOn}: ${waitingWhat(w.title)}`,
      at: w.createdAt.toISOString(),
      who: null,
      note: null,
    })),
    next: {
      date: ymd(nextDay),
      items: nextRows.map((n) => ({
        title: n.title,
        at: n.allDay ? null : n.dueAt.toISOString(),
        who: withWhom(n.who, n.org),
        note: null,
      })),
    },
  }
}

/** The evening reminder, or null for a day with nothing to report. */
export function composeReminder(
  r: DayReport,
  toName: string | null,
  lang: Lang = 'en',
): { title: string; body: string; url: string } | null {
  const count = (n: number, one: string, many: string) => (n === 0 ? null : n === 1 ? one : many)
  const parts = [
    count(r.meetings.length, t(lang, '1 meeting'), t(lang, '{n} meetings', { n: r.meetings.length })),
    count(r.visits.length, t(lang, '1 visit'), t(lang, '{n} visits', { n: r.visits.length })),
    count(r.calls.length, t(lang, '1 call'), t(lang, '{n} calls', { n: r.calls.length })),
    count(r.done.length, t(lang, '1 done'), t(lang, '{n} done', { n: r.done.length })),
  ].filter(Boolean)
  if (parts.length === 0) return null
  const agreed = count(r.agreed.length, t(lang, '1 next step agreed'), t(lang, '{n} next steps agreed', { n: r.agreed.length }))
  const list = [...parts, agreed].filter(Boolean).join(', ')
  return {
    title: t(lang, 'Your daily report is ready'),
    body: toName
      ? t(lang, '{list}. Have a look and send it to {name}.', { list, name: toName })
      : t(lang, '{list}. Have a look and send it.', { list }),
    url: '/?report=1',
  }
}

export async function sendReportReminderTo(userId: string, now = new Date()) {
  const [user] = await db
    .select({ toName: schema.users.reportToName, language: schema.users.language })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const lang: Lang = user?.language === 'hi' ? 'hi' : 'en'
  const reminder = composeReminder(await dayReport(userId, now, now, { lang }), user?.toName ?? null, lang)
  if (!reminder) return null
  const delivered = await sendToUser(userId, { ...reminder, tag: 'daily-report', lang })
  return { delivered, title: reminder.title, body: reminder.body }
}

interface DueUser {
  id: string
  local_date: string
}

/** Whose reminder hour has come today, and who has not had one yet. */
export async function usersDueForReport(now = new Date()): Promise<DueUser[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select u.id, (${at}::timestamptz at time zone u.timezone)::date::text as local_date
    from users u
    where u.report_enabled
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) >= u.report_hour
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) < u.report_hour + ${LATE_CUTOFF_HOURS}
      and (u.last_report_prompt_on is null or u.last_report_prompt_on < (${at}::timestamptz at time zone u.timezone)::date)
  `)
  return rows as unknown as DueUser[]
}

/** Marked before sending, as the other reminders are: never twice in an evening. */
export async function runReportReminders(now = new Date()): Promise<number> {
  let sent = 0
  for (const user of await usersDueForReport(now)) {
    try {
      await db
        .update(schema.users)
        .set({ lastReportPromptOn: user.local_date })
        .where(eq(schema.users.id, user.id))
      if (await sendReportReminderTo(user.id, now)) sent += 1
    } catch (err) {
      console.error('[report] failed for user', user.id, (err as Error).message)
    }
  }
  return sent
}

export function startReportWorker(intervalMs = 5 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runReportReminders()
      if (sent > 0) console.log(`[report] sent ${sent} report reminder(s)`)
    } catch (err) {
      console.error('[report] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[report] daily report worker checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
