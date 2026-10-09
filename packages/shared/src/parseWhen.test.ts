import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWhen, titleFrom } from './parseWhen.ts'

/** Wednesday 19 August 2026, 14:30 local. Every case is relative to this. */
const NOW = new Date(2026, 7, 19, 14, 30, 0, 0)

function parse(input: string) {
  const result = parseWhen(input, NOW)
  assert.ok(result, `expected "${input}" to parse`)
  return result
}

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

test('weekday with pm time', () => {
  const r = parse('dentist friday 6pm')
  assert.equal(iso(r.date), '2026-08-21 18:00')
  assert.equal(titleFrom('dentist friday 6pm', r), 'dentist')
})

test('bare hour after a weekday reads as afternoon', () => {
  // "friday 6" — nobody means 6am.
  assert.equal(iso(parse('client meeting friday 6').date), '2026-08-21 18:00')
})

test('bare hour of 9 reads as morning', () => {
  assert.equal(iso(parse('standup friday 9').date), '2026-08-21 09:00')
})

test('tomorrow with explicit time', () => {
  const r = parse('call client tomorrow 4pm')
  assert.equal(iso(r.date), '2026-08-20 16:00')
  assert.equal(titleFrom('call client tomorrow 4pm', r), 'call client')
})

test('what led into the date goes with it: no title ending in "by"', () => {
  const input = 'Please send the revised quotation by friday 4pm'
  const r = parse(input)
  assert.equal(iso(r.date), '2026-08-21 16:00')
  assert.equal(titleFrom(input, r), 'send the revised quotation')
  const until = 'finish the tender document before monday 10am'
  assert.equal(titleFrom(until, parse(until)), 'finish the tender document')
})

test('day after tomorrow is not swallowed by tomorrow', () => {
  assert.equal(iso(parse('review day after tomorrow').date), '2026-08-21 09:00')
})

test('relative days do not leak their number into the clock', () => {
  // The 3 in "in 3 days" must not come back as 3pm.
  assert.equal(iso(parse('submit report in 3 days').date), '2026-08-22 09:00')
})

test('relative hours keep an exact time', () => {
  assert.equal(iso(parse('call back in 2 hours').date), '2026-08-19 16:30')
})

test('relative minutes', () => {
  assert.equal(iso(parse('ring reception in 20 minutes').date), '2026-08-19 14:50')
})

test('"in an hour" without a number', () => {
  assert.equal(iso(parse('follow up in an hour').date), '2026-08-19 15:30')
})

test('next week', () => {
  assert.equal(iso(parse('review next week').date), '2026-08-26 09:00')
})

test('"next friday" skips past this friday', () => {
  const thisFriday = parse('friday').date
  const nextFriday = parse('next friday').date
  assert.equal(iso(thisFriday), '2026-08-21 09:00')
  assert.equal(iso(nextFriday), '2026-08-28 09:00')
  assert.notEqual(iso(thisFriday), iso(nextFriday))
})

test('a weekday that already passed this week rolls forward', () => {
  // NOW is Wednesday; Monday has gone.
  assert.equal(iso(parse('physio monday 11am').date), '2026-08-24 11:00')
})

test('today with a part of day', () => {
  assert.equal(iso(parse('call mum this evening').date), '2026-08-19 18:00')
})

test('tonight', () => {
  assert.equal(iso(parse('dinner tonight').date), '2026-08-19 20:00')
})

test('time only, still ahead today', () => {
  assert.equal(iso(parse('meeting at 6pm').date), '2026-08-19 18:00')
})

test('time only, already gone today rolls to tomorrow', () => {
  // NOW is 14:30, so 9am has passed.
  assert.equal(iso(parse('gym at 9am').date), '2026-08-20 09:00')
})

test('24-hour clock', () => {
  assert.equal(iso(parse('call at 16:45').date), '2026-08-19 16:45')
})

test('day and month by name', () => {
  assert.equal(iso(parse('anniversary 25 dec').date), '2026-12-25 09:00')
})

test('month then day', () => {
  assert.equal(iso(parse('conference dec 25 10am').date), '2026-12-25 10:00')
})

test('a date already past rolls to next year', () => {
  assert.equal(iso(parse('renew 5 jan').date), '2027-01-05 09:00')
})

test('day-first numeric dates', () => {
  // 5/9 is 5 September here, not 9 May.
  assert.equal(iso(parse('inspection 5/9 at 3pm').date), '2026-09-05 15:00')
})

test('duration is picked up and does not become the time', () => {
  const r = parse('client call tomorrow 11am for 45 min')
  assert.equal(iso(r.date), '2026-08-20 11:00')
  assert.equal(r.durationMinutes, 45)
  assert.equal(titleFrom('client call tomorrow 11am for 45 min', r), 'client call')
})

test('duration in hours', () => {
  assert.equal(parse('workshop friday 10am for 2 hours').durationMinutes, 120)
})

test('flags when the time was assumed rather than given', () => {
  assert.equal(parse('dentist friday').timeAssumed, true)
  assert.equal(parse('dentist friday 6pm').timeAssumed, false)
})

test('gives up cleanly on text with no date in it', () => {
  assert.equal(parseWhen('buy milk', NOW), null)
  assert.equal(parseWhen('', NOW), null)
  assert.equal(parseWhen('call the 3 suppliers', NOW), null)
})

test('a bare number alone is not treated as a time', () => {
  // Without a date anchor or an "at", "5" is just part of the title.
  assert.equal(parseWhen('order 5 boxes', NOW), null)
})

test('title survives when the date is in the middle', () => {
  const input = 'meet dr sharma tomorrow at 4pm about the pricing'
  const r = parse(input)
  assert.equal(iso(r.date), '2026-08-20 16:00')
  assert.equal(titleFrom(input, r), 'meet dr sharma about the pricing')
})

test('case and extra spacing do not matter', () => {
  assert.equal(iso(parse('  DENTIST   Friday   6PM  ').date), '2026-08-21 18:00')
})

test('12am and 12pm are not swapped', () => {
  // NOW is 14:30, so both readings have already passed today and roll forward.
  // The point of the test is that noon is not read as midnight.
  assert.equal(iso(parse('call at 12pm').date), '2026-08-20 12:00')
  assert.equal(iso(parse('deploy at 12am').date), '2026-08-20 00:00')
  assert.equal(iso(parse('lunch tomorrow 12pm').date), '2026-08-20 12:00')
  assert.equal(iso(parse('deploy tomorrow 12am').date), '2026-08-20 00:00')
})

// --- windows vs invented clock times ---------------------------------------
// The planner must not pretend "this afternoon" meant 2:00 PM.

test('a part of the day is reported as a window, not an exact time', () => {
  assert.equal(parse('call plumber this afternoon').window, 'afternoon')
  assert.equal(parse('call mum this evening').window, 'evening')
  assert.equal(parse('dinner tonight').window, 'night')
  assert.equal(parse('gym tomorrow morning').window, 'morning')
})

test('an exact clock time is never a window', () => {
  assert.equal(parse('dentist friday 6pm').window, undefined)
  assert.equal(parse('call at 16:45').window, undefined)
  assert.equal(parse('standup friday 9').window, undefined)
})

test('noon and midnight name instants, not windows', () => {
  assert.equal(parse('lunch tomorrow at noon').window, undefined)
  assert.equal(parse('deploy tomorrow midnight').window, undefined)
})

test('the representative hour still lands inside its own window', () => {
  // Callers order by `date`, so the stand-in hour has to be sane even though
  // the window is what actually matters.
  const windows: Record<string, [number, number]> = {
    morning: [6, 12],
    afternoon: [12, 17],
    evening: [17, 21],
    night: [21, 24],
  }
  for (const phrase of ['tomorrow morning', 'tomorrow afternoon', 'tomorrow evening']) {
    const r = parse(`thing ${phrase}`)
    const [from, to] = windows[r.window!]!
    assert.ok(
      r.date.getHours() >= from && r.date.getHours() < to,
      `${phrase} -> ${r.date.getHours()}:00 is outside ${r.window} (${from}-${to})`,
    )
  }
})
