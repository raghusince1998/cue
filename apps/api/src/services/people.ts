import { and, eq, gte, inArray, ne, or } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'

/**
 * Everything between you and one person.
 *
 * Plans mention people in three ways: attached to their contact, naming them
 * in the title ("Meeting with Ravi", "Send Ravi the deck"), or as the person a
 * check-in is waiting on. A person is matched by their full name, or by their
 * first name when exactly one saved contact has it — attaching another Ravi's
 * contract to this Ravi would be worse than not attaching it.
 */

const DAY_MS = 86_400_000
/** How far back "last met" and the meeting count look. */
const HISTORY_DAYS = 365

interface Person {
  id: string
  name: string
}

export interface Matcher {
  /** Does this name (a check-in's "waiting on") mean this person? */
  isName: (value: string | null | undefined) => boolean
  /** Does this title mention this person? */
  inTitle: (title: string) => boolean
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** How to recognise each person, given everyone saved — a first name only counts when it is unambiguous. */
export function matchersFor(people: Person[]): Map<string, Matcher> {
  const firstCounts = new Map<string, number>()
  for (const p of people) {
    const first = p.name.trim().split(/\s+/)[0]!.toLowerCase()
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1)
  }
  const out = new Map<string, Matcher>()
  for (const p of people) {
    const full = p.name.trim().replace(/\s+/g, ' ').toLowerCase()
    const first = full.split(' ')[0]!
    const firstUsable = firstCounts.get(first) === 1 && first.length >= 3
    const fullRe = new RegExp(`(^|[^\\p{L}])${escape(full)}($|[^\\p{L}])`, 'iu')
    const firstRe = new RegExp(`(^|[^\\p{L}])${escape(first)}($|[^\\p{L}])`, 'iu')
    out.set(p.id, {
      isName: (value) => {
        const v = (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
        return v.length > 0 && (v === full || (firstUsable && v === first))
      },
      inTitle: (title) => fullRe.test(title) || (firstUsable && firstRe.test(title)),
    })
  }
  return out
}

type Row = typeof schema.commitments.$inferSelect

export interface PersonLinks {
  waitingOnThem: string[]
  youOwe: string[]
  nextMeetings: string[]
  lastMeeting: string | null
  meetingCount: number
  firstMet: Date | null
}

/** Sorts one person's plans into what they owe, what you owe, and your meetings. */
function linksFor(personId: string, m: Matcher, rows: Row[], now: Date): PersonLinks {
  const withThem = (r: Row) => r.contactId === personId || m.inTitle(r.title)
  const meetings = rows.filter(
    (r) => r.kind === 'meeting' && r.status !== 'cancelled' && withThem(r),
  )
  const meetingIds = new Set(meetings.map((r) => r.id))
  const past = meetings.filter((r) => r.dueAt < now).sort((a, b) => +b.dueAt - +a.dueAt)
  const ahead = meetings
    .filter((r) => r.dueAt >= now && r.status === 'pending')
    .sort((a, b) => +a.dueAt - +b.dueAt)

  const pending = rows.filter((r) => r.status === 'pending' && r.kind !== 'meeting' && r.kind !== 'focus')
  const waitingOnThem = pending.filter((r) => r.waitingOn && m.isName(r.waitingOn))
  const youOwe = pending.filter(
    (r) =>
      !r.waitingOn &&
      (r.contactId === personId ||
        (r.fromCommitmentId !== null && meetingIds.has(r.fromCommitmentId)) ||
        m.inTitle(r.title)),
  )

  return {
    waitingOnThem: waitingOnThem.sort((a, b) => +a.dueAt - +b.dueAt).map((r) => r.id),
    youOwe: youOwe.sort((a, b) => +a.dueAt - +b.dueAt).map((r) => r.id),
    nextMeetings: ahead.slice(0, 3).map((r) => r.id),
    lastMeeting: past[0]?.id ?? null,
    meetingCount: past.length,
    firstMet: past.length ? past[past.length - 1]!.dueAt : null,
  }
}

/** The plans worth looking through: anything open, and a year of meetings. */
async function relevantRows(userId: string, now: Date): Promise<Row[]> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS)
  return db
    .select()
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        ne(schema.commitments.status, 'deleted'),
        or(
          eq(schema.commitments.status, 'pending'),
          and(eq(schema.commitments.kind, 'meeting'), gte(schema.commitments.dueAt, since)),
        ),
      ),
    )
    .limit(5000)
}

async function peopleOf(orgId: string): Promise<Person[]> {
  return db
    .select({ id: schema.contacts.id, name: schema.contacts.name })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, orgId))
}

export interface PeopleSummary {
  people: Record<
    string,
    { waiting: number; waitingDue: number; owe: number; next: string | null; lastMet: string | null }
  >
  /** Names checked-in on that match nobody saved — worth adding to People. */
  unsaved: string[]
}

/** For the People list: what is open with each person, and who is mentioned but not saved. */
export async function peopleSummary(orgId: string, userId: string, now = new Date()): Promise<PeopleSummary> {
  const [people, rows] = await Promise.all([peopleOf(orgId), relevantRows(userId, now)])
  const matchers = matchersFor(people)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: PeopleSummary['people'] = {}

  for (const p of people) {
    const l = linksFor(p.id, matchers.get(p.id)!, rows, now)
    if (!l.waitingOnThem.length && !l.youOwe.length && !l.nextMeetings.length && !l.lastMeeting) continue
    out[p.id] = {
      waiting: l.waitingOnThem.length,
      waitingDue: l.waitingOnThem.filter((id) => byId.get(id)!.dueAt <= now).length,
      owe: l.youOwe.length,
      next: l.nextMeetings[0] ? byId.get(l.nextMeetings[0])!.dueAt.toISOString() : null,
      lastMet: l.lastMeeting ? byId.get(l.lastMeeting)!.dueAt.toISOString() : null,
    }
  }

  const all = [...matchers.values()]
  const unsaved = new Map<string, string>()
  for (const r of rows) {
    if (r.status !== 'pending' || !r.waitingOn) continue
    if (all.some((m) => m.isName(r.waitingOn))) continue
    const key = r.waitingOn.trim().toLowerCase()
    if (!unsaved.has(key)) unsaved.set(key, r.waitingOn.trim())
  }
  return { people: out, unsaved: [...unsaved.values()].slice(0, 12) }
}

/** One person: the ids of what is open between you, your meetings, and history. */
export async function personLinks(
  orgId: string,
  userId: string,
  contactId: string,
  now = new Date(),
): Promise<(PersonLinks & { lastMeetingFollowUps: string[] }) | null> {
  const people = await peopleOf(orgId)
  if (!people.some((p) => p.id === contactId)) return null
  const rows = await relevantRows(userId, now)
  const links = linksFor(contactId, matchersFor(people).get(contactId)!, rows, now)

  // What came out of the last meeting, done or not — the thread to pick up.
  const lastMeetingFollowUps = links.lastMeeting
    ? (
        await db
          .select({ id: schema.commitments.id })
          .from(schema.commitments)
          .where(
            and(
              eq(schema.commitments.fromCommitmentId, links.lastMeeting),
              inArray(schema.commitments.status, ['pending', 'done']),
            ),
          )
      ).map((r) => r.id)
    : []
  return { ...links, lastMeetingFollowUps }
}
