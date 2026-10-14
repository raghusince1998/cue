import { and, asc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { daysAway, examLabel, splitExamStep, type Lang } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { langOf, localeOf, t } from '../i18n.ts'
import { mondayOf } from './weeklyReview.ts'

/**
 * The Sunday prep report, for whoever tracks an exam: the study sessions done
 * this week against those planned, mock scores against the week before, and
 * the exam dates coming next week — the look back and ahead a coach would
 * give, from what is already in Cue. Quiet on a week with nothing in it.
 */

const DAY_MS = 86_400_000
/** Sunday evening, local: after the day's study, before the week starts. */
const REPORT_HOUR = 18

const c = schema.commitments
const rec = schema.recurrences
const e = schema.exams
const m = schema.examMocks

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export interface ExamWeek {
  week: { from: string; to: string }
  /** Study sessions from a study plan, due this week so far. */
  study: { done: number; planned: number }
  /** Mock tests: the average percentage this week and the week before. */
  mocks: { count: number; thisWeek: number | null; lastWeek: number | null }
  /** Exam dates from now to the end of next week, as their plans are called. */
  ahead: { title: string; on: string }[]
  /** Study sessions planned for next week. */
  studyNext: number
  /** The next exam itself, however far off. */
  nextExam: { label: string; on: string; days: number } | null
}

const average = (rows: { score: number; outOf: number }[]) =>
  rows.length ? Math.round(rows.reduce((s, r) => s + (r.outOf > 0 ? (r.score / r.outOf) * 100 : 0), 0) / rows.length) : null

export async function examWeek(userId: string, now = new Date()): Promise<ExamWeek> {
  const weekStart = mondayOf(now)
  const nextStart = new Date(weekStart.getTime() + 7 * DAY_MS)
  const nextEnd = new Date(nextStart.getTime() + 7 * DAY_MS)
  const lastStart = new Date(weekStart.getTime() - 7 * DAY_MS)

  const sessions = await db
    .select({ status: c.status, dueAt: c.dueAt })
    .from(c)
    .innerJoin(rec, eq(c.recurrenceId, rec.id))
    .where(and(eq(c.userId, userId), isNotNull(rec.examId), ne(c.status, 'deleted'), gte(c.dueAt, weekStart), lt(c.dueAt, nextEnd)))
  const sofar = sessions.filter((s) => s.dueAt < now && s.dueAt < nextStart)

  const mocks = await db
    .select({ takenOn: m.takenOn, score: m.score, outOf: m.outOf })
    .from(m)
    .innerJoin(e, eq(m.examId, e.id))
    .where(and(eq(e.userId, userId), gte(m.takenOn, ymd(lastStart)), lt(m.takenOn, ymd(nextStart))))
  const thisWeek = mocks.filter((x) => x.takenOn >= ymd(weekStart))
  const lastWeek = mocks.filter((x) => x.takenOn < ymd(weekStart))

  // Exam dates of exams still going: next week's, and the next exam itself.
  const dates = await db
    .select({ title: c.title, step: c.examStep, dueAt: c.dueAt, name: e.name, cycle: e.cycle })
    .from(c)
    .innerJoin(e, eq(c.examId, e.id))
    .where(and(eq(c.userId, userId), eq(c.status, 'pending'), isNull(e.closedAt), gte(c.dueAt, now)))
    .orderBy(asc(c.dueAt))
  const exam = dates.find((d) => splitExamStep(d.step)?.step === 'exam')

  return {
    week: { from: ymd(weekStart), to: ymd(new Date(nextStart.getTime() - DAY_MS)) },
    study: { done: sofar.filter((s) => s.status === 'done').length, planned: sofar.length },
    mocks: { count: thisWeek.length, thisWeek: average(thisWeek), lastWeek: average(lastWeek) },
    ahead: dates
      .filter((d) => d.dueAt < nextEnd)
      .map((d) => ({ title: d.title, on: d.dueAt.toISOString() })),
    studyNext: sessions.filter((s) => s.status === 'pending' && s.dueAt >= nextStart).length,
    nextExam: exam ? { label: examLabel(exam), on: exam.dueAt.toISOString(), days: daysAway(exam.dueAt.toISOString(), now) } : null,
  }
}

const dayOf = (iso: string, lang: Lang) => new Date(iso).toLocaleDateString(localeOf(lang), { weekday: 'short', day: 'numeric', month: 'short' })

/** The Sunday notification, or null when there is nothing to say either way. */
export function composeExamWeek(w: ExamWeek, lang: Lang = 'en'): { title: string; body: string; url: string } | null {
  if (w.study.planned === 0 && w.mocks.count === 0 && w.ahead.length === 0 && w.studyNext === 0 && !w.nextExam) return null
  const lines: string[] = []
  if (w.study.planned > 0) {
    lines.push(
      w.study.done === w.study.planned
        ? t(lang, 'Every study session done: {n}.', { n: w.study.planned })
        : t(lang, 'Studied {done} of {planned} sessions.', { done: w.study.done, planned: w.study.planned }),
    )
  }
  if (w.mocks.thisWeek !== null) {
    lines.push(
      w.mocks.lastWeek !== null
        ? t(lang, 'Mock tests {now}%, from {then}% the week before.', { now: w.mocks.thisWeek, then: w.mocks.lastWeek })
        : t(lang, 'Mock tests {now}%.', { now: w.mocks.thisWeek }),
    )
  }
  if (w.ahead.length > 0) {
    const shown = w.ahead.slice(0, 3).map((d) => `${d.title} (${dayOf(d.on, lang)})`)
    const more = w.ahead.length - shown.length
    lines.push(
      more > 0
        ? t(lang, 'Coming up: {list} and {n} more.', { list: shown.join('; '), n: more })
        : t(lang, 'Coming up: {list}.', { list: shown.join('; ') }),
    )
  }
  // The next exam, unless the dates coming up have just said it.
  if (w.nextExam && !w.ahead.some((d) => d.on === w.nextExam!.on)) {
    lines.push(
      w.nextExam.days === 1
        ? t(lang, '{exam} is tomorrow.', { exam: w.nextExam.label })
        : t(lang, '{exam} in {n} days.', { exam: w.nextExam.label, n: w.nextExam.days }),
    )
  }
  if (w.studyNext > 0) {
    lines.push(w.studyNext === 1 ? t(lang, '1 study session planned next week.') : t(lang, '{n} study sessions planned next week.', { n: w.studyNext }))
  }
  return { title: t(lang, 'Your prep this week'), body: lines.join(' '), url: '/exams' }
}

interface DueUser {
  id: string
  local_date: string
}

/** Whose Sunday evening has come, who chose Competitive exams and tracks one, and has not had this week's yet. */
export async function usersDueForExamWeek(now = new Date()): Promise<DueUser[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select u.id, (${at}::timestamptz at time zone u.timezone)::date::text as local_date
    from users u
    where u.exam_week_enabled
      and extract(isodow from (${at}::timestamptz at time zone u.timezone)) = 7
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) >= ${REPORT_HOUR}
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) < ${REPORT_HOUR + 3}
      and (u.last_exam_week_on is null
        or u.last_exam_week_on < (${at}::timestamptz at time zone u.timezone)::date)
      and 'exams' = any(u.uses)
      and exists (select 1 from exams x where x.user_id = u.id and x.closed_at is null)
  `)
  return rows as unknown as DueUser[]
}

export async function sendExamWeekTo(userId: string, now = new Date(), send: typeof sendToUser = sendToUser) {
  const lang = await langOf(userId)
  const report = composeExamWeek(await examWeek(userId, now), lang)
  if (!report) return null
  const delivered = await send(userId, { ...report, tag: 'exam-week', lang })
  return { delivered, title: report.title, body: report.body }
}

export async function runExamWeeks(now = new Date(), send: typeof sendToUser = sendToUser): Promise<number> {
  let sent = 0
  for (const user of await usersDueForExamWeek(now)) {
    try {
      await db.update(schema.users).set({ lastExamWeekOn: user.local_date }).where(eq(schema.users.id, user.id))
      if (await sendExamWeekTo(user.id, now, send)) sent += 1
    } catch (err) {
      console.error('[exam-week] failed for user', user.id, (err as Error).message)
    }
  }
  return sent
}

export function startExamWeekWorker(intervalMs = 10 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runExamWeeks()
      if (sent > 0) console.log(`[exam-week] sent ${sent} Sunday prep report(s)`)
    } catch (err) {
      console.error('[exam-week] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  return () => clearInterval(handle)
}
