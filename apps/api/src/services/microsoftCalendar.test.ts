import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapGraphEvents, mapGraphRecurrence, type GraphEvent } from './microsoftCalendar.ts'

/**
 * Turning Microsoft Graph's JSON into the shape the importer already speaks.
 *
 * Graph differs from Google in the two places most likely to be silently
 * wrong: times arrive as a naive wall clock plus a separate zone name — usually
 * a *Windows* one — and recurrence is a structured object rather than an RRULE
 * string, so it has to be translated rather than parsed.
 */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const utc = (text: string) => ({ dateTime: text, timeZone: 'UTC' })

test('a timed event keeps its instant', () => {
  const { events } = mapGraphEvents([
    {
      id: 'a',
      subject: 'Sprint planning',
      start: utc('2026-10-09T05:30:00.0000000'),
      end: utc('2026-10-09T06:30:00.0000000'),
    },
  ])
  assert.equal(events[0]!.title, 'Sprint planning')
  assert.equal(events[0]!.startsAt.toISOString(), '2026-10-09T05:30:00.000Z')
  assert.equal(events[0]!.endsAt!.toISOString(), '2026-10-09T06:30:00.000Z')
})

test("Graph's seven fractional digits do not defeat the parser", () => {
  // `new Date()` rejects more than three. Left unhandled, every single event
  // from Microsoft fails to import.
  const { events, skipped } = mapGraphEvents([
    { id: 'a', subject: 'Thing', start: utc('2026-10-09T05:30:00.1234567') },
  ])
  assert.equal(skipped.length, 0)
  assert.equal(events[0]!.startsAt.toISOString(), '2026-10-09T05:30:00.123Z')
})

test('a Windows zone name is honoured when Graph ignores the UTC hint', () => {
  // The Prefer header asks for UTC, but a server that disregards it sends the
  // organiser's own zone — and Microsoft writes those as Windows names.
  const { events } = mapGraphEvents([
    {
      id: 'a',
      subject: 'West coast call',
      start: { dateTime: '2026-10-09T11:00:00.0000000', timeZone: 'Pacific Standard Time' },
    },
  ])
  assert.equal(events[0]!.startsAt.toISOString(), '2026-10-09T18:00:00.000Z')
})

test('a zone that cannot be resolved is reported, never silently localised', () => {
  const { events, skipped } = mapGraphEvents([
    {
      id: 'a',
      subject: 'Mystery',
      start: { dateTime: '2026-10-09T11:00:00.0000000', timeZone: 'Fictional Standard Time' },
    },
  ])
  assert.equal(events.length, 0)
  assert.match(skipped[0]!.reason, /time zone/)
})

test('an all-day event is a local date and does not become two days', () => {
  const { events } = mapGraphEvents([
    {
      id: 'h',
      subject: 'Diwali',
      isAllDay: true,
      start: utc('2026-11-08T00:00:00.0000000'),
      end: utc('2026-11-09T00:00:00.0000000'),
    },
  ])
  assert.equal(events[0]!.allDay, true)
  assert.equal(ymd(events[0]!.startsAt), '2026-11-08')
  // The end is exclusive, exactly as in iCalendar.
  assert.equal(ymd(events[0]!.endsAt!), '2026-11-08')
})

test('a Teams join link comes through where a reminder can use it', () => {
  const { events } = mapGraphEvents([
    {
      id: 'a',
      subject: 'Standup',
      start: utc('2026-10-09T05:30:00.0000000'),
      location: { displayName: 'Microsoft Teams Meeting' },
      bodyPreview: 'Weekly catch-up',
      onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' },
    },
  ])
  assert.equal(events[0]!.location, 'Microsoft Teams Meeting')
  assert.match(events[0]!.description!, /teams\.microsoft\.com/)
})

test('a changed instance of a series is skipped, not imported twice', () => {
  const items: GraphEvent[] = [
    { id: 'x', subject: 'Moved week', type: 'exception', seriesMasterId: 's', start: utc('2026-10-12T05:30:00.0000000') },
  ]
  const { events, skipped } = mapGraphEvents(items)
  assert.equal(events.length, 0)
  assert.match(skipped[0]!.reason, /one-off change/)
})

test('a cancelled event is marked, not dropped', () => {
  // The importer needs to see it to know it should remove its copy.
  const { events } = mapGraphEvents([
    { id: 'a', subject: 'Called off', isCancelled: true, start: utc('2026-10-09T05:30:00.0000000') },
  ])
  assert.equal(events[0]!.cancelled, true)
})

test('weekly recurrence translates, days and all', () => {
  const rule = mapGraphRecurrence({
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.freq, 'weekly')
  assert.deepEqual(rule!.byWeekday, [1, 3, 5])
  assert.equal(rule!.until ?? null, null)
})

test('every other week keeps its interval', () => {
  const rule = mapGraphRecurrence({
    pattern: { type: 'weekly', interval: 2, daysOfWeek: ['tuesday'] },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.interval, 2)
})

test('"the second Tuesday" is a position, not a fortnight', () => {
  // Read as every-two-weeks it drifts off the real date within two months.
  const rule = mapGraphRecurrence({
    pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.freq, 'monthly')
  assert.equal(rule!.setPos, 2)
  assert.deepEqual(rule!.byWeekday, [2])
})

test('"the last Friday" is -1', () => {
  const rule = mapGraphRecurrence({
    pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.setPos, -1)
})

test('a day-of-month rule keeps its day', () => {
  const rule = mapGraphRecurrence({
    pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.freq, 'monthly')
  assert.equal(rule!.byMonthDay, 15)
})

test('a yearly rule keeps month and day, zero-indexed for the month', () => {
  const rule = mapGraphRecurrence({
    pattern: { type: 'absoluteYearly', interval: 1, month: 11, dayOfMonth: 8 },
    range: { type: 'noEnd' },
  })
  assert.equal(rule!.freq, 'yearly')
  assert.equal(rule!.byMonth, 10, 'November is 10, not 11')
  assert.equal(rule!.byMonthDay, 8)
})

test('an end date and a count both survive', () => {
  const ends = mapGraphRecurrence({
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'endDate', endDate: '2026-12-31' },
  })
  assert.equal(ends!.until, '2026-12-31')

  const counted = mapGraphRecurrence({
    pattern: { type: 'daily', interval: 1 },
    range: { type: 'numbered', numberOfOccurrences: 10 },
  })
  assert.equal(counted!.count, 10)
})

test('a pattern we cannot model is refused rather than approximated', () => {
  // "the first Monday of May every year" — our rule has no yearly position, and
  // importing it as something close would be wrong on most of the dates.
  assert.equal(
    mapGraphRecurrence({
      pattern: { type: 'relativeYearly', interval: 1, daysOfWeek: ['monday'], index: 'first', month: 5 },
      range: { type: 'noEnd' },
    }),
    null,
  )
})

test('an unmodellable series is reported, never flattened to one meeting', () => {
  const { events, skipped } = mapGraphEvents([
    {
      id: 's',
      subject: 'Annual review',
      start: utc('2026-05-04T09:00:00.0000000'),
      recurrence: {
        pattern: { type: 'relativeYearly', interval: 1, daysOfWeek: ['monday'], index: 'first', month: 5 },
        range: { type: 'noEnd' },
      },
    },
  ])
  assert.equal(events.length, 0, 'not imported as a single meeting that looks complete')
  assert.match(skipped[0]!.reason, /repeats/)
})

test('a whole Outlook calendar maps in one pass', () => {
  const { events, skipped } = mapGraphEvents(
    [
      {
        id: '1',
        subject: 'Sprint planning',
        start: utc('2026-10-09T05:30:00.0000000'),
        end: utc('2026-10-09T06:30:00.0000000'),
        onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/x' },
      },
      {
        id: '2',
        subject: 'Weekly sync',
        start: utc('2026-10-05T04:00:00.0000000'),
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
          range: { type: 'noEnd' },
        },
      },
      {
        id: '3',
        subject: 'Diwali',
        isAllDay: true,
        start: utc('2026-11-08T00:00:00.0000000'),
        end: utc('2026-11-09T00:00:00.0000000'),
      },
    ],
    'Work',
  )

  assert.equal(skipped.length, 0)
  assert.deepEqual(
    events.map((e) => e.title),
    ['Sprint planning', 'Weekly sync', 'Diwali'],
  )
  assert.equal(events[1]!.rule!.freq, 'weekly')
  assert.equal(events[2]!.allDay, true)
})
