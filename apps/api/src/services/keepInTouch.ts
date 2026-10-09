import { and, eq, gte, inArray, isNotNull, max, ne, or } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { matchersFor, peopleOf } from './people.ts'

/**
 * Keep in touch: the people you mean to hear from every so often, and which of
 * them it has been too long with.
 *
 * "Last contact" is worked out rather than typed: a meeting with them that has
 * happened, a visit logged with them, anything to do with them that you
 * finished (a call back, the deck you sent, a check-in they answered), or a
 * "Talked today" for the call that never became a plan. A person is matched
 * the way their page matches them: their contact, their full name in a title,
 * or a first name only one saved person has.
 */

const DAY_MS = 86_400_000
/** Far enough back for "every 3 months" with room to spare. */
const LOOK_BACK_DAYS = 400

export interface TouchStatus {
  id: string
  name: string
  role: string | null
  organization: string | null
  phone: string | null
  cadenceDays: number
  /** The most recent contact Cue knows of, or null when there is none yet. */
  lastTouch: Date | null
  /** When contact is due: last contact (or when tracking began) plus the rhythm. */
  dueAt: Date
  due: boolean
  snoozedUntil: Date | null
}

export async function keepInTouch(orgId: string, userId: string, now = new Date()): Promise<TouchStatus[]> {
  const ct = schema.contacts
  const tracked = await db
    .select({
      id: ct.id,
      name: ct.name,
      role: ct.role,
      organization: ct.organization,
      phone: ct.phone,
      cadenceDays: ct.keepInTouchDays,
      since: ct.keepInTouchSince,
      lastContactedAt: ct.lastContactedAt,
      snoozedUntil: ct.touchSnoozedUntil,
      createdAt: ct.createdAt,
    })
    .from(ct)
    .where(and(eq(ct.orgId, orgId), isNotNull(ct.keepInTouchDays)))
  if (tracked.length === 0) return []

  const ids = tracked.map((t) => t.id)
  const since = new Date(now.getTime() - LOOK_BACK_DAYS * DAY_MS)
  const c = schema.commitments
  const i = schema.interactions

  const [people, rows, visits] = await Promise.all([
    peopleOf(orgId),
    // Meetings that have happened, and anything finished.
    db
      .select({
        title: c.title,
        kind: c.kind,
        dueAt: c.dueAt,
        status: c.status,
        completedAt: c.completedAt,
        contactId: c.contactId,
        waitingOn: c.waitingOn,
      })
      .from(c)
      .where(
        and(
          eq(c.userId, userId),
          ne(c.status, 'deleted'),
          ne(c.status, 'cancelled'),
          ne(c.kind, 'focus'),
          gte(c.dueAt, since),
          or(eq(c.status, 'done'), eq(c.kind, 'meeting')),
        ),
      )
      .limit(5000),
    db
      .select({ contactId: i.contactId, last: max(i.startedAt) })
      .from(i)
      .where(and(eq(i.userId, userId), inArray(i.contactId, ids)))
      .groupBy(i.contactId),
  ])

  const matchers = matchersFor(people)
  const lastVisit = new Map(visits.map((v) => [v.contactId!, v.last ? new Date(v.last) : null]))

  const out = tracked.map((t): TouchStatus => {
    const m = matchers.get(t.id)!
    const touches: Date[] = []
    if (t.lastContactedAt) touches.push(t.lastContactedAt)
    const visit = lastVisit.get(t.id)
    if (visit) touches.push(visit)
    for (const r of rows) {
      const withThem =
        r.contactId === t.id || m.inTitle(r.title) || (r.waitingOn !== null && m.isName(r.waitingOn))
      if (!withThem) continue
      if (r.kind === 'meeting' && r.dueAt <= now) touches.push(r.dueAt)
      else if (r.status === 'done' && r.completedAt && r.completedAt <= now) touches.push(r.completedAt)
    }
    const lastTouch = touches.length ? new Date(Math.max(...touches.map((d) => d.getTime()))) : null
    const base = lastTouch ?? t.since ?? t.createdAt
    const cadenceDays = t.cadenceDays!
    const dueAt = new Date(base.getTime() + cadenceDays * DAY_MS)
    const snoozed = t.snoozedUntil !== null && t.snoozedUntil > now
    return {
      id: t.id,
      name: t.name,
      role: t.role,
      organization: t.organization,
      phone: t.phone,
      cadenceDays,
      lastTouch,
      dueAt,
      due: dueAt <= now && !snoozed,
      snoozedUntil: snoozed ? t.snoozedUntil : null,
    }
  })
  // Longest overdue first.
  return out.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
}

/** The user's org, for callers that only know who they are sending to. */
export async function orgOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ orgId: schema.users.orgId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
  return row?.orgId ?? null
}
