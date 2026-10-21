import { and, asc, eq, gte, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { buildSummary } from './insights.ts'
import { keepInTouch, orgOf } from './keepInTouch.ts'
import { behindLine, weekTargets } from './targets.ts'
import { occasionLabel, upcomingOccasions } from './occasions.ts'
import { canBeOverdue, isAwaitingWrapUp, managedByCue, meetingEnd } from './overdue.ts'
import { formatRupees, hasWork, type Lang, type TargetMetric, type TargetProgress } from '@cue/shared'
import { planSphere } from './workLife.ts'
import { langOf, localeOf, msg, t } from '../i18n.ts'
import { tracked } from './health.ts'

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
  /** "Behind on calls (12 of 40)", when a weekly target is behind pace. */
  behind: string | null
  /** Today's occasions: "Dr. Mehta's birthday". */
  occasions: string[]
  /** Work and personal told apart, for someone with a working life who keeps them so. */
  split: boolean
  work: { count: number; first: { title: string; dueAt: Date } | null }
  personal: { count: number; first: { title: string; dueAt: Date } | null }
  /** Today's journey, if any: when it leaves, and when to set off for it. */
  travel: { title: string; dueAt: Date; leaveAt: Date } | null
  /** Parcels expected today. */
  parcels: { count: number; first: string | null; codPaise: number }
  /** Bills due today or tomorrow: "Electricity (today)". */
  bills: string[]
}

/** YYYY-MM-DD for that moment in that zone. */
function localDay(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Today in the person's own zone, as SQL bounds — the server's zone is not theirs. */
function dayBounds(now: Date, timezone: string) {
  const start = sql`(date_trunc('day', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone})`
  const end = sql`(${start} + interval '1 day')`
  return { start, end }
}

/** Each weekly target, as the brief names it when behind. */
const METRIC_WORDS: Record<TargetMetric, string> = {
  calls: msg('calls'),
  conversations: msg('conversations'),
  visits: msg('visits'),
  meetings: msg('meetings'),
  done: msg('things done'),
  people: msg('new contacts'),
}

/** "Behind on calls (12 of 40)": targets.ts says it in English; this, in the person's language. */
function behindSaid(metrics: TargetProgress[], lang: Lang): string | null {
  if (lang === 'en') return behindLine(metrics)
  const behind = metrics.filter((m) => m.status === 'behind')
  if (behind.length === 0) return null
  const parts = behind
    .slice(0, 2)
    .map((m) => t(lang, '{what} ({done} of {target})', { what: t(lang, METRIC_WORDS[m.key]), done: m.done, target: m.target ?? 0 }))
  const list = parts.length === 2 ? t(lang, '{a} and {b}', { a: parts[0]!, b: parts[1]! }) : parts[0]!
  return behind.length > 2
    ? t(lang, 'Behind on {list} and {n} more.', { list, n: behind.length - 2 })
    : t(lang, 'Behind on {list}.', { list })
}

export async function briefStats(userId: string, timezone: string, now = new Date(), lang: Lang = 'en'): Promise<BriefStats> {
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

  // The day as one list, to tell work from personal and find the journey.
  const dayRows = await db
    .select({ title: c.title, kind: c.kind, dueAt: c.dueAt, booking: c.booking, sphere: c.sphere })
    .from(c)
    .where(and(mine, today, eq(c.allDay, false), isNull(c.waitingOn), managedByCue()))
    .orderBy(asc(c.dueAt))
  const [person] = await db
    .select({ uses: schema.users.uses, keepApart: schema.users.keepApart })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const half = (which: 'work' | 'personal') => {
    const rows = dayRows.filter((r) => planSphere(r) === which)
    const first = rows.find((r) => r.dueAt > now) ?? rows[0]
    return { count: rows.length, first: first ? { title: first.title, dueAt: first.dueAt } : null }
  }
  const journey = dayRows.find((r) => r.booking && ['flight', 'train', 'bus'].includes(r.booking.type) && r.dueAt > now)

  const todayOn = localDay(now, timezone)
  const tomorrowOn = localDay(new Date(now.getTime() + 86_400_000), timezone)
  const d = schema.deliveries
  const parcelRows = await db
    .select({ store: d.store, item: d.item, codPaise: d.codPaise })
    .from(d)
    .where(and(eq(d.userId, userId), eq(d.expectedOn, todayOn), sql`${d.status} not in ('delivered', 'cancelled')`))
  const b = schema.bills
  const billRows = await db
    .select({ name: b.name, dueOn: b.dueOn, autopay: b.autopay })
    .from(b)
    .where(and(eq(b.userId, userId), eq(b.active, true), gte(b.dueOn, todayOn), sql`${b.dueOn} <= ${tomorrowOn}`))
    .orderBy(asc(b.dueOn))

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
    behind: behindSaid((await weekTargets(userId, now)).metrics, lang),
    occasions: orgId ? (await upcomingOccasions(orgId, 0, now)).map((o) => occasionLabel(o, lang)) : [],
    split: Boolean(person?.keepApart && hasWork(person.uses)),
    work: half('work'),
    personal: half('personal'),
    travel: journey
      ? {
          title: journey.title,
          dueAt: journey.dueAt,
          leaveAt: new Date(journey.dueAt.getTime() - (journey.booking!.remindBeforeMinutes ?? 120) * 60_000),
        }
      : null,
    parcels: {
      count: parcelRows.length,
      first: parcelRows[0] ? [parcelRows[0].store, parcelRows[0].item].filter(Boolean).join(' · ') || null : null,
      codPaise: parcelRows.reduce((sum, p) => sum + (p.codPaise ?? 0), 0),
    },
    bills: billRows
      .filter((r) => !r.autopay)
      .map((r) => (r.dueOn === todayOn ? t(lang, '{name} (today)', { name: r.name }) : t(lang, '{name} (tomorrow)', { name: r.name }))),
  }
}

function clockIn(d: Date, timezone: string, lang: Lang): string {
  return d.toLocaleTimeString(localeOf(lang), { hour: 'numeric', minute: '2-digit', timeZone: timezone })
}

function listNames(names: string[], lang: Lang): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return t(lang, '{a} and {b}', { a: names[0]!, b: names[1]! })
  const first = names.slice(0, 2).join(', ')
  return names.length === 3
    ? t(lang, '{names} and 1 other', { names: first })
    : t(lang, '{names} and {n} others', { names: first, n: names.length - 2 })
}

/** The notification, or null when there is genuinely nothing to say. */
export function composeBrief(
  stats: BriefStats,
  timezone: string,
  lang: Lang = 'en',
): { title: string; body: string; url: string } | null {
  const nothing =
    stats.meetings === 0 &&
    stats.tasks === 0 &&
    stats.checkInsDue === 0 &&
    stats.overdue === 0 &&
    stats.wrapUps === 0 &&
    stats.reachOut.length === 0 &&
    !stats.behind &&
    stats.occasions.length === 0 &&
    !stats.travel &&
    stats.parcels.count === 0 &&
    stats.bills.length === 0
  if (nothing) return null

  const clock = (d: Date) => clockIn(d, timezone, lang)
  const head = [
    stats.meetings === 1 ? t(lang, '1 meeting') : stats.meetings > 1 ? t(lang, '{n} meetings', { n: stats.meetings }) : null,
    stats.tasks > 0 ? t(lang, '{n} to do', { n: stats.tasks }) : null,
  ].filter(Boolean)
  const title = head.length > 0 ? t(lang, 'Today: {list}', { list: head.join(', ') }) : t(lang, 'Nothing booked today')

  const lines: string[] = []
  if (stats.occasions.length > 0) lines.push(t(lang, 'Today: {list}.', { list: listNames(stats.occasions, lang) }))
  if (stats.travel) {
    lines.push(
      t(lang, '{title} at {time} — leave by {leave}.', {
        title: stats.travel.title,
        time: clock(stats.travel.dueAt),
        leave: clock(stats.travel.leaveAt),
      }),
    )
  }
  if (stats.split && (stats.work.count > 0 || stats.personal.count > 0)) {
    // Work and personal, each with its first thing: the day in two halves.
    const { work, personal } = stats
    if (work.count > 0) {
      lines.push(
        work.first
          ? t(lang, 'Work: {n}, first {title} at {time}.', { n: work.count, title: work.first.title, time: clock(work.first.dueAt) })
          : t(lang, 'Work: {n}.', { n: work.count }),
      )
    }
    if (personal.count > 0) {
      lines.push(
        personal.first
          ? t(lang, 'Personal: {n}, first {title} at {time}.', {
              n: personal.count,
              title: personal.first.title,
              time: clock(personal.first.dueAt),
            })
          : t(lang, 'Personal: {n}.', { n: personal.count }),
      )
    }
  } else if (stats.first) {
    lines.push(t(lang, 'First up: {title} at {time}.', { title: stats.first.title, time: clock(stats.first.dueAt) }))
  }
  if (stats.parcels.count > 0) {
    const cod = stats.parcels.codPaise > 0 ? formatRupees(stats.parcels.codPaise) : null
    const n = stats.parcels.count
    const what = stats.parcels.first ?? t(lang, 'a parcel')
    lines.push(
      n === 1
        ? cod
          ? t(lang, 'Arriving today: {what} ({cod} cash on delivery).', { what, cod })
          : t(lang, 'Arriving today: {what}.', { what })
        : cod
          ? t(lang, '{n} parcels arriving today ({cod} cash on delivery).', { n, cod })
          : t(lang, '{n} parcels arriving today.', { n }),
    )
  }
  if (stats.bills.length > 0) lines.push(t(lang, 'To pay: {list}.', { list: listNames(stats.bills, lang) }))
  if (stats.longestGap && (stats.meetings > 0 || stats.tasks > 0)) {
    lines.push(t(lang, 'Longest free stretch {from}–{to}.', { from: clock(stats.longestGap.from), to: clock(stats.longestGap.to) }))
  }
  if (stats.checkIns.length > 0) lines.push(t(lang, 'Check in with {names}.', { names: listNames(stats.checkIns, lang) }))
  if (stats.wrapUps > 0) {
    lines.push(
      stats.wrapUps === 1
        ? t(lang, '1 meeting still needs follow-ups.')
        : t(lang, '{n} meetings still need follow-ups.', { n: stats.wrapUps }),
    )
  }
  if (stats.overdue > 0) lines.push(t(lang, '{n} overdue.', { n: stats.overdue }))
  if (stats.reachOut.length > 0) lines.push(t(lang, 'Time to reach out to {names}.', { names: listNames(stats.reachOut, lang) }))
  if (stats.behind) lines.push(stats.behind)

  return { title, body: lines.join(' '), url: '/?day=1' }
}

export async function sendBriefTo(
  userId: string,
  timezone: string,
  now = new Date(),
): Promise<{ delivered: number; title: string; body: string } | null> {
  const lang = await langOf(userId)
  const brief = composeBrief(await briefStats(userId, timezone, now, lang), timezone, lang)
  if (!brief) return null
  const delivered = await sendToUser(userId, { ...brief, tag: 'morning-brief', lang })
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
      const sent = await tracked('morning-brief', intervalMs, runMorningBriefs)
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
