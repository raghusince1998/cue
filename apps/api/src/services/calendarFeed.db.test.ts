import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Mirroring a calendar, against the real schema.
 *
 * Four bugs were found by hand in this code before it had any tests: a unique
 * index every occurrence of a repeating event collided on, an all-day DTEND
 * read a day too long, an UNTIL that shifted with the server's timezone, and a
 * check constraint a one-day event tripped. Each is pinned here.
 */
let h: Harness
let me: Seeded
let svc: typeof import('./calendarFeed.ts')
let dbm: typeof import('../db/index.ts')
let feedId: string

before(async () => {
  h = await createTestDb('calfeed')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  svc = await import('./calendarFeed.ts')
  me = await seedUser(h.sql, 'cal@test.local')
})

after(async () => {
  await h.close()
})

const NOW = new Date(2026, 9, 5, 9, 0) // Monday 5 October 2026

async function makeFeed(opts: { remind?: boolean; historyDays?: number | null } = {}) {
  const [row] = await dbm.db
    .insert(dbm.schema.calendarFeeds)
    .values({
      orgId: me.orgId,
      userId: me.userId,
      label: `Feed ${Math.random().toString(36).slice(2, 8)}`,
      source: 'file',
      urlEncrypted: null,
      urlHint: null,
      remind: opts.remind ?? true,
      historyDays: opts.historyDays === undefined ? 365 : opts.historyDays,
    })
    .returning()
  feedId = row!.id
  return row!
}

function ics(...events: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Test', ...events, 'END:VCALENDAR'].join(
    '\r\n',
  )
}

function vevent(uid: string, body: string[]): string {
  return ['BEGIN:VEVENT', `UID:${uid}`, ...body, 'END:VEVENT'].join('\r\n')
}

async function rows(id = feedId) {
  return dbm.db
    .select()
    .from(dbm.schema.commitments)
    .where(eq(dbm.schema.commitments.feedId, id))
}

test('a one-off event is mirrored, then updated rather than duplicated', async () => {
  const feed = await makeFeed()
  const file = ics(
    vevent('a@t', [
      'DTSTART;TZID=Asia/Kolkata:20261012T150000',
      'DTEND;TZID=Asia/Kolkata:20261012T160000',
      'SUMMARY:Client review',
      'LOCATION:Pune',
    ]),
  )

  const first = await svc.importIcs(feed, file, { now: NOW })
  assert.equal(first.imported, 1)
  assert.equal((await rows()).length, 1)

  const again = await svc.importIcs(feed, file, { now: NOW })
  assert.equal(again.imported, 0)
  assert.equal(again.updated, 1, 're-reading the same feed is an update, not a copy')
  assert.equal((await rows()).length, 1)

  const [only] = await rows()
  assert.equal(only!.title, 'Client review')
  assert.equal(only!.placeLabel, 'Pune')
  assert.equal(only!.durationMinutes, 60)
})

test('a one-day all-day event stays one day and sets no end', async () => {
  const feed = await makeFeed()
  // Google writes a single-day holiday as DTSTART 2 Oct / DTEND 3 Oct. Taken
  // literally that is two days; storing it that way also trips the
  // ends_at > due_at check constraint once the end is corrected.
  await svc.importIcs(
    feed,
    ics(
      vevent('day@t', [
        'DTSTART;VALUE=DATE:20261012',
        'DTEND;VALUE=DATE:20261013',
        'SUMMARY:A holiday',
      ]),
    ),
    { now: NOW },
  )

  const [row] = await rows()
  assert.equal(row!.allDay, true)
  assert.equal(row!.endsAt, null, 'a single day is not a span')
  assert.equal(row!.dueAt.getDate(), 12)
})

test('a genuine multi-day event keeps its span', async () => {
  const feed = await makeFeed()
  await svc.importIcs(
    feed,
    ics(
      vevent('span@t', [
        'DTSTART;VALUE=DATE:20261012',
        'DTEND;VALUE=DATE:20261015',
        'SUMMARY:Long weekend',
      ]),
    ),
    { now: NOW },
  )

  const [row] = await rows()
  assert.ok(row!.endsAt, 'three days is a span')
  assert.equal(row!.endsAt!.getDate(), 14, 'DTEND is exclusive')
})

test('a repeating event becomes a series with many occurrences', async () => {
  const feed = await makeFeed()
  const report = await svc.importIcs(
    feed,
    ics(
      vevent('weekly@t', [
        'DTSTART;TZID=Asia/Kolkata:20261006T100000',
        'DTEND;TZID=Asia/Kolkata:20261006T101500',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Team standup',
      ]),
    ),
    { now: NOW },
  )

  assert.equal(report.repeating, 1)
  const series = await dbm.db
    .select()
    .from(dbm.schema.recurrences)
    .where(eq(dbm.schema.recurrences.feedId, feedId))
  assert.equal(series.length, 1)

  // The bug this pins: every occurrence carries the series UID, so a unique
  // index on (feed_id, external_uid) collapsed them all into one.
  const occurrences = await rows()
  assert.ok(occurrences.length > 10, `expected a run of Tuesdays, got ${occurrences.length}`)
})

test('an event that vanishes from the feed is removed', async () => {
  const feed = await makeFeed()
  const both = ics(
    vevent('keep@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:Keep']),
    vevent('drop@t', ['DTSTART;TZID=Asia/Kolkata:20261013T150000', 'SUMMARY:Drop']),
  )
  await svc.importIcs(feed, both, { now: NOW })
  assert.equal((await rows()).length, 2)

  const one = ics(vevent('keep@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:Keep']))
  const report = await svc.importIcs(feed, one, { now: NOW })

  assert.equal(report.removed, 1)
  const left = await rows()
  assert.deepEqual(
    left.map((r) => r.title),
    ['Keep'],
  )
})

test('a sync never touches something the user created', async () => {
  const feed = await makeFeed()
  const [mine] = await dbm.db
    .insert(dbm.schema.commitments)
    .values({
      orgId: me.orgId,
      userId: me.userId,
      title: 'My own plan',
      dueAt: new Date(2026, 9, 12, 15, 0),
    })
    .returning()

  await svc.importIcs(feed, ics(), { now: NOW })

  const [still] = await dbm.db
    .select()
    .from(dbm.schema.commitments)
    .where(eq(dbm.schema.commitments.id, mine!.id))
  assert.ok(still, 'deleting from a calendar must never delete what you wrote yourself')
})

test('an occurrence the user edited survives a re-sync', async () => {
  const feed = await makeFeed()
  const file = ics(
    vevent('edited@t', [
      'DTSTART;TZID=Asia/Kolkata:20261006T100000',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'SUMMARY:Standup',
    ]),
  )
  await svc.importIcs(feed, file, { now: NOW })

  const before = await rows()
  const target = before.sort((a, b) => +a.dueAt - +b.dueAt)[2]!
  await dbm.db
    .update(dbm.schema.commitments)
    .set({ detached: true, title: 'Standup (moved by me)' })
    .where(eq(dbm.schema.commitments.id, target.id))

  await svc.importIcs(feed, file, { now: NOW })

  const [kept] = await dbm.db
    .select()
    .from(dbm.schema.commitments)
    .where(eq(dbm.schema.commitments.id, target.id))
  assert.equal(kept!.title, 'Standup (moved by me)')
})

test('reminders follow the feed setting', async () => {
  const quiet = await makeFeed({ remind: false })
  await svc.importIcs(
    quiet,
    ics(vevent('q@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:Quiet'])),
    { now: NOW },
  )
  const [none] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    join commitments c on c.id = rem.commitment_id where c.feed_id = ${quiet.id}`
  assert.equal(none!.n, 0)

  const loud = await makeFeed({ remind: true })
  await svc.importIcs(
    loud,
    ics(vevent('l@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:Loud'])),
    { now: NOW },
  )
  const [some] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from reminders rem
    join commitments c on c.id = rem.commitment_id where c.feed_id = ${loud.id}`
  assert.equal(some!.n, 1)
})

test('the history window decides how much of the past arrives, and says so', async () => {
  const old = new Date(NOW.getTime() - 200 * 86_400_000)
  const stamp = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const file = ics(
    vevent('old@t', [`DTSTART;TZID=Asia/Kolkata:${stamp(old)}T100000`, 'SUMMARY:Ancient']),
    vevent('new@t', ['DTSTART;TZID=Asia/Kolkata:20261012T100000', 'SUMMARY:Upcoming']),
  )

  const narrow = await makeFeed({ historyDays: 14 })
  const a = await svc.importIcs(narrow, file, { now: NOW })
  assert.equal(a.imported, 1)
  assert.equal(a.outsideWindow, 1, 'a dropped event must be counted, never silent')
  assert.ok(a.oldest, 'and the report should say what the file actually covered')

  const wide = await makeFeed({ historyDays: 365 })
  const b = await svc.importIcs(wide, file, { now: NOW })
  assert.equal(b.imported, 2)
  assert.equal(b.outsideWindow, 0)

  const everything = await makeFeed({ historyDays: null })
  const c = await svc.importIcs(everything, file, { now: NOW })
  assert.equal(c.imported, 2)
  assert.equal(c.outsideWindow, 0)
})

test('deleting a subscription removes everything it brought in', async () => {
  const feed = await makeFeed()
  await svc.importIcs(
    feed,
    ics(
      vevent('x@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:One-off']),
      vevent('y@t', [
        'DTSTART;TZID=Asia/Kolkata:20261006T100000',
        'RRULE:FREQ=WEEKLY;BYDAY=TU',
        'SUMMARY:Repeating',
      ]),
    ),
    { now: NOW },
  )
  assert.ok((await rows()).length > 1)

  await dbm.db.delete(dbm.schema.calendarFeeds).where(eq(dbm.schema.calendarFeeds.id, feed.id))

  assert.equal((await rows(feed.id)).length, 0)
  const series = await dbm.db
    .select()
    .from(dbm.schema.recurrences)
    .where(eq(dbm.schema.recurrences.feedId, feed.id))
  assert.equal(series.length, 0)
})

test('ticking "remind me" covers events already brought in, and unticking stops them', async () => {
  // The box used to apply only to events imported after it changed. On a
  // calendar already being read, that is none of them.
  const reminders = await import('./reminders.ts')
  const feed = await makeFeed({ remind: false })
  await svc.importIcs(
    feed,
    ics(
      vevent('ahead@t', ['DTSTART;TZID=Asia/Kolkata:20261012T150000', 'SUMMARY:Ahead']),
      vevent('past@t', ['DTSTART;TZID=Asia/Kolkata:20261001T150000', 'SUMMARY:Already over']),
    ),
    { now: NOW },
  )
  const pending = async () => {
    const [row] = await h.sql<{ n: number }[]>`
      select count(*)::int as n from reminders rem
      join commitments c on c.id = rem.commitment_id
      where c.feed_id = ${feed.id} and rem.status = 'pending'`
    return row!.n
  }
  assert.equal(await pending(), 0)

  // Only what is still ahead: a reminder for last week is noise.
  assert.equal(await reminders.applyFeedReminders(feed.id, true, NOW), 1)
  assert.equal(await pending(), 1)

  // Ticking it twice must not queue a second reminder for the same event.
  assert.equal(await reminders.applyFeedReminders(feed.id, true, NOW), 0)
  assert.equal(await pending(), 1)

  assert.equal(await reminders.applyFeedReminders(feed.id, false, NOW), 1)
  assert.equal(await pending(), 0)
})

