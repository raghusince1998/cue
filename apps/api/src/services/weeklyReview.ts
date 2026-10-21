import { stripWaitingOn } from '@cue/shared'
import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { canBeOverdue, managedByCue, takesTime } from './overdue.ts'
import { listAccounts } from './accounts.ts'
import { orgOf } from './keepInTouch.ts'
import { weekTargets } from './targets.ts'
import type { Lang, TargetProgress } from '@cue/shared'
import { langOf, localeOf, t } from '../i18n.ts'
import { tracked } from './health.ts'

/**
 * The weekly review.
 *
 * Most planners only ever look at today. Once a week, this looks back at
 * what got done and what slipped, at what other people still owe, and ahead
 * at how next week is already filling up — the two minutes on a Friday that
 * stop Monday arriving as a surprise.
 *
 * Weeks run Monday to Sunday in the server's zone, the same day boundaries
 * the summary card uses.
 */

const DAY_MS = 86_400_000
/** The working day next week's free time is measured within, as everywhere else. */
const DAY_START_HOUR = 8
const DAY_END_HOUR = 21

/** Midnight on the Monday of the week `d` falls in. */
export function mondayOf(d: Date): Date {
  const back = (d.getDay() + 6) % 7
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface WeekReview {
  week: { from: string; to: string }
  done: { total: number; meetings: number; tasks: number; titles: string[] }
  meetings: { count: number; minutes: number }
  /** Focus time this week: blocks that have run, and their minutes. */
  focus: { blocks: number; minutes: number }
  followUps: number
  slipped: number
  waiting: {
    count: number
    names: string[]
    oldest: { title: string; who: string; dueAt: string } | null
  }
  nextWeek: {
    days: { date: string; meetings: number; minutes: number; items: number }[]
    busiest: string | null
    meetingMinutes: number
    items: number
    freeMinutes: number
  }
  /** Talks or proposals with no contact for two weeks: deals going cold. */
  quiet: { name: string; stage: string; lastContact: string | null }[]
  /** Only the targets that are set, this week against each. */
  targets: TargetProgress[]
  reviewedAt: string | null
}

export async function weekReview(userId: string, now = new Date()): Promise<WeekReview> {
  const c = schema.commitments
  const weekStart = mondayOf(now)
  const nextStart = new Date(weekStart.getTime() + 7 * DAY_MS)
  const nextEnd = new Date(nextStart.getTime() + 7 * DAY_MS)
  const mine = eq(c.userId, userId)

  const done = await db
    .select({ title: c.title, kind: c.kind })
    .from(c)
    .where(and(mine, eq(c.status, 'done'), gte(c.completedAt, weekStart), lte(c.completedAt, now)))
    .orderBy(desc(c.completedAt))

  // Meetings that have happened this week: still open ones count too — they
  // took the time whether or not they were ticked off.
  const meetings = await db
    .select({ minutes: c.durationMinutes })
    .from(c)
    .where(
      and(
        mine,
        inArray(c.status, ['pending', 'done']),
        eq(c.kind, 'meeting'),
        eq(c.allDay, false),
        takesTime(),
        managedByCue(),
        gte(c.dueAt, weekStart),
        lt(c.dueAt, now),
      ),
    )

  const focusRows = await db
    .select({ minutes: c.durationMinutes })
    .from(c)
    .where(
      and(
        mine,
        inArray(c.status, ['pending', 'done']),
        eq(c.kind, 'focus'),
        gte(c.dueAt, weekStart),
        lt(c.dueAt, now),
      ),
    )

  const [followUps] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(and(mine, isNotNull(c.fromCommitmentId), gte(c.createdAt, weekStart)))

  const [slipped] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(c)
    .where(and(mine, eq(c.status, 'pending'), canBeOverdue(now), lt(c.dueAt, now)))

  const waiting = await db
    .select({ title: c.title, who: c.waitingOn, dueAt: c.dueAt })
    .from(c)
    .where(and(mine, eq(c.status, 'pending'), isNotNull(c.waitingOn)))
    .orderBy(asc(c.dueAt))

  const ahead = await db
    .select({ kind: c.kind, dueAt: c.dueAt, minutes: c.durationMinutes, flexibility: c.flexibility })
    .from(c)
    .where(
      and(
        mine,
        eq(c.status, 'pending'),
        eq(c.allDay, false),
        takesTime(),
        managedByCue(),
        gte(c.dueAt, nextStart),
        lt(c.dueAt, nextEnd),
      ),
    )

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(nextStart.getTime() + i * DAY_MS)
    const onDay = ahead.filter(
      (a) => a.dueAt >= date && a.dueAt < new Date(date.getTime() + DAY_MS),
    )
    const meetingsOn = onDay.filter((a) => a.kind === 'meeting')
    return {
      date: ymd(date),
      meetings: meetingsOn.length,
      minutes: onDay
        .filter((a) => a.flexibility !== 'flexible')
        .reduce((sum, a) => sum + a.minutes, 0),
      items: onDay.length,
    }
  })
  const busiest = days.reduce<(typeof days)[number] | null>(
    (best, d) => (d.minutes > 0 && (!best || d.minutes > best.minutes) ? d : best),
    null,
  )
  const working = days.slice(0, 5)
  const workingMinutes = working.length * (DAY_END_HOUR - DAY_START_HOUR) * 60
  const bookedWorking = working.reduce((sum, d) => sum + d.minutes, 0)

  const [user] = await db
    .select({ reviewedAt: schema.users.lastReviewedAt })
    .from(schema.users)
    .where(eq(schema.users.id, userId))

  const names = [...new Set(waiting.map((w) => w.who!).filter(Boolean))]
  const oldest = waiting[0]

  const targets = (await weekTargets(userId, now)).metrics.filter((m) => m.target)
  const orgId = await orgOf(userId)
  const quiet = orgId
    ? (await listAccounts(orgId, userId, now))
        .filter((a) => a.quiet)
        .map((a) => ({ name: a.name, stage: a.stage!, lastContact: a.lastContact?.toISOString() ?? null }))
    : []

  return {
    week: { from: ymd(weekStart), to: ymd(new Date(nextStart.getTime() - DAY_MS)) },
    done: {
      total: done.length,
      meetings: done.filter((d) => d.kind === 'meeting').length,
      tasks: done.filter((d) => d.kind !== 'meeting').length,
      titles: done.slice(0, 12).map((d) => d.title),
    },
    meetings: { count: meetings.length, minutes: meetings.reduce((s, m) => s + m.minutes, 0) },
    focus: { blocks: focusRows.length, minutes: focusRows.reduce((s, f) => s + f.minutes, 0) },
    followUps: followUps?.n ?? 0,
    slipped: slipped?.n ?? 0,
    waiting: {
      count: waiting.length,
      names,
      oldest: oldest
        ? {
            title: stripWaitingOn(oldest.title),
            who: oldest.who ?? '',
            dueAt: oldest.dueAt.toISOString(),
          }
        : null,
    },
    nextWeek: {
      days,
      busiest: busiest?.date ?? null,
      meetingMinutes: ahead
        .filter((a) => a.kind === 'meeting')
        .reduce((s, a) => s + a.minutes, 0),
      items: ahead.length,
      freeMinutes: Math.max(workingMinutes - bookedWorking, 0),
    },
    quiet,
    targets,
    reviewedAt: user?.reviewedAt ? user.reviewedAt.toISOString() : null,
  }
}

function hours(minutes: number, lang: Lang): string {
  const h = minutes / 60
  return t(lang, '{n}h', { n: h % 1 === 0 ? h : h.toFixed(1) })
}

function weekday(ymdValue: string, lang: Lang): string {
  const [y, m, d] = ymdValue.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString(localeOf(lang), { weekday: 'long' })
}

/** The Friday notification, or null when the week had nothing in it either way. */
export function composeReview(r: WeekReview, lang: Lang = 'en'): { title: string; body: string; url: string } | null {
  const empty =
    r.done.total === 0 &&
    r.meetings.count === 0 &&
    r.slipped === 0 &&
    r.waiting.count === 0 &&
    r.nextWeek.items === 0 &&
    r.quiet.length === 0
  if (empty) return null

  const head = [
    r.done.total === 1 ? t(lang, '1 done') : t(lang, '{n} done', { n: r.done.total }),
    r.slipped === 1 ? t(lang, '1 slipped') : r.slipped > 1 ? t(lang, '{n} slipped', { n: r.slipped }) : null,
  ].filter(Boolean)
  const lines: string[] = []
  if (r.meetings.count > 0) {
    const time = hours(r.meetings.minutes, lang)
    lines.push(
      r.meetings.count === 1
        ? t(lang, '1 meeting ({time}).', { time })
        : t(lang, '{n} meetings ({time}).', { n: r.meetings.count, time }),
    )
  }
  if (r.focus.minutes > 0) lines.push(t(lang, '{time} of focus time.', { time: hours(r.focus.minutes, lang) }))
  if (r.targets.length > 0) {
    const hit = r.targets.filter((x) => x.status === 'done').length
    lines.push(
      r.targets.length === 1
        ? t(lang, 'Hit {hit} of 1 target.', { hit })
        : t(lang, 'Hit {hit} of {n} targets.', { hit, n: r.targets.length }),
    )
  }
  if (r.waiting.count > 0) lines.push(t(lang, '{n} still waiting on others.', { n: r.waiting.count }))
  if (r.quiet.length > 0) {
    const [first, ...rest] = r.quiet.map((q) => q.name)
    lines.push(
      rest.length
        ? t(lang, 'Gone quiet: {name} and {n} more.', { name: first!, n: rest.length })
        : t(lang, 'Gone quiet: {name}.', { name: first! }),
    )
  }
  if (r.nextWeek.busiest) lines.push(t(lang, "Next week's busiest day: {day}.", { day: weekday(r.nextWeek.busiest, lang) }))
  lines.push(t(lang, 'Two minutes to review it.'))

  return { title: t(lang, 'Your week: {list}', { list: head.join(', ') }), body: lines.join(' '), url: '/?review=1' }
}

export async function markReviewed(userId: string, now = new Date()): Promise<void> {
  await db.update(schema.users).set({ lastReviewedAt: now }).where(eq(schema.users.id, userId))
}

interface DueUser {
  id: string
  local_date: string
}

/** Whose Friday hour has come, who has not had this week's prompt yet. */
export async function usersDueForReview(now = new Date()): Promise<DueUser[]> {
  const at = now.toISOString()
  const rows = await db.execute(sql`
    select u.id, (${at}::timestamptz at time zone u.timezone)::date::text as local_date
    from users u
    where u.weekly_review_enabled
      and extract(isodow from (${at}::timestamptz at time zone u.timezone)) = 5
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) >= u.weekly_review_hour
      and extract(hour from (${at}::timestamptz at time zone u.timezone)) < u.weekly_review_hour + 3
      and (u.last_review_prompt_on is null
        or u.last_review_prompt_on < (${at}::timestamptz at time zone u.timezone)::date)
  `)
  return rows as unknown as DueUser[]
}

export async function sendReviewTo(userId: string, now = new Date()) {
  const lang = await langOf(userId)
  const brief = composeReview(await weekReview(userId, now), lang)
  if (!brief) return null
  const delivered = await sendToUser(userId, { ...brief, tag: 'weekly-review', lang })
  return { delivered, title: brief.title, body: brief.body }
}

export async function runWeeklyReviews(now = new Date()): Promise<number> {
  let sent = 0
  for (const user of await usersDueForReview(now)) {
    try {
      await db
        .update(schema.users)
        .set({ lastReviewPromptOn: user.local_date })
        .where(eq(schema.users.id, user.id))
      if (await sendReviewTo(user.id, now)) sent += 1
    } catch (err) {
      console.error('[review] failed for user', user.id, (err as Error).message)
    }
  }
  return sent
}

export function startWeeklyReviewWorker(intervalMs = 10 * 60_000) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await tracked('weekly-review', intervalMs, runWeeklyReviews)
      if (sent > 0) console.log(`[review] sent ${sent} weekly review prompt(s)`)
    } catch (err) {
      console.error('[review] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }
  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[review] weekly review checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
