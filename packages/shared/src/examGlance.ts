import { examLabel } from './exams.ts'
import type { ExamClash } from './examClash.ts'

/**
 * An aspirant's exams at a glance, for the top of Today: the next exam and
 * how far off it is, a last date coming up in the next two weeks, and any
 * dates that clash. Worked out from what Cue already holds; nothing at all
 * when no exam is still going, so Today stays as it was for everyone else.
 */

/** What a glance needs of an exam: the shape of ExamDTO, no more. */
export interface GlanceExam {
  id: string
  examKey: string | null
  name: string
  cycle: string | null
  closedAt: string | null
  dates: { step: string; round: string | null; dueAt: string; allDay: boolean; status: string }[]
}

export interface ExamGlanceItem {
  examId: string
  examKey: string | null
  /** "SSC CGL 2026" */
  label: string
  step: string
  round: string | null
  /** The plan's time, ISO. */
  on: string
  allDay: boolean
}

export interface ExamGlance {
  next: ExamGlanceItem | null
  /** Last dates to apply, pay or correct, within GLANCE_DAYS: the ones that cost a year if missed. */
  soon: ExamGlanceItem[]
  /** Clashes worth a decision: not two shifts far apart in one city. */
  clashes: { kind: ExamClash['kind']; on: string; a: string; b: string }[]
}

export const GLANCE_DAYS = 14
const DEADLINES = new Set(['apply_by', 'fee_by', 'correction'])

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Whole days from today to that day, by the calendar: 0 today, 1 tomorrow. */
export function daysAway(iso: string, now = new Date()): number {
  const day = startOfDay(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso))
  return Math.round((day.getTime() - startOfDay(now).getTime()) / 86_400_000)
}

export function examGlance(exams: readonly GlanceExam[], clashes: readonly ExamClash[], now = new Date()): ExamGlance {
  const today = startOfDay(now).getTime()
  const horizon = today + (GLANCE_DAYS + 1) * 86_400_000
  const items = exams
    .filter((x) => !x.closedAt)
    .flatMap((x) =>
      x.dates
        .filter((d) => d.status === 'pending' && new Date(d.dueAt).getTime() >= today)
        .map<ExamGlanceItem>((d) => ({
          examId: x.id,
          examKey: x.examKey,
          label: examLabel(x),
          step: d.step,
          round: d.round,
          on: d.dueAt,
          allDay: d.allDay,
        })),
    )
    .sort((a, b) => a.on.localeCompare(b.on))
  return {
    next: items.find((i) => i.step === 'exam') ?? null,
    soon: items.filter((i) => DEADLINES.has(i.step) && new Date(i.on).getTime() < horizon).slice(0, 3),
    clashes: clashes
      .filter((k) => k.kind !== 'same-day-shifts')
      .slice(0, 2)
      .map((k) => ({ kind: k.kind, on: k.on, a: k.a.label, b: k.b.label })),
  }
}

/** Categories whose certificate most forms want issued in the current financial year. SC and ST certificates do not lapse. */
export const RENEWED_CATEGORIES = ['EWS', 'OBC', 'MBC'] as const
export type RenewedCategory = (typeof RENEWED_CATEGORIES)[number]

export function isRenewedCategory(category: string | null | undefined): category is RenewedCategory {
  return (RENEWED_CATEGORIES as readonly string[]).includes(category ?? '')
}

/** The next 1 April after today: when a new financial year's certificate can be had. */
export function nextFirstApril(now = new Date()): string {
  const year = now.getMonth() < 3 ? now.getFullYear() : now.getFullYear() + 1
  return `${year}-04-01`
}

/** The 1 April this financial year began on: a certificate issued before it is last year's. */
export function financialYearStart(now = new Date()): string {
  const year = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear()
  return `${year}-04-01`
}
