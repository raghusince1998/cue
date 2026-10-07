import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIcs, parseRRule } from './ics.ts'
import { expandRecurrence } from './recurrence.ts'

/** CRLF, because that is what a real feed sends and unfolding depends on it. */
function ics(...lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n')
}

function fmtUtc(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ')
}

// ------------------------------------------------------------------- basics

test('a plain timed event', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:abc123@google.com',
      'DTSTART:20261006T103000Z',
      'DTEND:20261006T113000Z',
      'SUMMARY:Client call',
      'LOCATION:Pune',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events.length, 1)
  const e = r.events[0]!
  assert.equal(e.uid, 'abc123@google.com')
  assert.equal(e.title, 'Client call')
  assert.equal(e.location, 'Pune')
  assert.equal(fmtUtc(e.startsAt), '2026-10-06 10:30')
  assert.equal(fmtUtc(e.endsAt!), '2026-10-06 11:30')
  assert.equal(e.allDay, false)
  assert.equal(e.rule, null)
})

test('a zoned event resolves to the right instant', () => {
  // 10:30 in Kolkata is 05:00 UTC — the offset is +5:30 and never changes.
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:tz@test',
      'DTSTART;TZID=Asia/Kolkata:20261006T103000',
      'SUMMARY:Standup',
      'END:VEVENT',
    ),
  )
  assert.equal(fmtUtc(r.events[0]!.startsAt), '2026-10-06 05:00')
})

test('a zoned event on the far side of a DST change', () => {
  // New York is UTC-4 in July and UTC-5 in January. Getting this wrong by an
  // hour is the classic timezone bug, and it only shows on one of the two.
  const summer = parseIcs(
    ics('BEGIN:VEVENT', 'UID:s@t', 'DTSTART;TZID=America/New_York:20260715T090000', 'END:VEVENT'),
  )
  const winter = parseIcs(
    ics('BEGIN:VEVENT', 'UID:w@t', 'DTSTART;TZID=America/New_York:20260115T090000', 'END:VEVENT'),
  )
  assert.equal(fmtUtc(summer.events[0]!.startsAt), '2026-07-15 13:00')
  assert.equal(fmtUtc(winter.events[0]!.startsAt), '2026-01-15 14:00')
})

test('an all-day event keeps its date and is flagged', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:bday@test',
      'DTSTART;VALUE=DATE:20260314',
      'DTEND;VALUE=DATE:20260315',
      "SUMMARY:Mom's birthday",
      'END:VEVENT',
    ),
  )
  const e = r.events[0]!
  assert.equal(e.allDay, true)
  assert.equal(e.startsAt.getFullYear(), 2026)
  assert.equal(e.startsAt.getMonth(), 2)
  assert.equal(e.startsAt.getDate(), 14)
})

// ------------------------------------------------------------ the awkward bits

test('an all-day DTEND is exclusive, so a one-day event stays one day', () => {
  // Google writes a single-day holiday as DTSTART 2 Oct / DTEND 3 Oct. Taken
  // at face value every holiday in an imported calendar spans two days.
  const one = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:oneday@test',
      'DTSTART;VALUE=DATE:20261002',
      'DTEND;VALUE=DATE:20261003',
      'SUMMARY:Gandhi Jayanti',
      'END:VEVENT',
    ),
  ).events[0]!
  assert.equal(one.startsAt.getDate(), 2)
  assert.equal(one.endsAt!.getDate(), 2)

  const three = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:threeday@test',
      'DTSTART;VALUE=DATE:20261002',
      'DTEND;VALUE=DATE:20261005',
      'SUMMARY:Long weekend',
      'END:VEVENT',
    ),
  ).events[0]!
  assert.equal(three.endsAt!.getDate(), 4)

  // A timed event's DTEND is inclusive of the instant and must not shift.
  const timed = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:timed@test',
      'DTSTART:20261002T100000Z',
      'DTEND:20261002T113000Z',
      'END:VEVENT',
    ),
  ).events[0]!
  assert.equal(timed.endsAt!.toISOString().slice(11, 16), '11:30')
})

test('folded lines are joined before anything else reads them', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:fold@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Quarterly planning session with the whole team and the ',
      ' external consultants',
      'END:VEVENT',
    ),
  )
  assert.equal(
    r.events[0]!.title,
    'Quarterly planning session with the whole team and the external consultants',
  )
})

test('a VTIMEZONE block is not mistaken for an event', () => {
  // The trap: STANDARD and DAYLIGHT carry their own DTSTART and RRULE. Read
  // flat, this file looks like it contains two events that repeat forever.
  const r = parseIcs(
    ics(
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0500',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:real@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:The only real event',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0]!.title, 'The only real event')
})

test('a VALARM inside an event does not overwrite the event', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:alarm@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Dentist',
      'DESCRIPTION:Bring the referral letter',
      'BEGIN:VALARM',
      'TRIGGER:-PT30M',
      'DESCRIPTION:Reminder',
      'ACTION:DISPLAY',
      'END:VALARM',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events[0]!.description, 'Bring the referral letter')
})

test('escaped characters come back as themselves', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:esc@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Lunch\\, then review',
      'DESCRIPTION:First line\\nSecond line\\; with a semicolon',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events[0]!.title, 'Lunch, then review')
  assert.equal(r.events[0]!.description, 'First line\nSecond line; with a semicolon')
})

test('a value containing a colon is not cut short', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:url@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Call: https://meet.google.com/abc-defg',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events[0]!.title, 'Call: https://meet.google.com/abc-defg')
})

test('the calendar name is picked up', () => {
  const r = parseIcs(
    ics('X-WR-CALNAME:Sid\\, personal', 'BEGIN:VEVENT', 'UID:x@t', 'DTSTART:20261006T100000Z', 'END:VEVENT'),
  )
  assert.equal(r.calendarName, 'Sid, personal')
})

test('cancelled events are flagged rather than dropped silently', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:gone@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Cancelled meeting',
      'STATUS:CANCELLED',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events[0]!.cancelled, true)
})

// ------------------------------------------------------------------- RRULE

test('common RRULEs map onto our rules', () => {
  const cases: Array<[string, object]> = [
    ['FREQ=DAILY', { freq: 'daily', interval: 1 }],
    ['FREQ=DAILY;INTERVAL=3', { freq: 'daily', interval: 3 }],
    ['FREQ=WEEKLY;BYDAY=TU', { freq: 'weekly', interval: 1, byWeekday: [2] }],
    ['FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', { freq: 'weekly', interval: 2, byWeekday: [5] }],
    ['FREQ=WEEKLY;BYDAY=MO,WE,FR', { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }],
    ['FREQ=MONTHLY;BYMONTHDAY=1', { freq: 'monthly', interval: 1, byMonthDay: 1 }],
    ['FREQ=MONTHLY;BYDAY=2TU', { freq: 'monthly', interval: 1, byWeekday: [2], setPos: 2 }],
    ['FREQ=MONTHLY;BYDAY=-1FR', { freq: 'monthly', interval: 1, byWeekday: [5], setPos: -1 }],
    ['FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2', { freq: 'monthly', interval: 1, byWeekday: [2], setPos: 2 }],
    ['FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14', { freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 14 }],
    ['FREQ=WEEKLY;BYDAY=TU;COUNT=6', { freq: 'weekly', interval: 1, byWeekday: [2], count: 6 }],
  ]
  for (const [rrule, want] of cases) {
    const got = parseRRule(rrule)
    assert.ok(got, `${rrule} was rejected`)
    for (const [k, v] of Object.entries(want)) {
      assert.deepEqual(got[k as keyof typeof got], v, `${rrule} -> ${k}`)
    }
  }
})

test('UNTIL becomes a plain end date', () => {
  assert.equal(parseRRule('FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z')?.until, '2026-12-31')
})

test('rules we cannot model are rejected, not approximated', () => {
  const unsupported = [
    'FREQ=HOURLY',
    'FREQ=MINUTELY;INTERVAL=30',
    'FREQ=MONTHLY;BYMONTHDAY=1,15',
    'FREQ=YEARLY;BYWEEKNO=20',
    'FREQ=YEARLY;BYYEARDAY=100',
    'FREQ=DAILY;BYHOUR=9,17',
    'FREQ=MONTHLY;BYDAY=1MO,3MO',
    'BYDAY=TU',
  ]
  for (const rrule of unsupported) {
    assert.equal(parseRRule(rrule), null, `${rrule} should be rejected`)
  }
})

test('an event whose repeat we cannot model is skipped and reported', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:odd@test',
      'DTSTART:20261006T100000Z',
      'SUMMARY:Medication',
      'RRULE:FREQ=HOURLY;INTERVAL=8',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events.length, 0)
  assert.equal(r.skipped.length, 1)
  assert.equal(r.skipped[0]!.title, 'Medication')
  assert.match(r.skipped[0]!.reason, /cannot describe/)
})

// ---------------------------------------------------------------- exclusions

test('EXDATE removes that occurrence and nothing else', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:ex@test',
      'DTSTART;TZID=Asia/Kolkata:20261006T100000',
      'SUMMARY:Weekly standup',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'EXDATE;TZID=Asia/Kolkata:20261020T100000',
      'END:VEVENT',
    ),
  )
  const rule = r.events[0]!.rule!
  assert.deepEqual(rule.exdates, ['2026-10-20'])

  const dates = expandRecurrence(
    rule,
    { startsOn: new Date(2026, 9, 6), hour: 10, minute: 0 },
    { from: new Date(2026, 9, 1), to: new Date(2026, 10, 3, 23, 59) },
  ).map((d) => `${d.getMonth() + 1}/${d.getDate()}`)

  // 20 October is gone; the Tuesdays either side of it are not.
  assert.deepEqual(dates, ['10/6', '10/13', '10/27', '11/3'])
})

test('a moved single instance is skipped rather than duplicating that day', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:series@test',
      'DTSTART;TZID=Asia/Kolkata:20261006T100000',
      'SUMMARY:Standup',
      'RRULE:FREQ=WEEKLY;BYDAY=TU',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@test',
      'RECURRENCE-ID;TZID=Asia/Kolkata:20261013T100000',
      'DTSTART;TZID=Asia/Kolkata:20261013T140000',
      'SUMMARY:Standup (moved)',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0]!.rule?.freq, 'weekly')
  assert.equal(r.skipped.length, 1)
  assert.match(r.skipped[0]!.reason, /one-off change/)
})

// -------------------------------------------------------------- broken input

test('events missing what we need are reported, and the rest still import', () => {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:nostart@test',
      'SUMMARY:No date on this one',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261006T100000Z',
      'SUMMARY:No UID on this one',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:fine@test',
      'DTSTART:20261007T100000Z',
      'SUMMARY:This one is fine',
      'END:VEVENT',
    ),
  )
  assert.equal(r.events.length, 1)
  assert.equal(r.events[0]!.title, 'This one is fine')
  assert.equal(r.skipped.length, 2)
})

test('empty and junk input does not throw', () => {
  for (const junk of ['', 'not a calendar at all', 'BEGIN:VCALENDAR', '\r\n\r\n']) {
    const r = parseIcs(junk)
    assert.deepEqual(r.events, [])
  }
})

/**
 * Outlook and Microsoft 365, which do not speak IANA.
 *
 * Every timed event Microsoft exports carries a Windows zone name. Before the
 * lookup existed, `Intl` threw on those and the parser quietly used the
 * server's own zone — so a Teams meeting at 11:00 Pacific appeared at 11:00
 * in India. Half a day out, no error, and the screen looked perfectly normal.
 * That is the failure these tests exist to stop coming back.
 */
function startOf(tzid: string): string | null {
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:tz',
      'SUMMARY:Probe',
      `DTSTART;TZID="${tzid}":20261009T110000`,
      'END:VEVENT',
    ),
  )
  return r.events[0] ? r.events[0].startsAt.toISOString() : null
}

test('a Windows zone name is understood, not guessed at', () => {
  assert.equal(startOf('Pacific Standard Time'), '2026-10-09T18:00:00.000Z')
  assert.equal(startOf('India Standard Time'), '2026-10-09T05:30:00.000Z')
  assert.equal(startOf('China Standard Time'), '2026-10-09T03:00:00.000Z')
})

test('a Windows zone follows daylight saving, not its own name', () => {
  // "Eastern Standard Time" in October is actually EDT, UTC-4. Reading the
  // name literally would be an hour out for half the year.
  assert.equal(startOf('Eastern Standard Time'), '2026-10-09T15:00:00.000Z')
  // Likewise "GMT Standard Time" is London, which is on BST in October.
  assert.equal(startOf('GMT Standard Time'), '2026-10-09T10:00:00.000Z')
})

test('an IANA zone still works', () => {
  assert.equal(startOf('Asia/Kolkata'), '2026-10-09T05:30:00.000Z')
  assert.equal(startOf('America/Los_Angeles'), '2026-10-09T18:00:00.000Z')
})

test('a zone we cannot resolve is reported, never silently localised', () => {
  // The whole point. Falling back to the server's zone produces a time that is
  // confidently wrong, which is worse than an event that visibly did not come.
  const r = parseIcs(
    ics(
      'BEGIN:VEVENT',
      'UID:tz',
      'SUMMARY:Mystery meeting',
      'DTSTART;TZID="Fictional Standard Time":20261009T110000',
      'END:VEVENT',
    ),
  )
  assert.deepEqual(r.events, [])
  assert.equal(r.skipped.length, 1)
  assert.match(r.skipped[0]!.reason, /time zone/)
  assert.match(r.skipped[0]!.reason, /Fictional Standard Time/)
})

test('a whole Outlook calendar imports, Teams links and all', () => {
  const r = parseIcs(
    ics(
      'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
      'X-WR-CALNAME:Work',
      'BEGIN:VEVENT',
      'UID:040000008200E00074C5B7101A82E008',
      'SUMMARY:Sprint planning',
      'DTSTART;TZID="India Standard Time":20261009T110000',
      'DTEND;TZID="India Standard Time":20261009T120000',
      'LOCATION:Microsoft Teams Meeting',
      'DESCRIPTION:Join: https://teams.microsoft.com/l/meetup-join/abc',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:040000008200E00074C5B7101A82E009',
      'SUMMARY:Weekly sync',
      'DTSTART;TZID="India Standard Time":20261005T093000',
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:040000008200E00074C5B7101A82E010',
      'SUMMARY:Diwali',
      'DTSTART;VALUE=DATE:20261108',
      'DTEND;VALUE=DATE:20261109',
      'END:VEVENT',
    ),
  )

  assert.equal(r.calendarName, 'Work')
  assert.equal(r.skipped.length, 0)
  assert.deepEqual(
    r.events.map((e) => e.title),
    ['Sprint planning', 'Weekly sync', 'Diwali'],
  )
  // A Teams meeting is an ordinary calendar event; the join link rides along
  // in the notes, which is what makes it tappable from the reminder.
  assert.match(r.events[0]!.description!, /teams\.microsoft\.com/)
  assert.equal(r.events[1]!.rule!.freq, 'weekly')
  // All-day, and one day rather than two.
  assert.equal(r.events[2]!.allDay, true)
})
