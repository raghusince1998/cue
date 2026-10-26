import { and, eq, gte, lt, notInArray, sql } from 'drizzle-orm'
import { HAPPENING_KINDS, TARGET_METRICS, type TargetMetric, type TargetProgress } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { mondayOf } from './weeklyReview.ts'

/**
 * Weekly targets: calls, conversations, visits, meetings, things done and
 * new contacts, counted from what is already logged — setting a target is
 * the only thing to type.
 *
 * Pace is measured against the working week, Monday to Friday, with each
 * day's share arriving through its working hours: by Wednesday evening, three
 * fifths of the week's calls should be made. Weekends are a bonus, not a
 * deadline.
 */

const DAY_MS = 86_400_000
const WORK_START_HOUR = 9
const WORK_HOURS = 9
const WORK_DAYS = 5

export type Counts = Record<TargetMetric, number>

/** How much of the working week has gone by at `now`, from 0 to 1. */
export function weekElapsed(now: Date): number {
  const day = (now.getDay() + 6) % 7 // Monday is 0
  if (day >= WORK_DAYS) return 1
  const hours = now.getHours() + now.getMinutes() / 60
  const today = Math.min(Math.max((hours - WORK_START_HOUR) / WORK_HOURS, 0), 1)
  return (day + today) / WORK_DAYS
}

export function paceOf(done: number, target: number | null, now: Date): Pick<TargetProgress, 'expected' | 'status'> {
  if (!target) return { expected: 0, status: 'untracked' }
  const expected = Math.round(target * weekElapsed(now))
  if (done >= target) return { expected, status: 'done' }
  return { expected, status: done >= expected ? 'on' : 'behind' }
}

/** Everything counted between `from` and `to`. */
export async function countsBetween(userId: string, orgId: string, from: Date, to: Date): Promise<Counts> {
  const i = schema.interactions
  const c = schema.commitments
  const n = sql<number>`count(*)::int`

  const [calls] = await db
    .select({
      all: n,
      spoke: sql<number>`count(*) filter (where ${i.connected})::int`,
    })
    .from(i)
    .where(and(eq(i.userId, userId), eq(i.channel, 'call'), gte(i.startedAt, from), lt(i.startedAt, to)))

  const [visits] = await db
    .select({ n })
    .from(i)
    .where(and(eq(i.userId, userId), eq(i.channel, 'visit'), gte(i.startedAt, from), lt(i.startedAt, to)))

  const [meetings] = await db
    .select({ n })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        eq(c.kind, 'meeting'),
        eq(c.allDay, false),
        notInArray(c.status, ['cancelled', 'deleted']),
        gte(c.dueAt, from),
        lt(c.dueAt, to),
      ),
    )

  const [done] = await db
    .select({ n })
    .from(c)
    .where(
      and(
        eq(c.userId, userId),
        eq(c.status, 'done'),
        notInArray(c.kind, ['meeting', 'focus', ...HAPPENING_KINDS]),
        gte(c.completedAt, from),
        lt(c.completedAt, to),
      ),
    )

  const [people] = await db
    .select({ n })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), gte(schema.contacts.createdAt, from), lt(schema.contacts.createdAt, to)))

  return {
    calls: calls?.all ?? 0,
    conversations: calls?.spoke ?? 0,
    visits: visits?.n ?? 0,
    meetings: meetings?.n ?? 0,
    done: done?.n ?? 0,
    people: people?.n ?? 0,
  }
}

export interface WeekTargets {
  week: { from: string; to: string }
  metrics: TargetProgress[]
  /** Any target set at all — the summary card shows nothing until one is. */
  tracking: boolean
}

export async function weekTargets(userId: string, now = new Date()): Promise<WeekTargets> {
  const [user] = await db
    .select({ orgId: schema.users.orgId, targets: schema.users.weeklyTargets })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const targets = user?.targets ?? {}
  const monday = mondayOf(now)
  const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
  // Only what has happened: a meeting at five is not done at four.
  const [thisWeek, lastWeek] = await Promise.all([
    countsBetween(userId, user!.orgId, monday, now),
    countsBetween(userId, user!.orgId, lastMonday, monday),
  ])

  const metrics = TARGET_METRICS.map((m): TargetProgress => {
    const target = targets[m.key] && targets[m.key]! > 0 ? targets[m.key]! : null
    return {
      key: m.key,
      label: m.label,
      hint: m.hint,
      target,
      done: thisWeek[m.key],
      lastWeek: lastWeek[m.key],
      ...paceOf(thisWeek[m.key], target, now),
    }
  })
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { week: { from: ymd(monday), to: ymd(sunday) }, metrics, tracking: metrics.some((m) => m.target) }
}

/** Sets or clears targets; anything 0 or null stops being tracked. */
export async function saveTargets(userId: string, input: Partial<Record<TargetMetric, number | null>>): Promise<void> {
  const [user] = await db
    .select({ targets: schema.users.weeklyTargets })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  const next: Record<string, number> = { ...(user?.targets ?? {}) }
  for (const [key, value] of Object.entries(input)) {
    if (value && value > 0) next[key] = value
    else delete next[key]
  }
  await db.update(schema.users).set({ weeklyTargets: next }).where(eq(schema.users.id, userId))
}

/** "Behind on calls (12 of 40) and visits (2 of 10)", or null when nothing is. */
export function behindLine(metrics: TargetProgress[]): string | null {
  const behind = metrics.filter((m) => m.status === 'behind')
  if (behind.length === 0) return null
  const parts = behind.slice(0, 2).map((m) => `${m.label.toLowerCase()} (${m.done} of ${m.target})`)
  return `Behind on ${parts.join(' and ')}${behind.length > 2 ? ` and ${behind.length - 2} more` : ''}.`
}
