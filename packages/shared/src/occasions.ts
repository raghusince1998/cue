/**
 * Occasions: birthdays and anniversaries, and the festivals a whole contact
 * list is greeted for.
 *
 * Dates are kept as "MM-DD" with no year: most people know a client's
 * birthday, few know how old they are, and the year is not what you need to
 * wish them.
 */

export const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

export type OccasionKind = 'birthday' | 'anniversary'

const DAY_MS = 86_400_000

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** The next time "MM-DD" comes round, today included. 29 Feb is 28 Feb in other years. */
export function nextMonthDay(monthDay: string, now = new Date()): Date | null {
  const m = MONTH_DAY.exec(monthDay)
  if (!m) return null
  const month = Number(m[1]) - 1
  const day = Number(m[2])
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (const year of [now.getFullYear(), now.getFullYear() + 1]) {
    const d = month === 1 && day === 29 && !isLeap(year) ? 28 : day
    const date = new Date(year, month, d)
    // "31-04" and the like do not exist; the Date rolls over and is refused.
    if (date.getMonth() !== month) return null
    if (date >= today) return date
  }
  return null
}

/** Whole days from today: 0 is today. */
export function daysUntil(date: Date, now = new Date()): number {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((date.getTime() - today.getTime()) / DAY_MS)
}

/** "14 Mar" from "03-14". */
export function monthDayLabel(monthDay: string): string {
  const m = MONTH_DAY.exec(monthDay)
  if (!m) return monthDay
  return new Date(2000, Number(m[1]) - 1, Number(m[2])).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export const OCCASION_MESSAGES: Record<OccasionKind, string> = {
  birthday: 'Hi {first}, wishing you a very happy birthday! Have a wonderful year ahead.\n\nWarm regards,\n{me}',
  anniversary: 'Hi {first}, warm wishes on your anniversary! Wishing you many happy years ahead.\n\nWarm regards,\n{me}',
}

/** Festivals and the like, greeted for across a contact list, with a message to start from. */
export const GREETING_OCCASIONS: { key: string; label: string; message: string }[] = [
  {
    key: 'diwali',
    label: 'Diwali',
    message:
      'Hi {first}, wishing you and your family a very happy Diwali! May the festival of lights bring you joy, good health and prosperity.\n\nWarm regards,\n{me}',
  },
  {
    key: 'new-year',
    label: 'New Year',
    message:
      'Hi {first}, wishing you a happy and successful New Year! Thank you for your support this year; I look forward to working together in the year ahead.\n\nWarm regards,\n{me}',
  },
  {
    key: 'christmas',
    label: 'Christmas',
    message: 'Hi {first}, wishing you and your family a merry Christmas and a joyful holiday season!\n\nWarm regards,\n{me}',
  },
  {
    key: 'holi',
    label: 'Holi',
    message: 'Hi {first}, wishing you and your family a colourful and happy Holi!\n\nWarm regards,\n{me}',
  },
  {
    key: 'eid',
    label: 'Eid',
    message: 'Hi {first}, Eid Mubarak! Wishing you and your family peace, happiness and prosperity.\n\nWarm regards,\n{me}',
  },
  {
    key: 'pongal',
    label: 'Pongal / Sankranti',
    message:
      'Hi {first}, wishing you and your family a very happy Pongal and Makar Sankranti!\n\nWarm regards,\n{me}',
  },
  {
    key: 'onam',
    label: 'Onam',
    message: 'Hi {first}, wishing you and your family a very happy Onam!\n\nWarm regards,\n{me}',
  },
  {
    key: 'custom',
    label: 'Something else',
    message: 'Hi {first}, \n\nWarm regards,\n{me}',
  },
]
