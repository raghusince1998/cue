import { and, eq, isNotNull, lt, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { addExamDate, addMock, createExam, makeStudyPlan, remindCertificate, saveExamDay, saveExpectedScore, updateExam } from './exams.ts'

/**
 * A Cue Exams demo: an aspirant's account, filled the way a few weeks of
 * real use would leave it, so the whole exams side can be seen at once —
 * without typing, and without anyone's real data.
 *
 * - SSC CGL in 12 days, its admit card read (reporting, gate, centre), the
 *   carry list, a study plan running since Monday, four mock scores rising.
 * - REET on the same day: a clash, said on Today and on the exams page.
 * - SSC CHSL with its form still to fill: last date in 5 days, the fee in
 *   7, and the list of what the form asks for.
 * - RRB NTPC at document verification in 18 days, with what to bring, and
 *   the score worked out from the CBT 2 answer key.
 * - OBC, so the yearly certificate reminder is set.
 *
 * Every date is relative to now, so the demo is always current.
 */

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (now: Date, n: number) => ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n))

export async function loadExamsDemo(orgId: string, userId: string, now = new Date()): Promise<void> {
  const created = async (input: Parameters<typeof createExam>[2]) => {
    const made = await createExam(orgId, userId, input, now)
    if (made === 'unknown_stage') throw new Error(`demo exam ${input.name}: unknown stage`)
    return made.exam.id
  }

  // SSC CGL first: the category is set on it, and the rest inherit it.
  const examDay = day(now, 12)
  const cgl = await created({
    examKey: 'ssc-cgl',
    name: 'SSC CGL',
    cycle: '2026',
    stage: 'applied',
    registrationNo: '2026CGL0451932',
    dates: [{ step: 'exam', on: examDay, round: 'tier1' }],
  })
  await updateExam(userId, cgl, { category: 'OBC' }, now)
  await saveExamDay(
    orgId,
    userId,
    {
      examId: cgl,
      round: 'tier1',
      date: examDay,
      reportingAt: '07:30',
      gateClosesAt: '08:30',
      startsAt: '09:00',
      endsAt: '10:00',
      rollNo: '2201004517',
      centreName: 'iON Digital Zone iDZ Sitapura',
      centreAddress: 'RIICO Industrial Area, Sitapura, Tonk Road',
      centreCity: 'Jaipur',
    },
    now,
  )
  for (const [ago, score] of [
    [22, 108],
    [15, 116],
    [8, 121],
    [1, 129],
  ] as const) {
    await addMock(userId, cgl, { takenOn: day(now, -ago), score, outOf: 200, note: null })
  }

  // The study plan has run since Monday: what was due so far is done, bar
  // one missed earlier in the week — the kind of week the Sunday report is
  // about, with nothing left overdue on Today.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 0, 0)
  await makeStudyPlan(
    userId,
    cgl,
    {
      subjects: ['Quantitative aptitude', 'Reasoning', 'English', 'General awareness'],
      days: [1, 2, 3, 4, 5, 6],
      at: '06:30',
      minutes: 90,
      mock: { day: 0, at: '10:00', minutes: 60 },
    },
    monday,
  )
  const c = schema.commitments
  const sessions = await db
    .select({ id: c.id })
    .from(c)
    .innerJoin(schema.recurrences, eq(c.recurrenceId, schema.recurrences.id))
    .where(and(eq(c.userId, userId), isNotNull(schema.recurrences.examId), lt(c.dueAt, now)))
    .orderBy(c.dueAt)
  const missed = sessions.length >= 2 ? sessions.length - 2 : -1
  for (const [i, s] of sessions.entries()) {
    await db
      .update(c)
      .set(i === missed ? { status: 'cancelled' } : { status: 'done', completedAt: sql`${c.dueAt} + interval '90 minutes'` })
      .where(eq(c.id, s.id))
  }
  // Their reminders went long ago; nothing should buzz for a demo's past.
  await db
    .update(schema.reminders)
    .set({ status: 'cancelled' })
    .where(and(eq(schema.reminders.status, 'pending'), lt(schema.reminders.fireAt, now), sql`${schema.reminders.commitmentId} in (select id from commitments where user_id = ${userId})`))

  // REET on the very same day: the clash Cue points out.
  await created({ examKey: 'reet', name: 'REET', cycle: '2026', stage: 'applied', dates: [{ step: 'exam', on: examDay }] })

  // A form still to fill, with what it asks for.
  await created({
    examKey: 'ssc-chsl',
    name: 'SSC CHSL',
    cycle: '2027',
    stage: 'to_apply',
    dates: [
      { step: 'apply_by', on: day(now, 5) },
      { step: 'fee_by', on: day(now, 7) },
    ],
  })

  // Through both CBTs, on to document verification.
  const ntpc = await created({
    examKey: 'rrb-ntpc',
    name: 'RRB NTPC',
    cycle: 'CEN 05/2024',
    region: 'RRB Ajmer',
    stage: 'dv',
    registrationNo: '0524AJM118734',
    rollNo: '1324011873',
  })
  await addExamDate(userId, ntpc, { step: 'exam', on: day(now, 18), at: '09:00', round: 'dv' }, now)
  await saveExpectedScore(userId, ntpc, { round: 'cbt2', right: 92, wrong: 18 }, now)

  await remindCertificate(orgId, userId, 'OBC', now)
}
