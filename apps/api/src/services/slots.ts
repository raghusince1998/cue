import { and, asc, eq, gte, lte } from 'drizzle-orm'
import {
  DEFAULT_WINDOW_HOURS,
  WINDOW_LABELS,
  type SlotSuggestion,
  type TimeWindow,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takesTime } from './overdue.ts'

/**
 * Finds real gaps for something that only knows roughly when it wants to happen.
 *
 * This is the other half of the flexible/fixed split. Saying "call the plumber
 * this afternoon" is only useful if the app can then answer "you are free at
 * 3:20" — otherwise it has just filed the sentence away.
 *
 * Every suggestion carries its own reason. A planner that proposes a time
 * without saying why is asking to be distrusted.
 */

/** Gaps shorter than this are not worth offering; nobody books a 4-minute hole. */
const MIN_USEFUL_GAP_MINUTES = 10
const MAX_SUGGESTIONS = 3

interface Busy {
  startsAt: Date
  endsAt: Date
  title: string
}

function windowBounds(
  day: Date,
  window: TimeWindow,
  custom: Partial<Record<TimeWindow, { from: number; to: number }>> | null,
): { from: Date; to: Date } {
  const hours = custom?.[window] ?? DEFAULT_WINDOW_HOURS[window]
  const from = new Date(day)
  from.setHours(hours.from, 0, 0, 0)
  const to = new Date(day)
  // "night" runs to 24:00, which is midnight at the start of the next day.
  if (hours.to >= 24) {
    to.setHours(0, 0, 0, 0)
    to.setDate(to.getDate() + 1)
  } else {
    to.setHours(hours.to, 0, 0, 0)
  }
  return { from, to }
}

/** Only fixed, timed things occupy space. Flexible items are what we are placing. */
async function busyWithin(userId: string, from: Date, to: Date): Promise<Busy[]> {
  const rows = await db
    .select({
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      durationMinutes: schema.commitments.durationMinutes,
      endsAt: schema.commitments.endsAt,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        eq(schema.commitments.flexibility, 'fixed'),
        takesTime(),
        eq(schema.commitments.allDay, false),
        gte(schema.commitments.dueAt, new Date(from.getTime() - 12 * 3600_000)),
        lte(schema.commitments.dueAt, to),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  return rows.map((r) => ({
    title: r.title,
    startsAt: r.dueAt,
    endsAt: r.endsAt ?? new Date(r.dueAt.getTime() + r.durationMinutes * 60_000),
  }))
}

function describe(start: Date, window: TimeWindow, after: string | null): string {
  const clock = start.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  return after
    ? `Free at ${clock}, right after ${after}`
    : `Free at ${clock}, in your ${WINDOW_LABELS[window].toLowerCase()}`
}

/**
 * Walks the window, skipping anything already booked, and returns the first few
 * gaps long enough to hold `durationMinutes`.
 */
export async function suggestSlots(input: {
  userId: string
  day: Date
  window: TimeWindow
  durationMinutes: number
  now?: Date
  customWindows?: Partial<Record<TimeWindow, { from: number; to: number }>> | null
}): Promise<SlotSuggestion[]> {
  const { userId, day, window, durationMinutes, customWindows = null } = input
  const now = input.now ?? new Date()

  const { from, to } = windowBounds(day, window, customWindows)
  // Never propose a time that has already gone.
  const searchFrom = from > now ? from : now
  if (searchFrom >= to) return []

  const busy = await busyWithin(userId, from, to)
  const needed = durationMinutes * 60_000
  const suggestions: SlotSuggestion[] = []

  let cursor = searchFrom
  let previousTitle: string | null = null

  for (const slot of [...busy, { startsAt: to, endsAt: to, title: '' }]) {
    if (suggestions.length >= MAX_SUGGESTIONS) break
    if (slot.startsAt <= cursor) {
      // Already inside or behind this booking — jump past it.
      if (slot.endsAt > cursor) {
        cursor = slot.endsAt
        previousTitle = slot.title || previousTitle
      }
      continue
    }

    const gap = Math.min(slot.startsAt.getTime(), to.getTime()) - cursor.getTime()
    if (gap >= needed && gap >= MIN_USEFUL_GAP_MINUTES * 60_000) {
      suggestions.push({
        startsAt: cursor.toISOString(),
        endsAt: new Date(cursor.getTime() + needed).toISOString(),
        reason: describe(cursor, window, previousTitle),
      })
    }

    if (slot.endsAt > cursor) {
      cursor = slot.endsAt
      previousTitle = slot.title || previousTitle
    }
    if (cursor >= to) break
  }

  return suggestions
}
