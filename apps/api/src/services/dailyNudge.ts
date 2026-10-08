import { eq, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { sendToUser } from '../push.ts'
import { planTomorrow, type TomorrowPlan } from './planTomorrow.ts'

/**
 * The end-of-day prompt.
 *
 * This closes the hole in the middle of the whole app: everything else assumes
 * you remembered to open it. Nothing can detect that you visited a clinic and
 * never logged it — a browser cannot watch your location in the background — so
 * the next best thing is to ask, once, in your evening.
 */

/**
 * How late after the chosen hour we are still willing to fire. Without this, a
 * worker that was down overnight would wake up and nudge everyone at 3am.
 */
const LATE_CUTOFF_HOURS = 4

interface DueUser {
  id: string
  name: string
  timezone: string
  local_date: string
}

async function usersDueForNudge(): Promise<DueUser[]> {
  const rows = await db.execute(sql`
    select
      u.id,
      u.name,
      u.timezone,
      (now() at time zone u.timezone)::date::text as local_date
    from users u
    where u.daily_nudge_enabled
      and extract(hour from (now() at time zone u.timezone)) >= u.daily_nudge_hour
      and extract(hour from (now() at time zone u.timezone)) < u.daily_nudge_hour + ${LATE_CUTOFF_HOURS}
      and (u.last_nudge_on is null or u.last_nudge_on < (now() at time zone u.timezone)::date)
  `)
  return rows as unknown as DueUser[]
}

interface DayStats {
  logged_today: number
  overdue: number
  open_today: number
}

async function statsFor(userId: string, timezone: string): Promise<DayStats> {
  const rows = await db.execute(sql`
    with bounds as (
      select
        date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone} as day_start
    )
    select
      (select count(*) from interactions i, bounds b
         where i.user_id = ${userId} and i.started_at >= b.day_start)::int as logged_today,
      (select count(*) from commitments c
         where c.user_id = ${userId} and c.status = 'pending' and c.due_at < now()
           -- The same rule as canBeOverdue in overdue.ts: never calendar
           -- history from before it was connected, never an all-day entry.
           and (c.feed_id is null or (not c.all_day and c.due_at >= coalesce(
             (select f.created_at from calendar_feeds f where f.id = c.feed_id),
             '-infinity'::timestamptz)))
           -- Nor a meeting from the last week: it is waiting to be wrapped up.
           -- Nor something waiting on someone else.
           and c.waiting_on is null
           and not (c.kind = 'meeting' and not c.all_day
             and coalesce(c.ends_at, c.due_at + c.duration_minutes * interval '1 minute')
                 > now() - interval '7 days'))::int as overdue,
      (select count(*) from commitments c, bounds b
         where c.user_id = ${userId} and c.status = 'pending'
           and c.due_at >= now()
           and c.due_at < b.day_start + interval '1 day')::int as open_today
  `)
  const row = (rows as unknown as DayStats[])[0]
  return row ?? { logged_today: 0, overdue: 0, open_today: 0 }
}

/**
 * What to say, in order of what actually helps.
 *
 * The old version asked "anyone you visited today?" — a question, pointed
 * backwards, that put the work back on the person at the exact moment they
 * had least appetite for it. An assistant's evening message should be about
 * tomorrow, and should arrive with the thinking already done.
 */
function compose(stats: DayStats, plan: TomorrowPlan): { title: string; body: string; url: string } {
  const tail = stats.overdue > 0 ? ` ${stats.overdue} still overdue.` : ''

  // The most useful thing it can offer: loose items and somewhere to put them.
  if (plan.proposals.length > 0) {
    const first = plan.proposals[0]!
    const time = new Date(first.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    return {
      title: `Tomorrow is ${plan.percentBooked}% booked`,
      body:
        plan.proposals.length === 1
          ? `"${first.title}" has no time on it. It fits at ${time} — want me to put it there?`
          : `${plan.proposals.length} things have no time on them. I found slots for all of them, starting ${time}.`,
      url: '/?plan=tomorrow',
    }
  }

  // Loose items, but genuinely nowhere to put them. Saying so is the help.
  if (plan.unplaceable.length > 0) {
    return {
      title: `Tomorrow is ${plan.percentBooked}% booked`,
      body: `${plan.unplaceable.length} thing${plan.unplaceable.length === 1 ? ' has' : 's have'} no time and no gap big enough.${tail}`,
      url: '/?plan=tomorrow',
    }
  }

  if (plan.fixedCount > 0) {
    return {
      title: `${plan.fixedCount} thing${plan.fixedCount === 1 ? '' : 's'} tomorrow`,
      body: `${plan.percentBooked}% of the day is spoken for.${tail || ' Nothing outstanding.'}`,
      url: '/',
    }
  }

  if (stats.overdue > 0) {
    return {
      title: `${stats.overdue} thing${stats.overdue === 1 ? '' : 's'} still open`,
      body: 'Nothing booked tomorrow, so there is room to clear them.',
      url: '/',
    }
  }

  return {
    title: 'Tomorrow is clear',
    body:
      stats.logged_today > 0
        ? `${stats.logged_today} logged today, nothing outstanding.`
        : 'Nothing booked and nothing overdue.',
    url: '/',
  }
}

/** Builds and delivers one user's nudge. Exported so it can be fired on demand. */
export async function sendNudgeTo(
  userId: string,
  timezone: string,
): Promise<{ delivered: number; title: string; body: string }> {
  const stats = await statsFor(userId, timezone)
  const plan = await planTomorrow(userId)
  const { title, body, url } = compose(stats, plan)
  const delivered = await sendToUser(userId, { title, body, tag: 'daily-nudge', url })
  return { delivered, title, body }
}

/**
 * Runs on a timer. Each user is marked before the push is attempted — a failed
 * notification is a far smaller problem than nudging the same person in a loop
 * because the send threw.
 */
export async function runDailyNudges(): Promise<number> {
  const due = await usersDueForNudge()
  let sent = 0

  for (const user of due) {
    try {
      await db
        .update(schema.users)
        .set({ lastNudgeOn: user.local_date })
        .where(eq(schema.users.id, user.id))

      await sendNudgeTo(user.id, user.timezone)
      sent += 1
    } catch (err) {
      console.error('[nudge] failed for user', user.id, (err as Error).message)
    }
  }

  return sent
}

export function startNudgeWorker(intervalMs = 5 * 60_000) {
  let running = false

  const run = async () => {
    if (running) return
    running = true
    try {
      const sent = await runDailyNudges()
      if (sent > 0) console.log(`[nudge] sent ${sent} evening nudge(s)`)
    } catch (err) {
      console.error('[nudge] tick failed:', (err as Error).message)
    } finally {
      running = false
    }
  }

  void run()
  const handle = setInterval(run, intervalMs)
  console.log(`[nudge] evening nudge worker checking every ${intervalMs / 60_000} min`)
  return () => clearInterval(handle)
}
