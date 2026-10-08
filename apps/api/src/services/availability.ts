import { findFreeSlots } from './freeSlots.ts'

/**
 * "When are you free?" — answered with real times to send.
 *
 * Built on the same free-time finder as everything else that offers a slot,
 * so a time shared here is one the clash check would accept: meetings,
 * plans, and connected calendars all count, check-ins and all-day entries do
 * not. Spread over the days asked for, two a day at most, weekdays only.
 */

export type AvailabilityRange = 'soon' | 'week' | 'next'
export type AvailabilityPart = 'any' | 'morning' | 'afternoon'

const DAY_MS = 86_400_000
/** How soon a shared time can be: long enough for the other person to answer. */
const LEAD_HOURS = 3
/** The last time of day a slot may start — the free-time finder's working hours end at 7 pm. */
const LAST_START_HOUR = 19

/** Where a range starts and how many days it covers. */
export function rangeFor(range: AvailabilityRange, now: Date): { from: Date; days: number } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const toMonday = (8 - today.getDay()) % 7 || 7
  const nextMonday = new Date(today.getTime() + toMonday * DAY_MS)
  if (range === 'next') return { from: nextMonday, days: 7 }
  if (range === 'week') {
    // The rest of this week. With fewer than two working days left — a
    // Friday, a weekend — that is hardly a choice, so it runs into next week.
    const days = Math.round((nextMonday.getTime() - today.getTime()) / DAY_MS)
    const workingLeft = today.getDay() === 0 || today.getDay() === 6 ? 0 : 6 - today.getDay()
    return { from: now, days: workingLeft >= 2 ? days : days + 7 }
  }
  return { from: now, days: 5 }
}

export async function availability(
  userId: string,
  opts: { minutes: number; range: AvailabilityRange; part: AvailabilityPart; count: number },
  now = new Date(),
): Promise<Date[]> {
  const { from, days } = rangeFor(opts.range, now)
  // A time sent to someone needs room for them to read it and reply: nothing
  // in the next three hours, whatever the range.
  const earliest = new Date(now.getTime() + LEAD_HOURS * 3_600_000)
  const start = from > earliest ? from : earliest
  // "soon" means three working days that can still be offered — counted from
  // the first possible time, so an evening request still covers three days.
  let horizon = days
  if (opts.range === 'soon') {
    let working = 0
    // A day already past its last possible start does not count as one of the three.
    const skipToday = start.getHours() >= LAST_START_HOUR ? 1 : 0
    horizon = skipToday
    while (working < 3 && horizon < 10) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + horizon)
      if (d.getDay() !== 0 && d.getDay() !== 6) working += 1
      horizon += 1
    }
  }
  return findFreeSlots(userId, opts.minutes, opts.count, {
    now: start,
    horizonDays: horizon,
    window: opts.part === 'any' ? null : opts.part,
    perDay: 2,
    skipWeekends: true,
  })
}
