/**
 * Plans that follow a schedule rather than a rhythm.
 *
 * A child's vaccinations are the clearest case: at birth, 6 weeks, 10 weeks,
 * 14 weeks, 9 months, 16 months… Each step is its own thing, at its own
 * distance from one starting date, and no "every N weeks" rule describes
 * them. So a schedule is a starting date and a list of steps, each either a
 * gap after the start or a date of its own.
 *
 * The date arithmetic lives here, shared, so the dates the form previews as
 * you type are exactly the dates the server books.
 */

export const SCHEDULE_UNITS = ['days', 'weeks', 'months', 'years'] as const
export type ScheduleUnit = (typeof SCHEDULE_UNITS)[number]

export interface ScheduleOffset {
  amount: number
  unit: ScheduleUnit
}

export interface ScheduleStep {
  /** What happens at this step, e.g. "OPV-1, Pentavalent-1". May be blank. */
  title?: string
  /** A gap after the schedule's start… */
  offset?: ScheduleOffset | null
  /** …or a date of its own, as YYYY-MM-DD. */
  date?: string | null
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function ymdOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * A YYYY-MM-DD date moved on by a gap.
 *
 * Months and years keep the day of the month where it exists and otherwise
 * use the month's last day: one month after 31 January is 28 (or 29)
 * February, not 3 March, and a year after 29 February is 28 February. That is
 * how people count "9 months old", and plain Date arithmetic would overflow
 * into the next month instead.
 */
export function addToDate(ymd: string, offset: ScheduleOffset): string {
  const m = YMD.exec(ymd)
  if (!m) throw new Error(`not a date: ${ymd}`)
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])
  const amount = Math.max(0, Math.floor(offset.amount))

  if (offset.unit === 'days' || offset.unit === 'weeks') {
    const days = offset.unit === 'weeks' ? amount * 7 : amount
    return ymdOf(new Date(year, month, day + days))
  }

  const months = offset.unit === 'years' ? amount * 12 : amount
  const target = new Date(year, month + months, 1)
  const clamped = Math.min(day, daysInMonth(target.getFullYear(), target.getMonth()))
  return ymdOf(new Date(target.getFullYear(), target.getMonth(), clamped))
}

/** The date a step falls on, or null when it has neither a gap nor a valid date. */
export function stepDate(startsOn: string, step: ScheduleStep): string | null {
  if (step.date) return YMD.test(step.date) ? step.date : null
  if (step.offset && YMD.test(startsOn)) return addToDate(startsOn, step.offset)
  return null
}

/** "At the start", "6 weeks", "1 month", "2 years". */
export function offsetLabel(offset: ScheduleOffset): string {
  if (offset.amount === 0) return 'At the start'
  const unit = offset.amount === 1 ? offset.unit.replace(/s$/, '') : offset.unit
  return `${offset.amount} ${unit}`
}
