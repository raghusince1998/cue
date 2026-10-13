import { and, asc, eq, gt, inArray, isNull, like, ne } from 'drizzle-orm'
import {
  examByKey,
  examDayCarry,
  examLabel,
  examStages,
  examStepTitle,
  isLaterExamStage,
  isOpenExamStage,
  sameCity,
  splitExamStep,
  examStage,
  carryHi,
  examDayNotesHi,
  stepNotesHi,
  stepTitleHi,
  studyWeek,
  type AdmitCard,
  type Lang,
  type MockScoreDTO,
  type StudySeriesDTO,
  type ExamDTO,
  type ExamDateInput,
  type ExamMail,
  type ExamDayInput,
  type ExamStep,
  type ParsedExamLine,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'
import { langOf } from '../i18n.ts'
import { cancelPendingReminders, scheduleFirstReminder } from './reminders.ts'
import { materialise, stopSeries } from './recurrence.ts'
import { tripForBooking } from './tripAssembly.ts'

/**
 * Exams: each one a row, and each of its dates an ordinary plan linked to it
 * (commitments.examId, with examStep saying which date) — so the last day to
 * apply and the exam itself are on Today and in the morning brief like
 * anything else, with reminders set for what each date is.
 */

const e = schema.exams
const c = schema.commitments

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A local day and time of day as a moment: "2026-11-18", "07:30". */
export function localAt(day: string, time: string | null | undefined, fallback = '10:00'): Date {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = (time ?? fallback).split(':').map(Number)
  return new Date(y!, m! - 1, d!, h!, mi!)
}

/** "7:30 am". */
function clock(time: string): string {
  return localAt('2000-01-01', time).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

/**
 * When a date's reminders go. The last day to apply or pay: three days
 * ahead, the evening before, and on the day. The exam: a week ahead, the
 * evening before, and two hours before reporting. The rest: on the day.
 */
export function examReminderTimes(step: ExamStep, dueAt: Date, now: Date): Date[] {
  const day = (offset: number, h: number) => new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate() + offset, h, 0)
  const times =
    step === 'apply_by' || step === 'fee_by'
      ? [day(-3, 10), day(-1, 19), dueAt]
      : step === 'exam'
        ? [day(-7, 19), day(-1, 19), new Date(dueAt.getTime() - 2 * 3_600_000)]
        : [dueAt]
  return [...new Set(times.map((t) => t.getTime()))]
    .filter((t) => t > now.getTime())
    .sort((a, b) => a - b)
    .map((t) => new Date(t))
}

/** What a date's plan is for, as its notes: what to do about it. */
function stepNotes(step: ExamStep, exam: { examKey: string | null }): string | null {
  const catalog = examByKey(exam.examKey)
  const site = catalog?.applyAt ?? catalog?.site ?? null
  switch (step) {
    case 'apply_by':
      return `Fill the form and keep the confirmation page${site ? ` · ${site}` : ''}`
    case 'fee_by':
      return `Pay, and keep the receipt${site ? ` · ${site}` : ''}`
    case 'correction':
      return 'Check every detail in the form: name, photo, category, centre choices'
    case 'admit_card':
      return `Download it and print it${catalog?.site ? ` · ${catalog.site}` : ''}`
    case 'answer_key':
      return 'Check your answers; objections have a short window'
    case 'result':
      return catalog?.site ?? null
    default:
      return null
  }
}

export type ExamRow = typeof e.$inferSelect

/** The language someone's exam plans are written in. */
export { langOf }

/** The board's site for a step's notes, as stepNotes gives it. */
function siteFor(step: ExamStep, exam: { examKey: string | null }): string | null {
  const catalog = examByKey(exam.examKey)
  return step === 'apply_by' || step === 'fee_by' ? (catalog?.applyAt ?? catalog?.site ?? null) : (catalog?.site ?? null)
}

async function owned(userId: string, id: string, exec: Executor = db): Promise<ExamRow | null> {
  const [row] = await exec.select().from(e).where(and(eq(e.id, id), eq(e.userId, userId)))
  return row ?? null
}

/** The plans for an exam's dates that are still to come or done; never the deleted. */
async function datesOf(examIds: string[]) {
  if (examIds.length === 0) return []
  return db
    .select({ id: c.id, examId: c.examId, step: c.examStep, title: c.title, dueAt: c.dueAt, allDay: c.allDay, status: c.status })
    .from(c)
    .where(and(inArray(c.examId, examIds), ne(c.status, 'deleted')))
    .orderBy(asc(c.dueAt))
}

function toDTO(row: ExamRow, dates: Awaited<ReturnType<typeof datesOf>>): ExamDTO {
  return {
    id: row.id,
    examKey: row.examKey,
    name: row.name,
    cycle: row.cycle,
    region: row.region,
    registrationNo: row.registrationNo,
    rollNo: row.rollNo,
    stage: row.stage,
    stageChangedAt: row.stageChangedAt.toISOString(),
    centreName: row.centreName,
    centreAddress: row.centreAddress,
    centreCity: row.centreCity,
    notes: row.notes,
    category: row.category,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    dates: dates
      .filter((d) => d.examId === row.id)
      .map((d) => {
        const split = splitExamStep(d.step)
        return {
          id: d.id,
          step: split?.step ?? 'other',
          round: split?.round ?? null,
          title: d.title,
          dueAt: d.dueAt.toISOString(),
          allDay: d.allDay,
          status: d.status,
        }
      }),
  }
}

/** Open exams first, soonest date first; then the finished, latest first. */
export async function listExams(userId: string, now = new Date()): Promise<ExamDTO[]> {
  const rows = await db.select().from(e).where(eq(e.userId, userId)).orderBy(asc(e.createdAt))
  const dates = await datesOf(rows.map((r) => r.id))
  const next = (x: ExamDTO) =>
    x.dates.find((d) => d.status === 'pending' && new Date(d.dueAt) >= new Date(now.getTime() - 12 * 3_600_000))?.dueAt ?? '9999'
  return rows
    .map((r) => toDTO(r, dates))
    .sort((a, b) => {
      const open = Number(Boolean(a.closedAt)) - Number(Boolean(b.closedAt))
      if (open) return open
      if (a.closedAt && b.closedAt) return b.closedAt.localeCompare(a.closedAt)
      return next(a).localeCompare(next(b))
    })
}

export async function examById(userId: string, id: string): Promise<ExamDTO | null> {
  const row = await owned(userId, id)
  if (!row) return null
  // Official notices about it, as checked and approved, and the result lists
  // its roll number was looked for in: read here, never sent from here.
  const { noticesForExam, checksForExam } = await import('./noticeWatch.ts')
  return {
    ...toDTO(row, await datesOf([id])),
    notices: await noticesForExam(row.examKey, row.cycle),
    checks: await checksForExam(row.id, row.examKey),
    study: await studyFor(row.id),
    mocks: await mocksFor(row.id),
  }
}

/**
 * One date as a plan, with its reminders. Null when that date is already
 * there (the same step on the same day), so a line said twice is one plan.
 */
async function addDate(
  tx: Executor,
  exam: Pick<ExamRow, 'id' | 'orgId' | 'userId' | 'name' | 'cycle' | 'examKey'>,
  date: ExamDateInput,
  now: Date,
  /** What its notes say instead of the usual: the official notice it came from. */
  notes?: string,
): Promise<string | null> {
  const step = date.step
  const stored = date.round && (step === 'exam' || step === 'admit_card' || step === 'result') ? `${step}:${date.round}` : step
  const dueAt = localAt(date.on, date.at, step === 'exam' ? '09:00' : '10:00')
  const [same] = await tx
    .select({ id: c.id, dueAt: c.dueAt })
    .from(c)
    .where(and(eq(c.examId, exam.id), eq(c.examStep, stored), eq(c.status, 'pending')))
  if (same && ymd(same.dueAt) === date.on) return null

  const lang = await langOf(exam.userId, tx)
  const [row] = await tx
    .insert(c)
    .values({
      orgId: exam.orgId,
      userId: exam.userId,
      title: lang === 'hi' ? stepTitleHi(examLabel(exam), step, date.round ?? null, date.note ?? null) : examStepTitle(exam, step, date.round ?? null, date.note ?? null),
      kind: 'task',
      dueAt,
      durationMinutes: step === 'exam' ? 180 : 15,
      notes: notes ?? (lang === 'hi' ? stepNotesHi(step, siteFor(step, exam)) : stepNotes(step, exam)),
      flexibility: 'fixed',
      priority: step === 'apply_by' || step === 'fee_by' || step === 'exam' ? 'high' : 'normal',
      sphere: 'personal',
      examId: exam.id,
      examStep: stored,
    })
    .returning({ id: c.id })
  for (const at of examReminderTimes(step, dueAt, now)) {
    await scheduleFirstReminder({ orgId: exam.orgId, commitmentId: row!.id, fireAt: at }, tx)
  }
  return row!.id
}

function closedAtFor(examKey: string | null, stage: string, now: Date): Date | null {
  return isOpenExamStage(examKey, stage) ? null : now
}

/** An exam, with any dates it came with. */
export async function createExam(
  orgId: string,
  userId: string,
  input: {
    examKey?: string | null
    name: string
    cycle?: string | null
    region?: string | null
    registrationNo?: string | null
    rollNo?: string | null
    notes?: string | null
    stage?: string
    dates?: ExamDateInput[]
  },
  now = new Date(),
): Promise<{ exam: ExamDTO; planIds: string[] } | 'unknown_stage'> {
  const examKey = examByKey(input.examKey) ? input.examKey! : null
  const stage = input.stage ?? (input.dates?.some((d) => d.step === 'apply_by') ? 'to_apply' : 'applied')
  if (!examStages(examKey).some((s) => s.key === stage)) return 'unknown_stage'
  const { id, planIds } = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(e)
      .values({
        orgId,
        userId,
        examKey,
        name: input.name.trim(),
        cycle: input.cycle?.trim() || null,
        region: input.region?.trim() || null,
        registrationNo: input.registrationNo?.trim() || null,
        rollNo: input.rollNo?.trim() || null,
        notes: input.notes?.trim() || null,
        stage,
        closedAt: closedAtFor(examKey, stage, now),
      })
      .returning()
    const planIds: string[] = []
    for (const d of input.dates ?? []) {
      const planId = await addDate(tx, row!, d, now)
      if (planId) planIds.push(planId)
    }
    return { id: row!.id, planIds }
  })
  return { exam: (await examById(userId, id))!, planIds }
}

/**
 * Changes to an exam. A stage that ends it (selected, not this time,
 * dropped) takes its dates still to come with it: there is no exam to sit.
 */
export async function updateExam(
  userId: string,
  id: string,
  patch: Partial<{
    name: string
    cycle: string | null
    region: string | null
    registrationNo: string | null
    rollNo: string | null
    notes: string | null
    stage: string
    centreName: string | null
    centreAddress: string | null
    centreCity: string | null
    category: string | null
  }>,
  now = new Date(),
): Promise<ExamDTO | null | 'unknown_stage'> {
  const row = await owned(userId, id)
  if (!row) return null
  if (patch.stage !== undefined && !examStages(row.examKey).some((s) => s.key === patch.stage)) return 'unknown_stage'
  const moved = patch.stage !== undefined && patch.stage !== row.stage
  const values = {
    ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    ...(moved ? { stageChangedAt: now, closedAt: closedAtFor(row.examKey, patch.stage!, now) } : {}),
  }
  if (Object.keys(values).length === 0) return examById(userId, id)
  await db.transaction(async (tx) => {
    await tx.update(e).set(values).where(eq(e.id, id))
    if (moved && !isOpenExamStage(row.examKey, patch.stage!)) {
      await stopStudy(id, now, tx)
      const ahead = await tx
        .select({ id: c.id })
        .from(c)
        .where(and(eq(c.examId, id), eq(c.status, 'pending'), gt(c.dueAt, now)))
      for (const plan of ahead) {
        await tx.update(c).set({ status: 'deleted', deletedAt: now }).where(eq(c.id, plan.id))
        await cancelPendingReminders(plan.id, tx)
      }
    }
  })
  return examById(userId, id)
}

/** Gone, with its dates still to come; what was done stays done. */
export async function deleteExam(userId: string, id: string, now = new Date()): Promise<boolean> {
  const row = await owned(userId, id)
  if (!row) return false
  await db.transaction(async (tx) => {
    await stopStudy(id, now, tx)
    const pending = await tx.select({ id: c.id }).from(c).where(and(eq(c.examId, id), eq(c.status, 'pending')))
    for (const plan of pending) {
      await tx.update(c).set({ status: 'deleted', deletedAt: now }).where(eq(c.id, plan.id))
      await cancelPendingReminders(plan.id, tx)
    }
    await tx.delete(e).where(eq(e.id, id))
  })
  return true
}

/** One more date for an exam. Null when the exam is not theirs; no plan id when that date was already there. */
export async function addExamDate(
  userId: string,
  id: string,
  date: ExamDateInput,
  now = new Date(),
): Promise<{ planId: string | null } | null> {
  const row = await owned(userId, id)
  if (!row) return null
  return { planId: await db.transaction((tx) => addDate(tx, row, date, now)) }
}

/** The open exam a line or a card is about: the same exam, and the same year when both say one. */
async function openExamFor(userId: string, examKey: string, cycle: string | null, exec: Executor = db): Promise<ExamRow | null> {
  const rows = await exec
    .select()
    .from(e)
    .where(and(eq(e.userId, userId), eq(e.examKey, examKey), isNull(e.closedAt)))
    .orderBy(asc(e.createdAt))
  return rows.find((r) => !cycle || !r.cycle || r.cycle === cycle) ?? null
}

/**
 * A typed line about an exam: onto the exam already tracked — its numbers
 * filled in, its stage moved on, its new dates added — or a new one.
 */
export async function saveExamLine(
  orgId: string,
  userId: string,
  p: ParsedExamLine,
  now = new Date(),
): Promise<{ examId: string; created: boolean; planIds: string[] }> {
  const existing = await openExamFor(userId, p.examKey, p.cycle)
  // A mock score: onto the exam being prepared for, started if it is not tracked yet.
  if (p.mock) {
    let examId = existing?.id
    let created = false
    if (!examId) {
      const made = await createExam(orgId, userId, { examKey: p.examKey, name: p.name, cycle: p.cycle, stage: 'to_apply' }, now)
      if (made === 'unknown_stage') throw new Error('unknown_stage')
      examId = made.exam.id
      created = true
    }
    await addMock(userId, examId, { takenOn: ymd(now), score: p.mock.score, outOf: p.mock.outOf, note: null })
    return { examId, created, planIds: [] }
  }
  if (!existing) {
    const made = await createExam(
      orgId,
      userId,
      { examKey: p.examKey, name: p.name, cycle: p.cycle, region: p.region, registrationNo: p.registrationNo, rollNo: p.rollNo, stage: p.stage ?? undefined, dates: p.dates },
      now,
    )
    if (made === 'unknown_stage') throw new Error('unknown_stage')
    return { examId: made.exam.id, created: true, planIds: made.planIds }
  }
  // A stage moves forward, or to how it ended; never back.
  const stage = p.stage && (isLaterExamStage(existing.examKey, p.stage, existing.stage) || !isOpenExamStage(existing.examKey, p.stage)) ? p.stage : null
  await updateExam(
    userId,
    existing.id,
    {
      ...(stage ? { stage } : {}),
      ...(p.cycle && !existing.cycle ? { cycle: p.cycle } : {}),
      ...(p.region && !existing.region ? { region: p.region } : {}),
      ...(p.registrationNo ? { registrationNo: p.registrationNo } : {}),
      ...(p.rollNo ? { rollNo: p.rollNo } : {}),
    },
    now,
  )
  const planIds: string[] = []
  await db.transaction(async (tx) => {
    for (const d of p.dates) {
      const planId = await addDate(tx, { ...existing, cycle: existing.cycle ?? p.cycle }, d, now)
      if (planId) planIds.push(planId)
    }
  })
  return { examId: existing.id, created: false, planIds }
}

export interface ExamDaySaved {
  examId: string
  planId: string
  /** The trip to the centre's city, when it is not home. */
  trip: { id: string; placeLabel: string; created: boolean } | null
  /** Why there is no trip, when that is worth saying. */
  travel: 'trip' | 'home' | 'no-home-city' | 'no-city'
}

/**
 * The day itself, from an admit card the person has checked: the exam's roll
 * number and centre; one plan at reporting time, its notes saying when the
 * gate closes and when the exam runs, with what to carry as its checklist;
 * and, for a centre in another city, the trip there with a to-do to book
 * the journey. Said again (a corrected card), the same plan is put right.
 */
export async function saveExamDay(orgId: string, userId: string, card: ExamDayInput, now = new Date()): Promise<ExamDaySaved | 'not_found'> {
  return db.transaction(async (tx) => {
    // Which exam: the one named, the one tracked for this card, or a new one.
    let exam = card.examId ? await owned(userId, card.examId, tx) : null
    if (card.examId && !exam) return 'not_found' as const
    if (!exam && card.examKey && examByKey(card.examKey)) exam = await openExamFor(userId, card.examKey, null, tx)
    if (!exam) {
      const key = examByKey(card.examKey) ? card.examKey! : null
      const [made] = await tx
        .insert(e)
        .values({ orgId, userId, examKey: key, name: examByKey(key)?.name ?? card.examName?.trim() ?? 'Exam', stage: 'applied' })
        .returning()
      exam = made!
    }

    // Where it stands: at this round now.
    const rounds = examStages(exam.examKey).filter((s) => !s.closed && s.key !== 'to_apply' && s.key !== 'applied')
    const round = card.round && rounds.some((r) => r.key === card.round) ? card.round : null
    const at = round ?? (exam.stage === 'to_apply' || exam.stage === 'applied' ? (rounds[0]?.key ?? null) : null)
    const stage = at && isLaterExamStage(exam.examKey, at, exam.stage) ? at : null
    await tx
      .update(e)
      .set({
        ...(card.rollNo ? { rollNo: card.rollNo } : {}),
        ...(card.registrationNo && !exam.registrationNo ? { registrationNo: card.registrationNo } : {}),
        centreName: card.centreName ?? exam.centreName,
        centreAddress: card.centreAddress ?? exam.centreAddress,
        centreCity: card.centreCity ?? exam.centreCity,
        ...(stage ? { stage, stageChangedAt: now } : {}),
      })
      .where(eq(e.id, exam.id))

    // The plan: from reporting time, to when the exam ends.
    const startsAt = card.startsAt ? localAt(card.date, card.startsAt) : null
    const dueAt = card.reportingAt
      ? localAt(card.date, card.reportingAt)
      : startsAt
        ? new Date(startsAt.getTime() - 60 * 60_000)
        : localAt(card.date, '08:00')
    const endsAt = card.endsAt ? localAt(card.date, card.endsAt) : null
    const minutes = endsAt && endsAt > dueAt ? Math.round((endsAt.getTime() - dueAt.getTime()) / 60_000) : 180
    const lang = await langOf(userId, tx)
    const times = [
      card.reportingAt ? `Report by ${clock(card.reportingAt)}` : null,
      card.gateClosesAt ? `gate closes ${clock(card.gateClosesAt)}` : null,
      card.startsAt ? `exam ${clock(card.startsAt)}${card.endsAt ? `–${clock(card.endsAt)}` : ''}` : null,
    ].filter(Boolean)
    const notes = [
      times.join(' · ') || null,
      card.rollNo ? `Roll no ${card.rollNo}` : null,
      [card.centreName, card.centreAddress].filter(Boolean).join(', ') || null,
      'Phone, smartwatch and bag stay at home or outside.',
    ]
      .filter(Boolean)
      .join('\n')
    const notesFor =
      lang === 'hi'
        ? examDayNotesHi({
            reportingAt: card.reportingAt ?? null,
            gateClosesAt: card.gateClosesAt ?? null,
            startsAt: card.startsAt ?? null,
            endsAt: card.endsAt ?? null,
            rollNo: card.rollNo ?? null,
            centre: [card.centreName, card.centreAddress].filter(Boolean).join(', ') || null,
            clock,
          })
        : notes
    const title = lang === 'hi' ? stepTitleHi(examLabel(exam), 'exam', round ?? at, null) : examStepTitle(exam, 'exam', round ?? at)
    const stored = round ?? at ? `exam:${round ?? at}` : 'exam'

    // The trip, for a centre away from home.
    const [user] = await tx.select({ home: schema.users.homeCity }).from(schema.users).where(eq(schema.users.id, userId))
    const city = card.centreCity?.trim() || null
    const home = user?.home ?? null
    const away = city && home && !sameCity(city, home)
    // From the day before: a centre in another city means arriving early.
    const dayBefore = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate() - 1, 12, 0)
    const trip = away
      ? await tripForBooking(orgId, userId, { type: 'hotel', startsAt: dayBefore, endsOn: card.date, city, fromCity: home }, tx)
      : null

    // The same day said again is put right, not added twice: the exam's plan
    // on that day, or for this round, or one typed earlier with no round.
    const planned = await tx
      .select({ id: c.id, dueAt: c.dueAt, step: c.examStep })
      .from(c)
      .where(and(eq(c.examId, exam.id), like(c.examStep, 'exam%'), eq(c.status, 'pending')))
      .orderBy(asc(c.dueAt))
    const sameDay =
      planned.find((p) => ymd(p.dueAt) === card.date) ??
      planned.find((p) => p.step === stored) ??
      planned.find((p) => p.step === 'exam' && p.dueAt > now) ??
      null
    let planId: string
    if (sameDay) {
      await tx
        .update(c)
        .set({ title, notes: notesFor, dueAt, durationMinutes: minutes, placeLabel: card.centreName ?? city, examStep: stored, escalationCount: 0, ...(trip ? { tripId: trip.tripId } : {}) })
        .where(eq(c.id, sameDay.id))
      await cancelPendingReminders(sameDay.id, tx)
      planId = sameDay.id
    } else {
      const [row] = await tx
        .insert(c)
        .values({
          orgId,
          userId,
          title,
          kind: 'task',
          dueAt,
          durationMinutes: minutes,
          notes: notesFor,
          placeLabel: card.centreName ?? city,
          flexibility: 'fixed',
          priority: 'high',
          sphere: 'personal',
          tripId: trip?.tripId ?? null,
          examId: exam.id,
          examStep: stored,
        })
        .returning({ id: c.id })
      planId = row!.id
    }
    for (const fireAt of examReminderTimes('exam', dueAt, now)) {
      await scheduleFirstReminder({ orgId, commitmentId: planId, fireAt }, tx)
    }

    // What to carry, once: a list ticked off is not put back.
    const [listed] = await tx.select({ id: schema.checklistItems.id }).from(schema.checklistItems).where(eq(schema.checklistItems.commitmentId, planId)).limit(1)
    if (!listed) {
      await tx.insert(schema.checklistItems).values((lang === 'hi' ? carryHi(Boolean(examByKey(exam.examKey)?.carry?.length), exam.examKey === 'neet-ug') : examDayCarry(exam.examKey)).map((text, position) => ({ orgId, commitmentId: planId, text, position })))
    }

    // Getting there, for a new trip: book the journey well before.
    if (trip?.created) {
      const tenBefore = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate() - 10, 10, 0)
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 10, 0)
      const bookBy = tenBefore > tomorrow ? tenBefore : tomorrow
      if (bookBy < dueAt) {
        const [todo] = await tx
          .insert(c)
          .values({
            orgId,
            userId,
            title: lang === 'hi' ? `${city} जाने का टिकट बुक करें: ${examLabel(exam)}` : `Book your journey to ${city} for ${examLabel(exam)}`,
            kind: 'task',
            dueAt: bookBy,
            durationMinutes: 15,
            notes:
              lang === 'hi'
                ? `एक दिन पहले पहुँचें: रिपोर्टिंग ${clock(card.reportingAt ?? `${pad(dueAt.getHours())}:${pad(dueAt.getMinutes())}`)} पर है।`
                : `Arrive the day before: reporting is at ${clock(card.reportingAt ?? `${pad(dueAt.getHours())}:${pad(dueAt.getMinutes())}`)}.`,
            flexibility: 'fixed',
            sphere: 'personal',
            tripId: trip.tripId,
            examId: exam.id,
            examStep: 'other',
          })
          .returning({ id: c.id })
        await scheduleFirstReminder({ orgId, commitmentId: todo!.id, fireAt: bookBy }, tx)
      }
    }

    return {
      examId: exam.id,
      planId,
      trip: trip ? { id: trip.tripId, placeLabel: trip.placeLabel, created: trip.created } : null,
      travel: trip ? 'trip' : !city ? 'no-city' : !home ? 'no-home-city' : 'home',
    } satisfies ExamDaySaved
  })
}

/** The exam a line would be added to, for saying so before it is saved. */
export async function trackedExam(userId: string, examKey: string, cycle: string | null): Promise<{ id: string; cycle: string | null } | null> {
  const row = await openExamFor(userId, examKey, cycle)
  return row ? { id: row.id, cycle: row.cycle } : null
}

const dayWords = (day: string) => localAt(day, null).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })

/** When a "go and look" plan is for: shortly, or tomorrow morning if it is late. */
function shortly(now: Date): { on: string; at: string } {
  const at = new Date(Math.ceil((now.getTime() + 15 * 60_000) / (15 * 60_000)) * 15 * 60_000)
  if (at.getHours() >= 21 || at.getDate() !== now.getDate()) {
    const morning = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0)
    return { on: ymd(morning), at: '09:00' }
  }
  return { on: ymd(at), at: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
}

/** A step this exam already has a plan for, done or not: news is told once. */
async function hasStep(examId: string, step: string): Promise<boolean> {
  const [row] = await db
    .select({ id: c.id })
    .from(c)
    .where(and(eq(c.examId, examId), like(c.examStep, `${step}%`), ne(c.status, 'deleted')))
    .limit(1)
  return Boolean(row)
}

/** Kinds of news anyone may pass on about an exam already tracked; the rest only the board can say. */
const NEWS = new Set(['admit_card', 'answer_key', 'result'])

/**
 * An exam board's email, made into what it means for the exam it is about:
 * a registration starts it (or fills in its number), a fee still to pay is
 * a date, a city slip gives the exam's day and city, an admit card out is a
 * plan to download it — or, attached in full, the exam day itself — and a
 * result or a shortlist moves it on.
 *
 * Only the board itself can start an exam or set its dates; a coaching
 * site's "admit card out!" can only add that news to an exam already
 * tracked. Returns what was done, in words, or null when nothing was.
 */
export async function examFromEmail(
  orgId: string,
  userId: string,
  m: ExamMail,
  opts: { official: boolean; card: AdmitCard | null; receivedAt: Date },
  now = new Date(),
): Promise<string | null> {
  let exam = await openExamFor(userId, m.examKey, m.cycle)
  if (!exam && (!opts.official || m.kind === 'result' || m.kind === 'answer_key')) return null
  if (!opts.official && !NEWS.has(m.kind)) return null
  const label = examLabel({ name: m.name, cycle: exam?.cycle ?? m.cycle })

  // The admit card itself, attached by the board: the day, planned from it.
  const card = opts.card
  if (opts.official && card?.date && (card.reportingAt || card.startsAt) && card.date >= ymd(now)) {
    const saved = await saveExamDay(
      orgId,
      userId,
      {
        examId: exam?.id ?? null,
        examKey: m.examKey,
        examName: m.name,
        round: card.round ?? m.round,
        date: card.date,
        reportingAt: card.reportingAt,
        gateClosesAt: card.gateClosesAt,
        startsAt: card.startsAt,
        endsAt: card.endsAt,
        rollNo: card.rollNo ?? m.rollNo,
        registrationNo: card.registrationNo ?? m.registrationNo,
        centreName: card.centreName,
        centreAddress: card.centreAddress,
        centreCity: card.centreCity,
      },
      now,
    )
    if (saved !== 'not_found') {
      const report = card.reportingAt ?? card.startsAt!
      return `${label}: exam day planned from the admit card — ${dayWords(card.date)}, report by ${clock(report)}${card.centreName ? ` · ${card.centreName}` : ''}. Check it in Exams.`
    }
  }

  // Where it stands now, as the board says.
  const said =
    m.kind === 'selected'
      ? 'selected'
      : m.kind === 'shortlisted'
        ? m.nextRound
        : m.kind === 'registered' || m.kind === 'fee_paid'
          ? 'applied'
          : (m.kind === 'admit_card' || m.kind === 'city_slip') && m.round
            ? m.round
            : null
  let changed = false
  if (!exam) {
    const made = await createExam(
      orgId,
      userId,
      {
        examKey: m.examKey,
        name: m.name,
        cycle: m.cycle,
        registrationNo: m.registrationNo,
        rollNo: m.rollNo,
        stage: m.kind === 'fee_due' ? 'to_apply' : (said ?? 'applied'),
      },
      now,
    )
    if (made === 'unknown_stage') return null
    exam = await owned(userId, made.exam.id)
    changed = true
  } else if (opts.official) {
    const stage = said && (isLaterExamStage(exam.examKey, said, exam.stage) || !isOpenExamStage(exam.examKey, said)) ? said : null
    const patch = {
      ...(stage ? { stage } : {}),
      ...(m.registrationNo && !exam.registrationNo ? { registrationNo: m.registrationNo } : {}),
      ...(m.rollNo && m.rollNo !== exam.rollNo ? { rollNo: m.rollNo } : {}),
      ...(m.cycle && !exam.cycle ? { cycle: m.cycle } : {}),
    }
    if (Object.keys(patch).length > 0) {
      await updateExam(userId, exam.id, patch, now)
      changed = true
    }
  }
  if (!exam) return null
  if (opts.official && m.city && !exam.centreCity) {
    await db.update(e).set({ centreCity: m.city }).where(eq(e.id, exam.id))
    changed = true
  }

  // Its dates, from the board; and news to act on, once and while it is news.
  const dates: ExamDateInput[] = opts.official ? m.dates.map((d) => ({ ...d })) : []
  const fresh = now.getTime() - opts.receivedAt.getTime() < 3 * 86_400_000
  const soon = shortly(now)
  if (m.kind === 'admit_card' && !dates.some((d) => d.step === 'admit_card') && fresh && !(await hasStep(exam.id, 'admit_card'))) {
    dates.push({ step: 'admit_card', on: soon.on, at: soon.at, round: m.round })
  }
  if (m.kind === 'result' && fresh && !(await hasStep(exam.id, m.round ? `result:${m.round}` : 'result'))) {
    dates.push({ step: 'result', on: soon.on, at: soon.at, round: m.round })
  }
  if (m.kind === 'answer_key' && dates.length === 0 && fresh && !(await hasStep(exam.id, 'answer_key'))) {
    dates.push({ step: 'answer_key', on: soon.on, at: soon.at, round: m.round })
  }
  const added: ExamDateInput[] = []
  const row = exam
  await db.transaction(async (tx) => {
    for (const d of dates) if (await addDate(tx, row, d, now)) added.push(d)
  })
  if (!changed && added.length === 0) return null

  const examDay = added.find((d) => d.step === 'exam') ?? m.dates.find((d) => d.step === 'exam')
  const by = (step: string) => added.find((d) => d.step === step)
  const mask = (n: string) => `…${n.slice(-4)}`
  const objectBy = by('answer_key')
  const what =
    m.kind === 'registered'
      ? `registered${m.registrationNo ? ` · reg no ${mask(m.registrationNo)}` : ''}`
      : m.kind === 'fee_due'
        ? `fee still to pay${by('fee_by') ? ` by ${dayWords(by('fee_by')!.on)}` : ''}`
        : m.kind === 'fee_paid'
          ? 'fee paid'
          : m.kind === 'city_slip'
            ? `exam city ${m.city ?? 'out'}${examDay ? `, exam ${dayWords(examDay.on)}` : ''}`
            : m.kind === 'admit_card'
              ? `admit card out${examDay ? ` — exam ${dayWords(examDay.on)}` : ''}. Download it and print it`
              : m.kind === 'answer_key'
                ? `answer key out${objectBy && objectBy.on !== soon.on ? ` — objections till ${dayWords(objectBy.on)}` : ''}`
                : m.kind === 'result'
                  ? 'result declared. Check it'
                  : m.kind === 'shortlisted'
                    ? `shortlisted${m.nextRound ? ` for ${examStage(m.examKey, m.nextRound)?.label ?? m.nextRound}` : ''}`
                    : m.kind === 'selected'
                      ? 'selected'
                      : `exam ${examDay ? dayWords(examDay.on) : 'scheduled'}`
  return `${label}: ${what}`
}

/**
 * An approved official notice, made into plans on everyone's exam it is
 * about: the open ones with that exam, of that year when both say one. Each
 * date a plan with the notice in its notes; a notice with no date is a plan
 * to read it. Returns the exams it went onto.
 */
export async function examsForNotice(examKey: string, cycle: string | null): Promise<ExamRow[]> {
  const rows = await db.select().from(e).where(and(eq(e.examKey, examKey), isNull(e.closedAt)))
  return rows.filter((r) => !cycle || !r.cycle || r.cycle === cycle)
}

export async function addNoticeToExam(
  exam: ExamRow,
  notice: { url: string; kind: string; summary: string; summaryHi?: string; dates: ExamDateInput[] },
  now = new Date(),
): Promise<number> {
  const lang = await langOf(exam.userId)
  const notes = lang === 'hi' ? `आधिकारिक सूचना: ${notice.url}` : `From the official notice: ${notice.url}`
  const soon = shortly(now)
  const step = notice.kind === 'admit_card' || notice.kind === 'answer_key' || notice.kind === 'result' ? notice.kind : 'other'
  const dates: ExamDateInput[] =
    notice.dates.length > 0
      ? notice.dates
      : [{ step, on: soon.on, at: soon.at, round: null, note: step === 'other' ? (lang === 'hi' && notice.summaryHi ? `नई सूचना — ${notice.summaryHi}` : `new notice — ${notice.summary.split(': ').slice(1).join(': ')}`) : null }]
  let added = 0
  await db.transaction(async (tx) => {
    for (const d of dates) if (await addDate(tx, exam, d, now, notes)) added++
  })
  return added
}

/** The row itself, for those who need more than its page: the numbers to look for. */
export async function examRowOf(userId: string, id: string): Promise<ExamRow | null> {
  return owned(userId, id)
}

// ── Preparing ────────────────────────────────────────────────────────────

const rec = schema.recurrences

/** The study plan running for an exam: its series, each subject on its days. */
export async function studyFor(examId: string): Promise<StudySeriesDTO[]> {
  const rows = await db
    .select()
    .from(rec)
    .where(and(eq(rec.examId, examId), eq(rec.status, 'active')))
    .orderBy(asc(rec.createdAt))
  // Monday first, the mock test last: the week as it is lived.
  const first = (r: (typeof rows)[number]) => Math.min(...(r.byWeekday ?? [0]).map((d) => (d + 6) % 7))
  rows.sort((a, b) => first(a) - first(b))
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    weekdays: r.byWeekday ?? [],
    hour: r.hour,
    minute: r.minute,
    durationMinutes: r.durationMinutes,
    untilOn: r.untilOn,
  }))
}

/** An exam's study plan stopped: what is still to come goes; what was studied stays. */
export async function stopStudy(examId: string, now = new Date(), exec: Executor = db): Promise<number> {
  const rows = await exec.select({ id: rec.id }).from(rec).where(and(eq(rec.examId, examId), eq(rec.status, 'active')))
  for (const r of rows) await stopSeries(r.id, { now }, exec)
  return rows.length
}

/**
 * A study plan for an exam: the subjects dealt across the days chosen, each
 * a weekly series at the hour chosen, and the mock test on its own day —
 * until the day before the exam, or the day given, or twelve weeks on. A
 * plan made again replaces the last one.
 */
export async function makeStudyPlan(
  userId: string,
  examId: string,
  input: {
    subjects: string[]
    days: number[]
    at: string
    minutes: number
    mock: { day: number; at: string; minutes: number } | null
    until?: string | null
  },
  now = new Date(),
): Promise<StudySeriesDTO[] | null> {
  const exam = await owned(userId, examId)
  if (!exam) return null
  const lang = await langOf(userId)
  const time = (t: string) => ({ hour: Number(t.slice(0, 2)), minute: Number(t.slice(3, 5)) })

  // Until the day before the exam, when its day is known.
  const [next] = await db
    .select({ dueAt: c.dueAt })
    .from(c)
    .where(and(eq(c.examId, examId), like(c.examStep, 'exam%'), eq(c.status, 'pending'), gt(c.dueAt, now)))
    .orderBy(asc(c.dueAt))
    .limit(1)
  const dayBefore = next ? ymd(new Date(next.dueAt.getFullYear(), next.dueAt.getMonth(), next.dueAt.getDate() - 1)) : null
  const twelveWeeks = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 84))
  const until = input.until ?? dayBefore ?? twelveWeeks
  const name = examLabel(exam)

  const week = studyWeek({
    examName: name,
    subjects: input.subjects,
    days: input.days,
    at: time(input.at),
    minutes: input.minutes,
    mock: input.mock ? { day: input.mock.day, at: time(input.mock.at), minutes: input.mock.minutes } : null,
  })

  await db.transaction(async (tx) => {
    await stopStudy(examId, now, tx)
    for (const s of week) {
      const title = lang === 'hi' ? (s.mock ? `मॉक टेस्ट: ${name}` : `पढ़ाई ${s.subject}: ${name}`) : s.title
      const [row] = await tx
        .insert(rec)
        .values({
          orgId: exam.orgId,
          userId,
          title,
          kind: 'task',
          durationMinutes: s.durationMinutes,
          freq: 'weekly',
          interval: 1,
          byWeekday: s.weekdays,
          startsOn: ymd(now),
          hour: s.hour,
          minute: s.minute,
          untilOn: until,
          sphere: 'personal',
          examId,
        })
        .returning()
      await materialise(row!, { now }, tx)
    }
  })
  return studyFor(examId)
}

/** Mock test scores for an exam, oldest first. */
export async function mocksFor(examId: string): Promise<MockScoreDTO[]> {
  const rows = await db
    .select()
    .from(schema.examMocks)
    .where(eq(schema.examMocks.examId, examId))
    .orderBy(asc(schema.examMocks.takenOn), asc(schema.examMocks.createdAt))
  return rows.map((r) => ({ id: r.id, takenOn: r.takenOn, score: r.score, outOf: r.outOf, note: r.note }))
}

export async function addMock(
  userId: string,
  examId: string,
  m: { takenOn: string; score: number; outOf: number; note?: string | null },
): Promise<MockScoreDTO[] | null> {
  if (!(await owned(userId, examId))) return null
  await db.insert(schema.examMocks).values({ examId, takenOn: m.takenOn, score: m.score, outOf: m.outOf, note: m.note?.trim() || null })
  return mocksFor(examId)
}

export async function deleteMock(userId: string, examId: string, mockId: string): Promise<boolean> {
  if (!(await owned(userId, examId))) return false
  const gone = await db
    .delete(schema.examMocks)
    .where(and(eq(schema.examMocks.id, mockId), eq(schema.examMocks.examId, examId)))
    .returning({ id: schema.examMocks.id })
  return gone.length > 0
}
