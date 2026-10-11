import { and, asc, eq, gte, isNull, lt, lte, ne, or, sql, isNotNull } from 'drizzle-orm'
import { formatRupees } from '@cue/shared'
import { owedPeople } from './owed.ts'
import { occasionLabel, upcomingOccasions } from './occasions.ts'
import { orgOf } from './keepInTouch.ts'
import { db, schema } from '../db/index.ts'
import { estimateTravel, geocode, sameLabel } from './travel.ts'
import { canBeOverdue, takesTime } from './overdue.ts'

/** A local calendar date as YYYY-MM-DD, for a link into the calendar. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * What the app has noticed.
 *
 * Everything the planner knows was, until now, only visible if you already had
 * weeks of data and went looking for it. Conflict detection ran at the moment
 * of saving, travel estimates existed only inside a warning nobody had
 * triggered, and the fact that you drop things on Fridays was in the database
 * and nowhere else. A tool that spots all this and says none of it is
 * indistinguishable from a list.
 *
 * So: one call that reads the same data and reports what stands out. Each
 * insight carries the evidence it was drawn from, because an observation a
 * person cannot check is one they will stop believing.
 */

export type InsightTone = 'urgent' | 'warning' | 'opportunity' | 'positive' | 'neutral'

export interface Insight {
  id: string
  tone: InsightTone
  /** One line, in plain words, stating what was noticed. */
  headline: string
  /** The reasoning, so the observation can be checked rather than trusted. */
  detail: string
  /** Where to go to act on it, if anywhere. */
  action?: { label: string; href: string }
  /** Higher sorts first. */
  weight: number
}

const DAY_MS = 86_400_000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Matches the reminder worker's cap: past this, the chain has given up. */
const MAX_ESCALATIONS = 4

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function hours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = minutes / 60
  return `${h % 1 === 0 ? h : h.toFixed(1)} hours`
}

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

interface Busy {
  id: string
  title: string
  dueAt: Date
  endsAt: Date | null
  durationMinutes: number
  allDay: boolean
  placeLabel: string | null
  placeName: string | null
}

function endOf(b: Busy): Date {
  return b.endsAt ?? new Date(b.dueAt.getTime() + b.durationMinutes * 60_000)
}

/** Everything fixed and pending in a window, in order. */
async function busyBetween(userId: string, from: Date, to: Date): Promise<Busy[]> {
  return db
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      endsAt: schema.commitments.endsAt,
      durationMinutes: schema.commitments.durationMinutes,
      allDay: schema.commitments.allDay,
      placeLabel: schema.commitments.placeLabel,
      placeName: schema.places.name,
    })
    .from(schema.commitments)
    .leftJoin(schema.places, eq(schema.places.id, schema.commitments.placeId))
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        takesTime(),
        lte(schema.commitments.dueAt, to),
        or(gte(schema.commitments.dueAt, from), gte(schema.commitments.endsAt, from)),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))
}

/**
 * How full a day is, and where the real gaps are.
 *
 * Working hours rather than midnight-to-midnight, because "you have 14 hours
 * free" is technically true and useless when eleven of them are the night.
 */
function shapeOfDay(items: Busy[], day: Date, now: Date) {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 8, 0)
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 21, 0)
  const from = now > dayStart && startOfDay(now).getTime() === day.getTime() ? now : dayStart

  const timed = items
    .filter((i) => !i.allDay && endOf(i) > from && i.dueAt < dayEnd)
    .sort((a, b) => +a.dueAt - +b.dueAt)

  let committed = 0
  const gaps: { from: Date; to: Date }[] = []
  let cursor = from

  for (const item of timed) {
    const start = item.dueAt < cursor ? cursor : item.dueAt
    const end = endOf(item) > dayEnd ? dayEnd : endOf(item)
    if (start > cursor) gaps.push({ from: cursor, to: start })
    if (end > cursor) {
      committed += (end.getTime() - Math.max(start.getTime(), cursor.getTime())) / 60_000
      cursor = end
    }
  }
  if (cursor < dayEnd) gaps.push({ from: cursor, to: dayEnd })

  const usable = gaps.filter((g) => g.to.getTime() - g.from.getTime() >= 30 * 60_000)
  const total = Math.max((dayEnd.getTime() - from.getTime()) / 60_000, 1)

  return {
    committedMinutes: Math.round(committed),
    freeMinutes: Math.round(Math.max(total - committed, 0)),
    percentBooked: Math.min(Math.round((committed / total) * 100), 100),
    gaps: usable,
    longestGap: usable.reduce<{ from: Date; to: Date } | null>(
      (best, g) => (!best || g.to.getTime() - g.from.getTime() > best.to.getTime() - best.from.getTime() ? g : best),
      null,
    ),
    count: timed.length,
  }
}

/** Two places, too close together in time to get between. */
async function travelRisks(items: Busy[]): Promise<Insight[]> {
  const out: Insight[] = []
  const placed = items.filter((i) => !i.allDay && (i.placeLabel || i.placeName))

  for (let i = 0; i < placed.length - 1 && out.length < 2; i += 1) {
    const a = placed[i]!
    const b = placed[i + 1]!
    const labelA = a.placeName ?? a.placeLabel
    const labelB = b.placeName ?? b.placeLabel
    if (!labelA || !labelB || sameLabel(labelA, labelB)) continue

    const gapMinutes = (b.dueAt.getTime() - endOf(a).getTime()) / 60_000
    if (gapMinutes < 0 || gapMinutes > 8 * 60) continue

    const [from, to] = await Promise.all([geocode(labelA), geocode(labelB)])
    if (!from || !to) continue

    const travel = estimateTravel(from, to)
    if (travel.distanceKm < 25) continue
    if (travel.minutes <= gapMinutes) continue

    out.push({
      id: `travel-${a.id}-${b.id}`,
      tone: 'urgent',
      headline: `You cannot get from ${labelA} to ${labelB} in time`,
      detail: `${a.title} ends at ${clock(endOf(a))} and ${b.title} starts at ${clock(b.dueAt)} — ${Math.round(gapMinutes)} minutes apart. That journey is about ${travel.distanceKm} km, roughly ${hours(travel.minutes)}.`,
      // The week that day is in, with the day picked out. '/' was the page
      // the button sat on, so it did nothing.
      action: { label: 'Open the day', href: `/?view=week&date=${dayKey(a.dueAt)}` },
      weight: 100,
    })
  }
  return out
}

export async function buildInsights(userId: string, now = new Date()): Promise<Insight[]> {
  const today = startOfDay(now)
  const insights: Insight[] = []

  const weekAhead = await busyBetween(userId, today, new Date(today.getTime() + 7 * DAY_MS))
  const todayItems = weekAhead.filter((i) => startOfDay(i.dueAt).getTime() === today.getTime())
  const tomorrow = new Date(today.getTime() + DAY_MS)
  const tomorrowItems = weekAhead.filter(
    (i) => startOfDay(i.dueAt).getTime() === tomorrow.getTime(),
  )

  // ------------------------------------------------------------ overdue
  const overdue = await db
    .select({
      id: schema.commitments.id,
      title: schema.commitments.title,
      dueAt: schema.commitments.dueAt,
      escalationCount: schema.commitments.escalationCount,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        canBeOverdue(now),
        lt(schema.commitments.dueAt, now),
      ),
    )
    .orderBy(asc(schema.commitments.dueAt))

  if (overdue.length > 0) {
    const oldest = overdue[0]!
    const days = Math.floor((now.getTime() - oldest.dueAt.getTime()) / DAY_MS)
    insights.push({
      id: 'overdue',
      tone: 'urgent',
      headline: `${overdue.length} thing${overdue.length === 1 ? '' : 's'} you said you would do ${overdue.length === 1 ? 'is' : 'are'} still open`,
      detail:
        days >= 1
          ? `The oldest is "${oldest.title}", ${days} day${days === 1 ? '' : 's'} past its time.`
          : `"${oldest.title}" was due at ${clock(oldest.dueAt)}.`,
      // The triage panel is where each one gets decided. '/' was the page
      // the button sat on, so pressing it did nothing at all.
      action: { label: 'Clear them', href: '/?triage=all' },
      weight: 95,
    })
  }

  // ------------------------------- the ones the nagging has already failed on
  //
  // Separate from the overdue count on purpose. "5 overdue" is a number people
  // learn to ignore; "the reminders stopped working on these three five weeks
  // ago" is an admission, and an admission is actionable.
  const stuck = overdue.filter(
    (c) =>
      c.dueAt < new Date(now.getTime() - 5 * DAY_MS) ||
      (c.escalationCount ?? 0) >= MAX_ESCALATIONS,
  )

  if (stuck.length > 0) {
    const oldestStuck = stuck[0]!
    const days = Math.floor((now.getTime() - oldestStuck.dueAt.getTime()) / DAY_MS)
    insights.push({
      id: 'stuck',
      tone: 'warning',
      headline: `${stuck.length} ${stuck.length === 1 ? 'thing has' : 'things have'} stopped moving`,
      detail: `"${oldestStuck.title}" is ${days} days past and the reminders have run out. Chasing them again will not work — decide what happens to them.`,
      action: { label: 'Sort them out', href: '/?triage=1' },
      weight: 90,
    })
  }

  // ------------------------------------------- the pattern behind the drops
  const dropped = await db
    .select({ dueAt: schema.commitments.dueAt })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        canBeOverdue(now),
        lt(schema.commitments.dueAt, now),
        gte(schema.commitments.dueAt, new Date(now.getTime() - 60 * DAY_MS)),
      ),
    )

  if (dropped.length >= 4) {
    const byDay = new Array(7).fill(0)
    for (const d of dropped) byDay[d.dueAt.getDay()] += 1
    const worst = byDay.indexOf(Math.max(...byDay))
    // Only worth saying when it is genuinely lopsided, not noise.
    if (byDay[worst] >= Math.max(3, Math.ceil(dropped.length * 0.4))) {
      insights.push({
        id: 'drop-pattern',
        tone: 'warning',
        headline: `${WEEKDAYS[worst]}s are where things slip`,
        detail: `${byDay[worst]} of the ${dropped.length} things you have let go in the last two months were due on a ${WEEKDAYS[worst]}. Worth putting less there.`,
        weight: 60,
      })
    }
  }

  // ------------------------------------------------------ the day's shape
  const shape = shapeOfDay(todayItems, today, now)
  if (shape.count > 0) {
    insights.push({
      id: 'today-shape',
      tone: shape.percentBooked > 75 ? 'warning' : 'neutral',
      headline: `Today is ${shape.percentBooked}% booked — ${hours(shape.freeMinutes)} still free`,
      detail: shape.longestGap
        ? `${shape.count} fixed thing${shape.count === 1 ? '' : 's'}, and your longest clear run is ${clock(shape.longestGap.from)} to ${clock(shape.longestGap.to)}.`
        : `${shape.count} fixed things, with nothing longer than half an hour between them.`,
      weight: 70,
    })
  } else if (tomorrowItems.length > 0) {
    const t = shapeOfDay(tomorrowItems, tomorrow, tomorrow)
    insights.push({
      id: 'tomorrow-shape',
      tone: 'neutral',
      headline: `Nothing fixed today. Tomorrow is ${t.percentBooked}% booked`,
      detail: `${t.count} thing${t.count === 1 ? '' : 's'} tomorrow, starting at ${clock(tomorrowItems[0]!.dueAt)}.`,
      weight: 40,
    })
  }

  // --------------------------------------------------------- travel risks
  insights.push(...(await travelRisks(weekAhead)))

  // ----------------------------------------- trips, and what is waiting
  const trips = await db
    .select()
    .from(schema.trips)
    .where(
      and(
        eq(schema.trips.userId, userId),
        gte(schema.trips.endsOn, today.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(asc(schema.trips.startsOn))
    .limit(3)

  for (const trip of trips) {
    const waiting = await db
      .select({ title: schema.intentions.title })
      .from(schema.intentions)
      .where(
        and(
          eq(schema.intentions.userId, userId),
          eq(schema.intentions.status, 'saved'),
          sql`lower(${schema.intentions.placeLabel}) = lower(${trip.placeLabel})`,
        ),
      )

    if (waiting.length === 0) continue
    const daysAway = Math.round(
      (new Date(`${trip.startsOn}T00:00:00`).getTime() - today.getTime()) / DAY_MS,
    )
    insights.push({
      id: `trip-${trip.id}`,
      tone: 'opportunity',
      headline: `${waiting.length} thing${waiting.length === 1 ? '' : 's'} waiting for ${trip.placeLabel}`,
      detail: `You are there ${daysAway <= 0 ? 'now' : `in ${daysAway} day${daysAway === 1 ? '' : 's'}`}: ${waiting
        .slice(0, 3)
        .map((w) => w.title)
        .join(', ')}${waiting.length > 3 ? `, and ${waiting.length - 3} more` : ''}.`,
      action: { label: 'See the trip', href: '/trips' },
      weight: 85,
    })
  }

  // ----------------------------------- intentions with nowhere to happen yet
  const [orphaned] = await db
    .select({ n: sql<number>`count(distinct ${schema.intentions.placeLabel})::int` })
    .from(schema.intentions)
    .where(and(eq(schema.intentions.userId, userId), eq(schema.intentions.status, 'saved')))

  if ((orphaned?.n ?? 0) > 0 && trips.length === 0) {
    insights.push({
      id: 'waiting-places',
      tone: 'neutral',
      headline: `Things saved for ${orphaned!.n} place${orphaned!.n === 1 ? '' : 's'} you have not planned a trip to`,
      detail: 'They stay out of your way until you do, then surface on their own.',
      action: { label: 'Plan a trip', href: '/trips' },
      weight: 30,
    })
  }

  // ------------------------------------------- birthdays and anniversaries
  const orgId = await orgOf(userId)
  const occasions = orgId ? (await upcomingOccasions(orgId, 1, now)).slice(0, 3) : []
  for (const o of occasions) {
    insights.push({
      id: `occasion-${o.contactId}-${o.kind}-${o.date}`,
      tone: 'opportunity',
      headline: `${occasionLabel(o)} ${o.daysAway === 0 ? 'today' : 'tomorrow'}`,
      detail: o.organization
        ? `${o.organization}. A message on the day is remembered.`
        : 'A message on the day is remembered.',
      action: { label: 'Send wishes', href: `/people?wish=${o.contactId}&for=${o.kind}` },
      weight: o.daysAway === 0 ? 88 : 60,
    })
  }

  // ------------------------------------------------------------- expenses
  // Last month's spend, still unclaimed once the month has turned: the claim
  // that slips is the one whose receipts are already lost.
  const monthStart = dayKey(new Date(now.getFullYear(), now.getMonth(), 1))
  // What is the company's to pay: the amount less what others pay back.
  const claimable = sql`(${schema.expenses.amountPaise} - coalesce((select sum(m.amount_paise) from money_owed m where m.expense_id = ${schema.expenses.id}), 0))`
  const claimableSums = {
    n: sql<number>`(count(*) filter (where ${claimable} > 0))::int`,
    paise: sql<number>`coalesce(sum(greatest(${claimable}, 0)), 0)::int`,
  }
  const [owed] = await db
    .select(claimableSums)
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.userId, userId),
        eq(schema.expenses.claimStatus, 'unclaimed'),
        lt(schema.expenses.spentOn, monthStart),
      ),
    )
  if ((owed?.n ?? 0) > 0) {
    insights.push({
      id: `expenses-unclaimed-${monthStart}`,
      tone: 'warning',
      headline: `${formatRupees(owed!.paise)} from before this month not claimed yet`,
      detail: `${owed!.n} expense${owed!.n === 1 ? '' : 's'}. Easier to claim while the receipts are still to hand.`,
      action: { label: 'Make a claim', href: '/expenses?claim=1' },
      weight: 52,
    })
  }

  // Claimed a month ago and still not paid back: worth a word with accounts.
  const [unpaid] = await db
    .select(claimableSums)
    .from(schema.expenses)
    .where(
      and(
        eq(schema.expenses.userId, userId),
        eq(schema.expenses.claimStatus, 'claimed'),
        lt(schema.expenses.claimedAt, new Date(now.getTime() - 30 * DAY_MS)),
      ),
    )
  if ((unpaid?.n ?? 0) > 0) {
    insights.push({
      id: 'expenses-unpaid',
      tone: 'neutral',
      headline: `${formatRupees(unpaid!.paise)} claimed over a month ago, not paid back`,
      detail: 'Mark it once it arrives, or chase it.',
      action: { label: 'See claims', href: '/expenses?paid=1' },
      weight: 34,
    })
  }

  // Owed by people for a fortnight, and not reminded this week.
  const fortnightAgo = dayKey(new Date(now.getTime() - 14 * DAY_MS))
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString()
  const overdueDebts = (await owedPeople(userId, now)).people.filter(
    (p) => p.since <= fortnightAgo && (!p.lastAskedAt || p.lastAskedAt < weekAgo),
  )
  if (overdueDebts.length === 1) {
    const p = overdueDebts[0]!
    const weeks = Math.max(2, Math.floor((now.getTime() - new Date(`${p.since}T00:00:00`).getTime()) / (7 * DAY_MS)))
    insights.push({
      id: `owed-${p.key}`,
      tone: 'warning',
      headline: `${p.name} has owed you ${formatRupees(p.totalPaise)} for ${weeks} weeks`,
      detail: p.lastAskedAt ? 'Last reminded over a week ago.' : 'A friendly reminder usually does it.',
      action: { label: 'Remind them', href: '/expenses?owed=1' },
      weight: 46,
    })
  } else if (overdueDebts.length > 1) {
    const total = overdueDebts.reduce((s, p) => s + p.totalPaise, 0)
    insights.push({
      id: 'owed-several',
      tone: 'warning',
      headline: `${formatRupees(total)} owed to you by ${overdueDebts.length} people for over two weeks`,
      detail: overdueDebts.map((p) => p.name).slice(0, 3).join(', ') + (overdueDebts.length > 3 ? ' and others.' : '.'),
      action: { label: 'Remind them', href: '/expenses?owed=1' },
      weight: 46,
    })
  }

  // -------------------------------------------------------- what went well
  const closed = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'done'),
        gte(schema.commitments.completedAt, new Date(now.getTime() - 7 * DAY_MS)),
      ),
    )

  if ((closed[0]?.n ?? 0) > 0) {
    insights.push({
      id: 'closed-week',
      tone: 'positive',
      headline: `${closed[0]!.n} closed out in the last week`,
      detail:
        overdue.length === 0
          ? 'Nothing outstanding behind you. That is the whole idea.'
          : `${overdue.length} still open, but the rest got done.`,
      weight: 20,
    })
  }

  return insights.sort((a, b) => b.weight - a.weight)
}

/** The numbers behind the headline, for the strip across the top. */
export async function buildSummary(userId: string, now = new Date()) {
  const today = startOfDay(now)
  const items = await busyBetween(userId, today, new Date(today.getTime() + DAY_MS))
  let shape = shapeOfDay(items, today, now)
  let subject: 'today' | 'tomorrow' = 'today'

  // Once the day is spent, the useful question is about the next one. A 0%
  // dial at eight in the evening is accurate and worth nothing.
  if (shape.count === 0) {
    const tomorrow = new Date(today.getTime() + DAY_MS)
    const ahead = await busyBetween(userId, tomorrow, new Date(tomorrow.getTime() + DAY_MS))
    const t = shapeOfDay(ahead, tomorrow, tomorrow)
    if (t.count > 0) {
      shape = t
      subject = 'tomorrow'
    }
  }

  const [overdue] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        canBeOverdue(now),
        lt(schema.commitments.dueAt, now),
      ),
    )

  // Things other people owe you, and how many are due a check-in now.
  const [onOthers] = await db
    .select({
      n: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${schema.commitments.dueAt} <= ${now.toISOString()}::timestamptz)::int`,
    })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        isNotNull(schema.commitments.waitingOn),
      ),
    )

  const [week] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.userId, userId),
        eq(schema.commitments.status, 'pending'),
        gte(schema.commitments.dueAt, now),
        lte(schema.commitments.dueAt, new Date(now.getTime() + 7 * DAY_MS)),
      ),
    )

  // "Waiting on a trip": wishes for a place. Ones for any time wait for a
  // plan, not a trip, and are not counted here.
  const [waiting] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.intentions)
    .where(
      and(
        eq(schema.intentions.userId, userId),
        eq(schema.intentions.status, 'saved'),
        isNotNull(schema.intentions.placeLabel),
      ),
    )

  return {
    /** Which day the shape describes — today until it is over, then tomorrow. */
    subject,
    percentBooked: shape.percentBooked,
    freeMinutes: shape.freeMinutes,
    todayCount: shape.count,
    nextGap: shape.longestGap
      ? { from: shape.longestGap.from.toISOString(), to: shape.longestGap.to.toISOString() }
      : null,
    overdue: overdue?.n ?? 0,
    weekAhead: week?.n ?? 0,
    waiting: waiting?.n ?? 0,
    waitingOnOthers: onOthers?.n ?? 0,
    checkInsDue: onOthers?.due ?? 0,
  }
}
