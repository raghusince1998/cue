import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapGoogleEvents, type GoogleEvent } from './googleCalendar.ts'

/**
 * Turning Google's JSON into the shape the importer already speaks.
 *
 * The weight sits on the four things that are wrong in a way nobody notices:
 * an all-day end that is exclusive, a date with no zone read as UTC, a series
 * whose rule we cannot model being imported as though it were a single
 * meeting, and a week cancelled in Google still showing up in Cue.
 *
 * Every one of those produces a calendar that looks imported and is subtly
 * untrue, which is worse than one that visibly failed.
 */

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

test('a timed event keeps its instant', () => {
  const { events } = mapGoogleEvents([
    {
      id: 'a',
      summary: 'Client review',
      start: { dateTime: '2026-10-09T11:00:00+05:30' },
      end: { dateTime: '2026-10-09T12:00:00+05:30' },
    },
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0]!.title, 'Client review')
  assert.equal(events[0]!.allDay, false)
  assert.equal(events[0]!.startsAt.toISOString(), '2026-10-09T05:30:00.000Z')
  assert.equal(events[0]!.endsAt!.toISOString(), '2026-10-09T06:30:00.000Z')
})

test('an all-day date is the local day, not UTC midnight', () => {
  // Read as UTC, "2026-10-02" becomes the evening of 1 October anywhere west
  // of Greenwich and the holiday lands on the wrong day. The .ics parser builds
  // a local date for this reason and these two have to agree.
  const { events } = mapGoogleEvents([
    { id: 'h', summary: 'Gandhi Jayanti', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
  ])
  assert.equal(events[0]!.allDay, true)
  assert.equal(ymd(events[0]!.startsAt), '2026-10-02')
})

test('a one-day all-day event does not become two days', () => {
  // Google writes a single day as start 2 Oct, end 3 Oct — the end is
  // exclusive. Taken literally every holiday in an imported calendar renders
  // a day too long.
  const { events } = mapGoogleEvents([
    { id: 'h', summary: 'Holiday', start: { date: '2026-10-02' }, end: { date: '2026-10-03' } },
  ])
  assert.equal(ymd(events[0]!.endsAt!), '2026-10-02')
})

test('a multi-day all-day event keeps its last real day', () => {
  const { events } = mapGoogleEvents([
    { id: 't', summary: 'Agra', start: { date: '2026-10-02' }, end: { date: '2026-10-05' } },
  ])
  assert.equal(ymd(events[0]!.startsAt), '2026-10-02')
  assert.equal(ymd(events[0]!.endsAt!), '2026-10-04')
})

test('a weekly meeting stays one repeating plan', () => {
  const { events } = mapGoogleEvents([
    {
      id: 'standup',
      summary: 'Team standup',
      start: { dateTime: '2026-10-05T09:30:00+05:30' },
      end: { dateTime: '2026-10-05T09:45:00+05:30' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    },
  ])
  assert.equal(events.length, 1)
  assert.ok(events[0]!.rule, 'carries a rule rather than one flat occurrence')
  assert.equal(events[0]!.rule!.freq, 'weekly')
})

test('a rule we cannot model is reported, never imported as a one-off', () => {
  // Importing the first occurrence of a rule we do not understand produces
  // something that looks complete and is missing every other occurrence.
  const { events, skipped } = mapGoogleEvents([
    {
      id: 'odd',
      summary: 'Third Thursday',
      start: { dateTime: '2026-10-15T10:00:00+05:30' },
      recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=3TH'],
    },
  ])
  if (events.length === 0) {
    assert.equal(skipped.length, 1)
    assert.match(skipped[0]!.reason, /repeats/)
  } else {
    // If the parser grew to understand it, it must be a rule — never a bare
    // single event, which is the failure this test exists to prevent.
    assert.ok(events[0]!.rule, 'understood rules keep repeating')
  }
})

test('a week cancelled in Google is excluded from the series', () => {
  const items: GoogleEvent[] = [
    {
      id: 'standup',
      summary: 'Team standup',
      start: { dateTime: '2026-10-05T09:30:00+05:30' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
    },
    {
      id: 'standup_20261012',
      status: 'cancelled',
      recurringEventId: 'standup',
      originalStartTime: { dateTime: '2026-10-12T09:30:00+05:30' },
    },
  ]
  const { events } = mapGoogleEvents(items)
  // The cancelled instance is folded in, not carried as an event of its own.
  assert.equal(events.length, 1)
  assert.deepEqual(events[0]!.rule!.exdates, ['2026-10-12'])
})

test('an EXDATE on the series is honoured too', () => {
  const { events } = mapGoogleEvents([
    {
      id: 's',
      summary: 'Weekly',
      start: { dateTime: '2026-10-05T09:30:00+05:30' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO', 'EXDATE;TZID=Asia/Kolkata:20261019T093000'],
    },
  ])
  assert.deepEqual(events[0]!.rule!.exdates, ['2026-10-19'])
})

test('a deleted one-off is marked cancelled rather than dropped', () => {
  // The importer needs to see it to know it should remove its copy. Silently
  // omitting it would leave a meeting in Cue that no longer exists in Google.
  const { events } = mapGoogleEvents([
    { id: 'gone', summary: 'Cancelled thing', status: 'cancelled', start: { date: '2026-10-09' } },
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0]!.cancelled, true)
})

test('an event with no readable start is reported, not guessed at', () => {
  const { events, skipped } = mapGoogleEvents([{ id: 'x', summary: 'Mystery' }])
  assert.equal(events.length, 0)
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0]!.title, 'Mystery')
})

test('an untitled event still imports', () => {
  const { events } = mapGoogleEvents([{ id: 'u', start: { date: '2026-10-09' } }])
  assert.equal(events[0]!.title, '(untitled)')
})

test('blank description and location become null, not empty strings', () => {
  // An empty string would render an empty notes block on every card.
  const { events } = mapGoogleEvents([
    { id: 'b', summary: 'Thing', description: '   ', location: '', start: { date: '2026-10-09' } },
  ])
  assert.equal(events[0]!.description, null)
  assert.equal(events[0]!.location, null)
})
