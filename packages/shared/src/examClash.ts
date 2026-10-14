import { sameCity } from './bookings.ts'

/**
 * Exam days that collide. An aspirant applies to many exams, and the boards
 * set their dates with no thought for each other: two on one day, or one in
 * Jaipur and the next morning's in Delhi. Found from the dates Cue already
 * holds, so nobody has to notice it themselves.
 */

export interface ExamDayItem {
  examId: string
  /** "SSC CHSL 2026 — Tier 1" */
  label: string
  /** YYYY-MM-DD */
  on: string
  /** HH:MM, only when an admit card said it; a notice's day has no time. */
  at: string | null
  /** The centre's city, once an admit card gave it. */
  city: string | null
}

export interface ExamClash {
  /**
   * same-day: two exams one day, and nothing says they can both be sat.
   * same-day-shifts: one day, but at times far apart in one city.
   * next-day-travel: on following days, in different cities.
   */
  kind: 'same-day' | 'same-day-shifts' | 'next-day-travel'
  on: string
  a: ExamDayItem
  b: ExamDayItem
}

const minutes = (at: string) => {
  const [h, m] = at.split(':').map(Number)
  return h! * 60 + m!
}

const nextDay = (on: string) => {
  const [y, m, d] = on.split('-').map(Number)
  const n = new Date(y!, m! - 1, d! + 1)
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
}

/** Shifts four hours apart or more can both be sat, in one city. */
const SHIFT_GAP = 4 * 60

export function examClashes(days: readonly ExamDayItem[]): ExamClash[] {
  const sorted = [...days].sort((x, y) => x.on.localeCompare(y.on) || (x.at ?? '').localeCompare(y.at ?? ''))
  const out: ExamClash[] = []
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!
      const b = sorted[j]!
      if (a.examId === b.examId) continue
      if (a.on === b.on) {
        const apart = a.at && b.at && Math.abs(minutes(a.at) - minutes(b.at)) >= SHIFT_GAP
        const oneCity = !a.city || !b.city || sameCity(a.city, b.city)
        out.push({ kind: apart && oneCity ? 'same-day-shifts' : 'same-day', on: a.on, a, b })
      } else if (b.on === nextDay(a.on) && a.city && b.city && !sameCity(a.city, b.city)) {
        out.push({ kind: 'next-day-travel', on: a.on, a, b })
      }
    }
  }
  return out
}
