import { and, asc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { buildSummary } from './insights.ts'
import { keepInTouch, orgOf } from './keepInTouch.ts'
import { canBeOverdue, isAwaitingWrapUp, managedByCue, meetingEnd } from './overdue.ts'

/**
 * The morning brief.
 *
 * The evening nudge asks what happened; this says what is coming, before the
 * first meeting does. One notification at the person's chosen hour: how many
 * meetings and things to do, the first of them, the longest free stretch for
 * focused work, who is due a check-in, and anything left over from before.
 * Tapping it opens "Your day".
 *
 * A day with nothing in it and nothing outstanding sends nothing — a brief
 * that says "nothing" every morning is one people learn to swipe away.
 */

/** How late after the chosen hour it will still send, as the evening nudge does. */
const LATE_CUTOFF_HOURS = 3

export interface BriefStats {
  meetings: number
  first: { title: string; dueAt: Date } | null
  tasks: number
  checkIns: string[]
  checkInsDue: number
  overdue: number
  wrapUps: number
  longestGap: { from: Date; to: Date } | null
  /** People it has been too long with, longest first. */
  reachOut: string[]
}

/** Today in the person's own zone, as SQL bounds — the server's zone is not theirs. */
function dayBounds(now: Date, timezone: string) {
  const start = sql`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone})`
  const end = sql`(${start} + interval '1 day')`
  return { start, end }
}

export async function briefStats(userId: string, timezone: string, now = new Date()): Promise<BriefStats> {
  const c = schema.commitments
  const { start, end } = dayBounds(now, timezone)
  const today = and(gte(c.dueAt, start), lt(c.dueAt, end))
  const mine = and(eq(c.userId, userId), eq(c.status, 'pending'))
  const count = sql<number>`count(*)::int`

  const meetingRows = await db
    .select({ title: c.title, dueAt: c.dueAt })
    .from(c)
    .where(and(mine, today, eq(c.kind, 'meeting'), eq(c.allDay, false), isNull(c.waitingOn), managedByCue()))
    .orderBy(asc(c.dueAt))

  const [tasks] = await db
    .select({ n: count })
    .from(c)
    .where(and(mine, today, ne(c.kind, 'meeting'), eq(c.allDay, false), isNull(c.waitingOn), managedByCue()))

  const checkInRows = await db
    .select({ who: c.waitingOn })
    .from(c)
    .where(and(mine, isNotNull(c.waitingOn), lt(c.dueAt, end)))
    .orderBy(asc(c.dueAt))

  const [overdue] = await db
    .select({ n: count })
    .from(c)
    .where(and(mine, canBeOverdue(now), lt(c.dueAt, now)))

  const [wrapUps] = await db
    .select({ n: count })
    .from(c)
    .where(
      and(
        mine,
        managedByCue(),
        isAwaitingWrapUp(now),
        sql`${meetingEnd()} <= ${now.toISOString()}::timestamptz`,
      ),
    )

  const summary = await buildSummary(userId, now)
  const names = [...new Set(checkInRows.map((r) => r.who!).filter(Boolean))]
  const orgId = await orgOf(userId)
  const reachOut = orgId
    ? (await keepInTouch(orgId, userId, now)).filter((p) => p.due).map((p) => p.name)
    : []

  return {
    meetings: meetingRows.length,
    first: meetingRows[0] ? { title: meetingRows[0].title, dueAt: meetingRows[0].dueAt } : null,
    tasks: tasks?.n ?? 0,
    checkIns: names,
    checkInsDue: checkInRows.length,
    overdue: overdue?.n ?? 0,
    wrapUps: wrapUps?.n ?? 0,
    longestGap:
      summary.subject === 'today' && summary.nextGap
        ? { from: new Date(summary.nextGap.from), to: new Date(summary.nextGap.to) }
        : null,
    reachOut,
  }
}

function clockIn(d: Date, timezone: string): string {
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: timezone })
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, 2).join(', ')} and ${plural(names.length - 2, 'other')}`
}

/** The notification, or null when there is genuinely nothing to say. */
export function composeBrief(
  stats: BriefStats,
  timezone: string,
): { title: string; body: string; url: string } | null {
  const nothing =
    stats.meetings === 0 &&
    stats.tasks === 0 &&
    stats.checkInsDue === 0 &&
    stats.overdue === 0 &&
    stats.wrapUps === 0 &&
    stats.reachOut.length === 0
  if (nothing) return null

  const head = [
    stats.meetings > 0 ? plural(stats.meetings, 'meeting') : null,
    stats.tasks > 0 ? `${stats.tasks} to do` : null,
  ].filter(Boolean)
  const title = head.length > 0 ? `Today: ${head.join(', ')}` : 'Nothing booked today'

  const lines: string[] = []
  if (stats.first) lines.push(`First up: ${stats.first.title} at ${clockIn(stats.first.dueAt, timezone)}.`)
  if (stats.longestGap && (stats.meetings > 0 || stats.tasks > 0)) {
    lines.push(
      `Longest free stretch ${clockIn(stats.longestGap.from, timezone)}–${clockIn(stats.longestGap.to, timezone)}.`,
    )
  }
  if (stats.checkIns.length > 0) lines.push(`Check in with ${listNames(stats.checkIns)}.`)
  if (stats.wrapUps > 0) {
    lines.push(`${plural(stats.wrapUps, 'meeting')} still ${stats.wrapUps === 1 ? 'needs' : 'need'} follow-ups.`)
  }
  if (stats.overdue > 0) lines.push(`${stats.overdue} overdue.`)
  if (stats.reachOut.length > 0) lines.push(`Time to reach out to ${listNames(stats.reachOut)}.`)

  return { title, body: lines.join(' '), url: '/?day=1' }
}

export async function sendBriefTo(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<{ delivered: number; title: string; body: string } | null> {
  const brief = composeBrief(await briefStats(userId, timezone, now), timezone)
  if (!brief) return null
  const delivered = await sendToUser(userId, { ...brief, tag: 'morning-brief' })
  return { delivered, title: brief.title, body: brief.body }
}

interface DueUser {
  id: string
  timezone: string
  local_date: string
}

/** Whose chosen hour has come, today, and who has not had one yet. */
export async function usersDueForBrief(now = new Date()): Promise<DueUser[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select
      u.id,
      u.timezone,
      (${at}::timestamptz at time zone u.timezone)::date::text as local_date
    from users u
    where u.morning_brief_enabled
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) >= u.morning_brief_hour
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) < u.morning_brief_hour + ${LATE_CUTOFF_HOURS}
      and (u.last_brief_on is null or u.last_brief_on < (${at}::timestamptz at time zone u.timezone)::date)
  `)
  return rows as unknown as DueUser[]
}

/** Marked before sending, as the evening nudge is: never twice in a morning. */
export async function runMorningBriefs(now = new Date()): Promise<number> {
  let sent = 0
  for (const user of await usersDueForBrief(now)) {
    try {
      await db.update(schema.users).set({ lastBriefOn: user.local_date }).where(eq(schema.users.id, user.id))
      if (await sendBriefTo(user.id, user.timezone, now)) sent += 1
    } catch (err) {
      console.error('[brief] failed for user', user.id, (err as Error).message)
    }
  }
  return sent
}

export function startMorningBriefWorker(intervalMs = 5 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runMorningBriefs()
      if (sent > 0) console.log(`[brief] sent ${sent} morning brief(s)`)
    } catch (err) {
      console.error('[brief] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[brief] morning brief worker checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
