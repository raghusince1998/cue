import { and, asc, eq, gte, lte, ne, or } from 'drizzle-orm'
import type { CommitmentDTO, ConflictReport } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import type { Executor } from '../db/util.ts'

/** Granularity of the "next free slot" search. */
const STEP_MINUTES = 15
/** How far ahead to look before giving up on finding a gap. */
const SEARCH_HORIZON_MINUTES = 60 * 12
const MAX_SUGGESTIONS = 3

export interface Slot {
  startsAt: Date
  durationMinutes: number
  /** Wins over durationMinutes when set — how multi-day items are expressed. */
  endsAt?: Date | null
}

function endOf(slot: Slot): Date {
  if (slot.endsAt) return slot.endsAt
  return new Date(slot.startsAt.getTime() + slot.durationMinutes * 60_000)
}

function overlaps(a: Slot, b: Slot): boolean {
  // Touching edges are fine: a 4:00–4:15 callback does not clash with 4:15.
  return a.startsAt < endOf(b) && endOf(a) > b.startsAt
}

interface CommitmentRow {
  id: string
  title: string
  kind: string
  dueAt: Date
  durationMinutes: number
  status: string
  escalationCount: number
  allDay: boolean
  endsAt: Date | null
  flexibility: string
  preferredWindow: string | null
  deadline: Date | null
  priority: string
  placeId: string | null
  placeName: string | null
  contactId: string | null
  contactName: string | null
  contactPhone: string | null
  recurrenceId: string | null
  feedId: string | null
  createdAt: Date
}

function toDTO(row: CommitmentRow): CommitmentDTO {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as CommitmentDTO['kind'],
    dueAt: row.dueAt.toISOString(),
    durationMinutes: row.durationMinutes,
    allDay: row.allDay,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    flexibility: row.flexibility as CommitmentDTO['flexibility'],
    preferredWindow: row.preferredWindow as CommitmentDTO['preferredWindow'],
    deadline: row.deadline ? row.deadline.toISOString() : null,
    priority: row.priority as CommitmentDTO['priority'],
    status: row.status as CommitmentDTO['status'],
    escalationCount: row.escalationCount,
    placeId: row.placeId,
    placeName: row.placeName,
    contactId: row.contactId,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    recurrenceId: row.recurrenceId,
    feedId: row.feedId,
    // A clash report is about times, not contents; the list is never read here.
    checklistCount: 0,
    checklistDone: 0,
    notes: null,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Everything still open for this user on the same day as `around`. One query
 * feeds both the clash check and the free-slot search, so proposing a new time
 * never costs another round trip.
 */
async function pendingNear(
  userId: string,
  around: Date,
  excludeId: string | undefined,
  exec: Executor,
): Promise<CommitmentRow[]> {
  const from = new Date(around.getTime() - SEARCH_HORIZON_MINUTES * 60_000)
  const to = new Date(around.getTime() + SEARCH_HORIZON_MINUTES * 60_000)

  return exec
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      kind: schema.commitments.kind,
      dueAt: schema.commitments.dueAt,
      durationMinutes: schema.commitments.durationMinutes,
      status: schema.commitments.status,
      escalationCount: schema.commitments.escalationCount,
      allDay: schema.commitments.allDay,
      endsAt: schema.commitments.endsAt,
      flexibility: schema.commitments.flexibility,
      preferredWindow: schema.commitments.preferredWindow,
      deadline: schema.commitments.deadline,
      priority: schema.commitments.priority,
      placeId: schema.commitments.placeId,
      placeName: schema.places.name,
      contactId: schema.commitments.contactId,
      contactName: schema.contacts.name,
      contactPhone: schema.contacts.phone,
      recurrenceId: schema.commitments.recurrenceId,
      feedId: schema.commitments.feedId,
      createdAt: schema.commitments.createdAt,
    })
    .from(schema.commitments)
    .leftJoin(schema.places, eq(schema.places.id, schema.commitments.placeId))
    .leftJoin(schema.contacts, eq(schema.contacts.id, schema.commitments.contactId))
    .where(
      and(
        // Conflicts are per person, not per company: two reps can both be busy
        // at 4pm without that being a clash.
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        // Typed operators, not a raw sql fragment: raw params bypass Drizzle's
        // timestamp mapping and the driver rejects a bare JS Date.
        lte(schema.commitments.dueAt, to),
        // Overlap, not "starts inside the window". Something that began three
        // days ago and runs until Friday still occupies Wednesday, and testing
        // only the start time made a multi-day booking invisible from its
        // second day onwards.
        or(gte(schema.commitments.dueAt, from), gte(schema.commitments.endsAt, from)),
        excludeId ? ne(schema.commitments.id, excludeId) : undefined,
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))
}

/**
 * What would clash with `proposed`, plus the nearest times that would not.
 * Suggestions walk forward in 15-minute steps because "shift it slightly
 * later" is what people actually do when told a slot is taken.
 */
export async function checkConflicts(
  userId: string,
  proposed: Slot,
  excludeId?: string,
  exec: Executor = db,
): Promise<ConflictReport> {
  const nearby = await pendingNear(userId, proposed.startsAt, excludeId, exec)

  // All-day items are context, not slots. A three-day trip should not report a
  // clash with every call you book while you are on it — the same convention
  // every calendar app follows.
  // Flexible items are intentions, not appointments. Letting them clash would
  // make "call the plumber sometime this afternoon" veto a real 3pm meeting,
  // which is precisely backwards.
  const blocking = nearby.filter((row) => !row.allDay && row.flexibility !== 'flexible')
  const busy: Slot[] = blocking.map((row) => ({
    startsAt: row.dueAt,
    durationMinutes: row.durationMinutes,
    endsAt: row.endsAt,
  }))

  const conflicts = blocking.filter((_, i) => overlaps(proposed, busy[i]!))
  if (conflicts.length === 0) return { conflicts: [], suggestions: [] }

  const suggestions: string[] = []
  const steps = SEARCH_HORIZON_MINUTES / STEP_MINUTES

  for (let step = 1; step <= steps && suggestions.length < MAX_SUGGESTIONS; step += 1) {
    const candidate: Slot = {
      startsAt: new Date(proposed.startsAt.getTime() + step * STEP_MINUTES * 60_000),
      durationMinutes: proposed.durationMinutes,
    }
    if (!busy.some((slot) => overlaps(candidate, slot))) {
      suggestions.push(candidate.startsAt.toISOString())
    }
  }

  return { conflicts: conflicts.map(toDTO), suggestions }
}
