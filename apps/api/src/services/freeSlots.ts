import { and, asc, eq, gte, lte, ne } from 'drizzle-orm'
import { DEFAULT_WINDOW_HOURS, type TimeWindow } from '@cue/shared'
import { db, schema } from '../db/index.ts'

/**
 * When this person is actually free.
 *
 * One answer to a question three screens were each working out for
 * themselves: the triage panel offering a stuck item a new slot, tomorrow's
 * plan placing loose items, and now an overdue card asking where it could go
 * instead. Having three implementations of "free" is how they drift apart and
 * start contradicting each other.
 */

const DAY_MS = 86_400_000
/** Working hours, in half-hour steps. Offering 3am is a free slot and no help. */
const FIRST_HALF_HOUR = 18 // 09:00
const LAST_HALF_HOUR = 38 // 19:00
const DEFAULT_HORIZON_DAYS = 14

export interface Busy {
  from: Date
  to: Date
}

export interface FreeSlotOptions {
  now?: Date
  /** How far ahead to look before giving up. */
  horizonDays?: number
  /** Keep the answer inside the part of day the item asked for. */
  window?: TimeWindow | null
  /** Ignore this commitment when reading the diary — it is the one being moved. */
  excludeId?: string
  /** Times already promised elsewhere in the same decision. */
  claimed?: Busy[]
}

/** Everything that genuinely occupies time between now and the horizon. */
async function diaryOf(userId: string, from: Date, to: Date, excludeId?: string): Promise<Busy[]> {
  const rows = await db
    .select({
      dueAt: schema.commitments.dueAt,
      endsAt: schema.commitments.endsAt,
      durationMinutes: schema.commitments.durationMinutes,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        // All-day items are context and flexible ones claim nothing, so
        // neither occupies a slot. Same rule the clash check uses.
        eq(schema.commitments.allDay, false),
        eq(schema.commitments.flexibility, 'fixed'),
        gte(schema.commitments.dueAt, from),
        lte(schema.commitments.dueAt, to),
        excludeId ? ne(schema.commitments.id, excludeId) : undefined,
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  return rows.map((r) => ({
    from: r.dueAt,
    to: r.endsAt ?? new Date(r.dueAt.getTime() + r.durationMinutes * 60_000),
  }))
}

/**
 * The next `count` times something of this length would actually fit.
 *
 * Returns fewer than asked for rather than reaching past the horizon or
 * offering a slot that does not fit — an empty answer is a real answer, and
 * "nothing free for a fortnight" is worth being told.
 */
export async function findFreeSlots(
  userId: string,
  durationMinutes: number,
  count = 3,
  options: FreeSlotOptions = {},
): Promise<Date[]> {
  const now = options.now ?? new Date()
  const horizon = new Date(now.getTime() + (options.horizonDays ?? DEFAULT_HORIZON_DAYS) * DAY_MS)
  const taken = [
    ...(await diaryOf(userId, now, horizon, options.excludeId)),
    ...(options.claimed ?? []),
  ]

  const bounds = options.window ? DEFAULT_WINDOW_HOURS[options.window] : null
  const found: Date[] = []

  for (let day = 0; day < (options.horizonDays ?? DEFAULT_HORIZON_DAYS); day += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day)

    for (let half = FIRST_HALF_HOUR; half <= LAST_HALF_HOUR; half += 1) {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, half * 30)
      if (start < now) continue
      if (bounds && (start.getHours() < bounds.from || start.getHours() >= bounds.to)) continue

      const end = new Date(start.getTime() + durationMinutes * 60_000)
      if (taken.some((t) => start < t.to && end > t.from)) continue

      found.push(start)
      if (found.length >= count) return found

      // Spread the offers out: three slots half an hour apart on the same
      // afternoon is one choice presented three times.
      taken.push({ from: start, to: new Date(end.getTime() + 60 * 60_000) })
    }
  }

  return found
}

/** The single next free time, or null when there is none inside the horizon. */
export async function nextFreeSlot(
  userId: string,
  durationMinutes: number,
  options: FreeSlotOptions = {},
): Promise<Date | null> {
  const [first] = await findFreeSlots(userId, durationMinutes, 1, options)
  return first ?? null
}
