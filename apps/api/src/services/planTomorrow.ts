import { and, asc, eq, gte, lt, lte, or } from 'drizzle-orm'
import { DEFAULT_WINDOW_HOURS, type TimeWindow } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * Turning "sometime tomorrow" into a time, without asking.
 *
 * The app already knew how to find a free slot, and already knew which items
 * had no time on them — but the two never met unless the user went looking.
 * Meanwhile the evening nudge asked "anyone you visited today?", which is a
 * question, not help.
 *
 * This proposes an actual plan: every loose item placed in a real gap, with the
 * reasoning attached. One notification, one tap, tomorrow is scheduled. Nothing
 * is written until the person says yes, because an assistant that rearranges
 * your day unprompted is not one.
 */

const DAY_MS = 86_400_000
/** A gap shorter than this is not worth offering; nobody books a 4-minute hole. */
const MIN_GAP_MINUTES = 20
/** Breathing room either side of an existing commitment. */
const BUFFER_MINUTES = 10

export interface Proposal {
  commitmentId: string
  title: string
  /** Where it would go. */
  at: string
  durationMinutes: number
  /** Why there, in plain words. */
  because: string
}

export interface TomorrowPlan {
  date: string
  /** Items with no time on them, whether or not a slot was found. */
  loose: number
  proposals: Proposal[]
  /** Loose items nothing could be found for, and why. */
  unplaceable: { commitmentId: string; title: string; because: string }[]
  percentBooked: number
  fixedCount: number
}

interface Busy {
  startsAt: Date
  endsAt: Date
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * The day's free stretches, between the first sensible hour and the last.
 *
 * Working hours rather than midnight to midnight: offering someone a 3am slot
 * is technically a gap and obviously useless.
 */
function gapsIn(busy: Busy[], dayStart: Date, dayEnd: Date): Busy[] {
  const sorted = [...busy].sort((a, b) => +a.startsAt - +b.startsAt)
  const gaps: Busy[] = []
  let cursor = dayStart

  for (const b of sorted) {
    const blockStart = new Date(b.startsAt.getTime() - BUFFER_MINUTES * 60_000)
    if (blockStart > cursor) gaps.push({ startsAt: cursor, endsAt: blockStart })
    const blockEnd = new Date(b.endsAt.getTime() + BUFFER_MINUTES * 60_000)
    if (blockEnd > cursor) cursor = blockEnd
  }
  if (cursor < dayEnd) gaps.push({ startsAt: cursor, endsAt: dayEnd })

  return gaps.filter((g) => g.endsAt.getTime() - g.startsAt.getTime() >= MIN_GAP_MINUTES * 60_000)
}

/** Builds a plan for the day after `now`, writing nothing. */
export async function planTomorrow(userId: string, now = new Date()): Promise<TomorrowPlan> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8, 0)
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 21, 0)
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const nextMidnight = new Date(midnight.getTime() + DAY_MS)

  const all = await db
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      endsAt: schema.commitments.endsAt,
      durationMinutes: schema.commitments.durationMinutes,
      allDay: schema.commitments.allDay,
      flexibility: schema.commitments.flexibility,
      preferredWindow: schema.commitments.preferredWindow,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        // Tomorrow's items, plus anything flexible that has already slipped —
        // a loose task from last week is exactly what wants a slot.
        or(
          and(gte(schema.commitments.dueAt, midnight), lt(schema.commitments.dueAt, nextMidnight)),
          and(eq(schema.commitments.flexibility, 'flexible'), lt(schema.commitments.dueAt, now)),
        ),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  const fixed = all.filter((c) => c.flexibility === 'fixed' && !c.allDay)
  const loose = all.filter((c) => c.flexibility === 'flexible')

  const busy: Busy[] = fixed.map((c) => ({
    startsAt: c.dueAt,
    endsAt: c.endsAt ?? new Date(c.dueAt.getTime() + c.durationMinutes * 60_000),
  }))

  const committed = busy.reduce(
    (total, b) =>
      total + Math.max(0, Math.min(+b.endsAt, +dayEnd) - Math.max(+b.startsAt, +dayStart)) / 60_000,
    0,
  )
  const span = (dayEnd.getTime() - dayStart.getTime()) / 60_000

  const gaps = gapsIn(busy, dayStart, dayEnd)
  const proposals: Proposal[] = []
  const unplaceable: TomorrowPlan['unplaceable'] = []

  // Longest item first: fitting the awkward one while there is still room for
  // it beats filling the day with quick wins and stranding it.
  for (const item of [...loose].sort((a, b) => b.durationMinutes - a.durationMinutes)) {
    const window = item.preferredWindow as TimeWindow | null
    const bounds = window ? DEFAULT_WINDOW_HOURS[window] : null

    const fitsIndex = gaps.findIndex((g) => {
      const room = (g.endsAt.getTime() - g.startsAt.getTime()) / 60_000
      if (room < item.durationMinutes) return false
      if (!bounds) return true
      // Honour the window they actually asked for rather than quietly ignoring
      // it; "this afternoon" means something.
      return g.startsAt.getHours() < bounds.to && g.endsAt.getHours() > bounds.from
    })
    const fits = fitsIndex === -1 ? undefined : gaps[fitsIndex]

    if (!fits) {
      unplaceable.push({
        commitmentId: item.id,
        title: item.title,
        because: window
          ? `No ${window} gap long enough for ${item.durationMinutes} minutes.`
          : `No gap long enough for ${item.durationMinutes} minutes.`,
      })
      continue
    }

    const start =
      bounds && fits.startsAt.getHours() < bounds.from
        ? new Date(fits.startsAt.getFullYear(), fits.startsAt.getMonth(), fits.startsAt.getDate(), bounds.from, 0)
        : fits.startsAt

    // The gap may run far past the window it was chosen for; saying "your
    // first free morning stretch, 9:55 am to 9:00 pm" is a sentence that
    // contradicts itself.
    const reportedEnd =
      bounds && fits.endsAt.getHours() > bounds.to
        ? new Date(start.getFullYear(), start.getMonth(), start.getDate(), bounds.to, 0)
        : fits.endsAt

    proposals.push({
      commitmentId: item.id,
      title: item.title,
      at: start.toISOString(),
      durationMinutes: item.durationMinutes,
      because: window
        ? `Your first free ${window} stretch, ${hhmm(start)} to ${hhmm(reportedEnd)}.`
        : `You are clear from ${hhmm(start)} to ${hhmm(reportedEnd)}.`,
    })

    // Split the gap around what was just placed, rather than moving its start
    // forward. An afternoon item placed at noon inside an 8am-to-9pm gap would
    // otherwise destroy the entire morning, and the next item would be told
    // there was no room in a day that was almost entirely empty.
    const usedFrom = start
    const usedTo = new Date(start.getTime() + item.durationMinutes * 60_000 + BUFFER_MINUTES * 60_000)
    const remaining: Busy[] = []
    if (usedFrom.getTime() - fits.startsAt.getTime() >= MIN_GAP_MINUTES * 60_000) {
      remaining.push({ startsAt: fits.startsAt, endsAt: usedFrom })
    }
    if (fits.endsAt.getTime() - usedTo.getTime() >= MIN_GAP_MINUTES * 60_000) {
      remaining.push({ startsAt: usedTo, endsAt: fits.endsAt })
    }
    gaps.splice(fitsIndex, 1, ...remaining)
  }

  // The local date, not the UTC one. toISOString on midnight in Kolkata gives
  // the previous day, which would label tomorrow's plan with today's date.
  const pad = (n: number) => String(n).padStart(2, '0')

  return {
    date: `${midnight.getFullYear()}-${pad(midnight.getMonth() + 1)}-${pad(midnight.getDate())}`,
    loose: loose.length,
    proposals,
    unplaceable,
    percentBooked: Math.min(Math.round((committed / span) * 100), 100),
    fixedCount: fixed.length,
  }
}

/**
 * Writes an agreed plan.
 *
 * Only the proposals handed back are applied, and each is re-checked against
 * the row it names — a plan built ten minutes ago must not overwrite something
 * the person has since changed by hand.
 */
export async function applyPlan(
  userId: string,
  proposals: { commitmentId: string; at: string }[],
): Promise<number> {
  let applied = 0

  for (const p of proposals) {
    const [row] = await db
      .select({ id: schema.commitments.id, flexibility: schema.commitments.flexibility })
      .from(schema.commitments)
      .where(
        and(
          eq(schema.commitments.id, p.commitmentId),
          eq(schema.commitments.userId, userId),
          eq(schema.commitments.status, 'pending'),
        ),
      )
      .limit(1)

    // Already given a real time by hand, so leave it alone.
    if (!row || row.flexibility !== 'flexible') continue

    await db
      .update(schema.commitments)
      .set({ dueAt: new Date(p.at), flexibility: 'fixed', preferredWindow: null })
      .where(eq(schema.commitments.id, p.commitmentId))
    applied += 1
  }

  return applied
}
