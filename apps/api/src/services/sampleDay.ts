import { and, eq, like, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.ts'
import { materialise } from './recurrence.ts'
import { scheduleFirstReminder } from './reminders.ts'

/**
 * A realistic week, on demand.
 *
 * An empty planner cannot demonstrate a planner. Every judgement this app makes
 * — that two meetings are too far apart to attend both, that Fridays are where
 * things slip, that three wishes are waiting on a trip — needs a week of data
 * before it has anything to say, so anyone opening it for the first time sees
 * a to-do list with nothing in it and concludes that is what it is.
 *
 * This writes a week that exercises each of those, marked so it can be removed
 * in one call. It is sample data and says so; it is not pretending to be real.
 */

const MARK = '[sample]'
const DAY_MS = 86_400_000

/**
 * The marker goes after any real note, on its own line, so the web app can
 * strip it and show the note. The marker is bookkeeping for removal, not
 * something anyone should have to read under every plan.
 */
function notesWith(note?: string): string {
  return note ? `${note}\n${MARK}` : MARK
}

function at(base: Date, dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, hour, minute)
  return d
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface SampleReport {
  commitments: number
  intentions: number
  trips: number
  series: number
}

export async function loadSampleDay(
  orgId: string,
  userId: string,
  now = new Date(),
): Promise<SampleReport> {
  await clearSampleDay(orgId, userId)

  const report: SampleReport = { commitments: 0, intentions: 0, trips: 0, series: 0 }

  /** Everything sample-made carries the marker in its notes, never its title. */
  async function plan(
    title: string,
    dueAt: Date,
    opts: {
      minutes?: number
      place?: string
      kind?: string
      status?: string
      completedAt?: Date | null
      priority?: string
      flexibility?: string
      window?: string | null
      remind?: boolean
      note?: string
    } = {},
  ) {
    const [row] = await db
      .insert(schema.commitments)
      .values({
        orgId,
        userId,
        title,
        kind: opts.kind ?? 'meeting',
        dueAt,
        durationMinutes: opts.minutes ?? 60,
        placeLabel: opts.place ?? null,
        priority: opts.priority ?? 'normal',
        flexibility: opts.flexibility ?? 'fixed',
        preferredWindow: opts.window ?? null,
        status: opts.status ?? 'pending',
        completedAt: opts.completedAt ?? null,
        notes: notesWith(opts.note),
      })
      .returning({ id: schema.commitments.id })

    report.commitments += 1
    if (row && (opts.status ?? 'pending') === 'pending' && opts.remind !== false) {
      await scheduleFirstReminder({ orgId, commitmentId: row.id, fireAt: dueAt })
    }
  }

  // --------------------------------------------------- today, partly full
  //
  // Placed relative to the clock, not at fixed hours. A demo run at 6pm with
  // meetings pinned to 10am shows an empty day and three overdue items, which
  // is the opposite of the point — and exactly what happened the first time.
  const soon = (hoursAhead: number) => {
    const d = new Date(now.getTime() + hoursAhead * 3_600_000)
    d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0)
    return d
  }

  // If it is late enough that nothing plausible fits today, lead with tomorrow
  // morning instead of inventing a meeting at half past eleven at night.
  const lateInTheDay = now.getHours() >= 18
  const day1 = lateInTheDay ? 1 : 0

  const sprint = { minutes: 60, note: 'Carry-over stories, team capacity, the sprint goal' }
  const oneOnOne = { minutes: 30, note: 'Feedback on the launch, goals for next quarter' }
  const budget = {
    minutes: 90,
    priority: 'high',
    note: 'Revenue against target and the five largest cost lines',
  }
  if (lateInTheDay) {
    await plan('Sprint planning', at(now, 1, 10), sprint)
    await plan('1:1 with Ananya', at(now, 1, 11, 30), oneOnOne)
    await plan('Review the Q3 budget report', at(now, 1, 15), budget)
  } else {
    await plan('Sprint planning', soon(1), sprint)
    await plan('1:1 with Ananya', soon(2.5), oneOnOne)
    await plan('Review the Q3 budget report', soon(4), budget)
  }

  // Something with no set time, to show the flexible/fixed split — in a
  // window that is still ahead. Pinned to the afternoon, a demo opened at 4pm
  // listed it under "You dropped these" the moment it was made.
  const flexWindow = !lateInTheDay && now.getHours() >= 15 ? 'evening' : 'afternoon'
  await plan(
    'Call the CA about the advance-tax instalment',
    at(now, day1, flexWindow === 'evening' ? 20 : 16),
    {
      kind: 'callback',
      minutes: 15,
      flexibility: 'flexible',
      window: flexWindow,
      remind: false,
    },
  )

  // ------------------------- the one a calendar cannot catch: an impossible day
  // Two real appointments, 150km apart, an hour between them. This is the
  // single clearest demonstration that the app is reasoning, not storing.
  await plan('Quarterly client review', at(now, day1 + 2, 13), {
    minutes: 90,
    place: 'Pune',
    note: 'Bring the renewal proposal and the usage report',
  })
  await plan('Vendor site visit', at(now, day1 + 2, 15, 30), { minutes: 60, place: 'Mumbai' })

  // ---------------------------------------------- things that were dropped
  // Clustered on one weekday on purpose, so the pattern is real rather than
  // asserted: the app should find it, not be told it.
  const lastFriday = (weeksBack: number) => {
    const d = new Date(now.getTime() - weeksBack * 7 * DAY_MS)
    const back = (d.getDay() - 5 + 7) % 7
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 17, 0)
  }
  await plan('Send the revised quotation to the client', lastFriday(1), {
    kind: 'task',
    minutes: 30,
    remind: false,
  })
  await plan('Submit the monthly expense report', lastFriday(2), {
    kind: 'task',
    minutes: 30,
    remind: false,
  })
  await plan('Follow up on the pending vendor invoice', lastFriday(3), {
    kind: 'callback',
    minutes: 15,
    remind: false,
  })
  await plan('Book the annual health check-up', lastFriday(4), {
    kind: 'task',
    minutes: 15,
    remind: false,
  })

  // ------------------------------------------------------- what went well
  const finished = ['Dentist appointment', 'File the GST return', 'Renew the car insurance']
  for (const [i, title] of finished.entries()) {
    await plan(title, at(now, -(i + 1), 11), {
      status: 'done',
      completedAt: at(now, -(i + 1), 11, 30),
      remind: false,
    })
  }

  // ------------------------------------------- a trip, and what is waiting
  const tripStart = at(now, 5, 0)
  const [trip] = await db
    .insert(schema.trips)
    .values({
      orgId,
      userId,
      placeLabel: 'Bengaluru',
      startsOn: ymd(tripStart),
      endsOn: ymd(at(now, 7, 0)),
      strictness: 'flexible',
      notes: MARK,
    })
    .returning({ id: schema.trips.id })
  if (trip) report.trips += 1

  const waiting: Array<[place: string, title: string]> = [
    ['Bengaluru', 'Meet the regional sales team'],
    ['Bengaluru', 'Collect the signed contract from the client'],
    ['Bengaluru', 'Walk through the new office space'],
    // Somewhere with no trip yet, so the "waiting on a trip" case appears too.
    ['Hyderabad', 'Meet the new recruitment partner'],
  ]
  for (const [placeLabel, title] of waiting) {
    await db.insert(schema.intentions).values({
      orgId,
      userId,
      placeLabel,
      title,
      notes: MARK,
      status: 'saved',
    })
    report.intentions += 1
  }

  // ------------------------------------------------------- the repeaters
  // The three shapes a repeat usually takes: every working day, every day at
  // the same time, and once a week.
  const fromTomorrow = ymd(at(now, 1, 0))
  // Tonight's dose only if tonight is still ahead; otherwise the first one
  // would be born overdue.
  const medicineFrom = now.getHours() < 21 ? ymd(now) : fromTomorrow
  const series: Array<typeof schema.recurrences.$inferInsert> = [
    {
      orgId,
      userId,
      title: 'Daily standup',
      kind: 'meeting',
      notes: notesWith('Yesterday, today, anything blocking'),
      durationMinutes: 15,
      freq: 'weekly',
      interval: 1,
      byWeekday: [1, 2, 3, 4, 5],
      startsOn: fromTomorrow,
      hour: 9,
      minute: 30,
    },
    {
      orgId,
      userId,
      title: 'Take evening medicines',
      kind: 'task',
      notes: notesWith('After dinner'),
      durationMinutes: 5,
      freq: 'daily',
      interval: 1,
      startsOn: medicineFrom,
      hour: 21,
      minute: 0,
    },
    {
      orgId,
      userId,
      title: 'Weekly review with your manager',
      kind: 'meeting',
      notes: notesWith('Wins, risks, priorities for next week'),
      durationMinutes: 30,
      freq: 'weekly',
      interval: 1,
      byWeekday: [5],
      startsOn: fromTomorrow,
      hour: 16,
      minute: 0,
    },
  ]

  for (const values of series) {
    const [row] = await db.insert(schema.recurrences).values(values).returning()
    if (!row) continue
    report.series += 1
    // A short horizon: a demo does not need four months of standups, and a
    // hundred identical rows would bury everything else on the calendar.
    await materialise(row, { now, horizonDays: 21 })
  }

  return report
}

/** Removes everything the sample wrote, and nothing else. */
export async function clearSampleDay(orgId: string, userId: string): Promise<number> {
  const scope = (table: typeof schema.commitments | typeof schema.intentions) =>
    and(eq(table.orgId, orgId), eq(table.userId, userId), like(table.notes, `%${MARK}%`))

  const series = await db
    .delete(schema.recurrences)
    .where(
      and(
        eq(schema.recurrences.orgId, orgId),
        eq(schema.recurrences.userId, userId),
        like(schema.recurrences.notes, `%${MARK}%`),
      ),
    )
    .returning({ id: schema.recurrences.id })

  const commitments = await db
    .delete(schema.commitments)
    .where(scope(schema.commitments))
    .returning({ id: schema.commitments.id })

  const intentions = await db
    .delete(schema.intentions)
    .where(scope(schema.intentions))
    .returning({ id: schema.intentions.id })

  const trips = await db
    .delete(schema.trips)
    .where(
      and(
        eq(schema.trips.orgId, orgId),
        eq(schema.trips.userId, userId),
        like(schema.trips.notes, `%${MARK}%`),
      ),
    )
    .returning({ id: schema.trips.id })

  return series.length + commitments.length + intentions.length + trips.length
}

/** Whether this account is currently showing sample data. */
export async function hasSampleDay(orgId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.commitments)
    .where(
      and(
        eq(schema.commitments.orgId, orgId),
        eq(schema.commitments.userId, userId),
        like(schema.commitments.notes, `%${MARK}%`),
      ),
    )
  return (row?.n ?? 0) > 0
}
