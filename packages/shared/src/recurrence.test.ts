import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  expandRecurrence,
  nextOccurrence,
  occursOn,
  describeRecurrence,
  ordinal,
  type RecurrenceRule,
  type RecurrenceAnchor,
} from './recurrence.ts'

const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm)

/** Compact "YYYY-MM-DD HH:mm" so a failing test reads like a calendar. */
function fmt(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** `to` covers the whole day named, so the cases below read as calendar dates. */
function run(
  rule: RecurrenceRule,
  anchor: RecurrenceAnchor,
  from: Date,
  to: Date,
): string[] {
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59)
  return expandRecurrence(rule, anchor, { from, to: end }).map(fmt)
}

const anchorAt = (d: Date, hour = 9, minute = 0): RecurrenceAnchor => ({
  startsOn: d,
  hour,
  minute,
})

// ---------------------------------------------------------------- daily

test('daily repeats every day at the anchor time', () => {
  const out = run(
    { freq: 'daily', interval: 1 },
    anchorAt(at(2026, 3, 1), 7, 30),
    at(2026, 3, 1),
    at(2026, 3, 5, 23, 59),
  )
  assert.deepEqual(out, [
    '2026-03-01 07:30',
    '2026-03-02 07:30',
    '2026-03-03 07:30',
    '2026-03-04 07:30',
    '2026-03-05 07:30',
  ])
})

test('daily with an interval skips the days in between', () => {
  const out = run(
    { freq: 'daily', interval: 3 },
    anchorAt(at(2026, 3, 1)),
    at(2026, 3, 1),
    at(2026, 3, 10, 23, 59),
  )
  assert.deepEqual(out, ['2026-03-01 09:00', '2026-03-04 09:00', '2026-03-07 09:00', '2026-03-10 09:00'])
})

test('daily crosses a month boundary', () => {
  const out = run(
    { freq: 'daily', interval: 1 },
    anchorAt(at(2026, 1, 30)),
    at(2026, 1, 30),
    at(2026, 2, 2, 23, 59),
  )
  assert.deepEqual(out, [
    '2026-01-30 09:00',
    '2026-01-31 09:00',
    '2026-02-01 09:00',
    '2026-02-02 09:00',
  ])
})

// --------------------------------------------------------------- weekly

test('weekly with no weekday given repeats on the anchor weekday', () => {
  // 2026-03-03 is a Tuesday.
  const out = run(
    { freq: 'weekly', interval: 1 },
    anchorAt(at(2026, 3, 3), 18, 0),
    at(2026, 3, 1),
    at(2026, 3, 31),
  )
  assert.deepEqual(out, [
    '2026-03-03 18:00',
    '2026-03-10 18:00',
    '2026-03-17 18:00',
    '2026-03-24 18:00',
    '2026-03-31 18:00',
  ])
})

test('weekly on several weekdays returns them in day order', () => {
  // Mon/Wed/Fri gym, starting Monday 2026-03-02.
  const out = run(
    { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] },
    anchorAt(at(2026, 3, 2), 6, 30),
    at(2026, 3, 2),
    at(2026, 3, 13, 23, 59),
  )
  assert.deepEqual(out, [
    '2026-03-02 06:30',
    '2026-03-04 06:30',
    '2026-03-06 06:30',
    '2026-03-09 06:30',
    '2026-03-11 06:30',
    '2026-03-13 06:30',
  ])
})

test('every other week keeps the anchor fortnight', () => {
  const out = run(
    { freq: 'weekly', interval: 2, byWeekday: [2] },
    anchorAt(at(2026, 3, 3)),
    at(2026, 3, 1),
    at(2026, 4, 30),
  )
  assert.deepEqual(out, [
    '2026-03-03 09:00',
    '2026-03-17 09:00',
    '2026-03-31 09:00',
    '2026-04-14 09:00',
    '2026-04-28 09:00',
  ])
})

test('a weekday earlier in the week than the anchor waits for the next cycle', () => {
  // Anchor is Wednesday; the rule also names Monday. The Monday two days
  // earlier is before the series begins and must not be emitted.
  const out = run(
    { freq: 'weekly', interval: 1, byWeekday: [1, 3] },
    anchorAt(at(2026, 3, 4)),
    at(2026, 3, 1),
    at(2026, 3, 14),
  )
  assert.deepEqual(out, ['2026-03-04 09:00', '2026-03-09 09:00', '2026-03-11 09:00'])
})

test('weekdays-only skips the weekend', () => {
  const out = run(
    { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
    anchorAt(at(2026, 3, 5)),
    at(2026, 3, 5),
    at(2026, 3, 10, 23, 59),
  )
  // Thu 5th, Fri 6th, then straight to Mon 9th and Tue 10th.
  assert.deepEqual(out, [
    '2026-03-05 09:00',
    '2026-03-06 09:00',
    '2026-03-09 09:00',
    '2026-03-10 09:00',
  ])
})

// -------------------------------------------------------------- monthly

test('monthly repeats on the same day each month', () => {
  const out = run(
    { freq: 'monthly', interval: 1, byMonthDay: 1 },
    anchorAt(at(2026, 1, 1), 10, 0),
    at(2026, 1, 1),
    at(2026, 4, 30),
  )
  assert.deepEqual(out, [
    '2026-01-01 10:00',
    '2026-02-01 10:00',
    '2026-03-01 10:00',
    '2026-04-01 10:00',
  ])
})

test('the 31st falls back to the last day of a short month, never skipped', () => {
  // The whole point of diverging from RFC 5545: rent still gets paid in
  // February rather than silently vanishing for a month.
  const out = run(
    { freq: 'monthly', interval: 1, byMonthDay: 31 },
    anchorAt(at(2026, 1, 31)),
    at(2026, 1, 1),
    at(2026, 5, 31),
  )
  assert.deepEqual(out, [
    '2026-01-31 09:00',
    '2026-02-28 09:00',
    '2026-03-31 09:00',
    '2026-04-30 09:00',
    '2026-05-31 09:00',
  ])
})

test('clamping does not stick — a short month does not shorten the next', () => {
  const out = run(
    { freq: 'monthly', interval: 1, byMonthDay: 30 },
    anchorAt(at(2026, 2, 28)),
    at(2026, 2, 1),
    at(2026, 4, 30),
  )
  assert.deepEqual(out, ['2026-02-28 09:00', '2026-03-30 09:00', '2026-04-30 09:00'])
})

test('quarterly is a three-month interval', () => {
  const out = run(
    { freq: 'monthly', interval: 3, byMonthDay: 15 },
    anchorAt(at(2026, 1, 15)),
    at(2026, 1, 1),
    at(2026, 12, 31),
  )
  assert.deepEqual(out, [
    '2026-01-15 09:00',
    '2026-04-15 09:00',
    '2026-07-15 09:00',
    '2026-10-15 09:00',
  ])
})

// --------------------------------------------------------------- yearly

test('yearly repeats on the same date', () => {
  const out = run(
    { freq: 'yearly', interval: 1, byMonth: 2, byMonthDay: 14 },
    anchorAt(at(2026, 3, 14)),
    at(2026, 1, 1),
    at(2029, 12, 31),
  )
  assert.deepEqual(out, [
    '2026-03-14 09:00',
    '2027-03-14 09:00',
    '2028-03-14 09:00',
    '2029-03-14 09:00',
  ])
})

test('a 29 February anniversary lands on the 28th in common years', () => {
  const out = run(
    { freq: 'yearly', interval: 1, byMonth: 1, byMonthDay: 29 },
    anchorAt(at(2028, 2, 29)),
    at(2028, 1, 1),
    at(2032, 12, 31),
  )
  assert.deepEqual(out, [
    '2028-02-29 09:00',
    '2029-02-28 09:00',
    '2030-02-28 09:00',
    '2031-02-28 09:00',
    '2032-02-29 09:00',
  ])
})

// ------------------------------------------------- nth weekday of the month

test('the nth weekday of the month tracks the real date, unlike a fortnight', () => {
  // A fortnightly rule anchored on 13 Oct would give 27 Oct, 10 Nov, 24 Nov —
  // drifting off the second Tuesday within one month. These are the real ones.
  const out = run(
    { freq: 'monthly', interval: 1, byWeekday: [2], setPos: 2 },
    anchorAt(at(2026, 10, 13), 19, 0),
    at(2026, 10, 1),
    at(2027, 2, 28),
  )
  assert.deepEqual(out, [
    '2026-10-13 19:00',
    '2026-11-10 19:00',
    '2026-12-08 19:00',
    '2027-01-12 19:00',
    '2027-02-09 19:00',
  ])
})

test('the last weekday of the month', () => {
  const out = run(
    { freq: 'monthly', interval: 1, byWeekday: [5], setPos: -1 },
    anchorAt(at(2026, 1, 30)),
    at(2026, 1, 1),
    at(2026, 4, 30),
  )
  assert.deepEqual(out, [
    '2026-01-30 09:00',
    '2026-02-27 09:00',
    '2026-03-27 09:00',
    '2026-04-24 09:00',
  ])
})

test('a fifth weekday that does not exist falls back to the fourth', () => {
  // February 2026 has only four Sundays, so a "fifth Sunday" rule still fires.
  const out = run(
    { freq: 'monthly', interval: 1, byWeekday: [0], setPos: 4 },
    anchorAt(at(2026, 1, 25)),
    at(2026, 1, 1),
    at(2026, 3, 31),
  )
  assert.deepEqual(out, ['2026-01-25 09:00', '2026-02-22 09:00', '2026-03-22 09:00'])
})

// ------------------------------------------------------------ boundaries

test('a window later than the start still returns the right occurrences', () => {
  const out = run(
    { freq: 'weekly', interval: 1, byWeekday: [2] },
    anchorAt(at(2026, 1, 6)),
    at(2026, 3, 1),
    at(2026, 3, 31),
  )
  assert.deepEqual(out, [
    '2026-03-03 09:00',
    '2026-03-10 09:00',
    '2026-03-17 09:00',
    '2026-03-24 09:00',
    '2026-03-31 09:00',
  ])
})

test('count is honoured from the start, not from the query window', () => {
  // Five occurrences total, starting 6 January. A March window must be empty,
  // because the series was already exhausted in January and February.
  const rule: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [2], count: 5 }
  const anchor = anchorAt(at(2026, 1, 6))

  assert.deepEqual(run(rule, anchor, at(2026, 1, 1), at(2026, 12, 31)), [
    '2026-01-06 09:00',
    '2026-01-13 09:00',
    '2026-01-20 09:00',
    '2026-01-27 09:00',
    '2026-02-03 09:00',
  ])
  assert.deepEqual(run(rule, anchor, at(2026, 3, 1), at(2026, 12, 31)), [])
})

test('until is inclusive of the whole final day', () => {
  const out = run(
    { freq: 'daily', interval: 1, until: '2026-03-03' },
    anchorAt(at(2026, 3, 1), 23, 30),
    at(2026, 3, 1),
    at(2026, 12, 31),
  )
  assert.deepEqual(out, ['2026-03-01 23:30', '2026-03-02 23:30', '2026-03-03 23:30'])
})

test('an unbounded daily rule over a decade does not hang or run away', () => {
  const out = expandRecurrence(
    { freq: 'daily', interval: 1 },
    anchorAt(at(2026, 1, 1)),
    { from: at(2026, 1, 1), to: at(2036, 1, 1) },
  )
  assert.ok(out.length > 0 && out.length <= 1000, `got ${out.length}`)
})

test('a window before the series begins returns nothing', () => {
  const out = run(
    { freq: 'weekly', interval: 1 },
    anchorAt(at(2026, 6, 1)),
    at(2026, 1, 1),
    at(2026, 5, 31),
  )
  assert.deepEqual(out, [])
})

// ----------------------------------------------------------- next / occursOn

test('nextOccurrence finds the following one and stops at the end of a series', () => {
  const rule: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [2] }
  const anchor = anchorAt(at(2026, 3, 3))

  assert.equal(fmt(nextOccurrence(rule, anchor, at(2026, 3, 3, 9, 0))!), '2026-03-10 09:00')
  assert.equal(nextOccurrence({ ...rule, until: '2026-03-05' }, anchor, at(2026, 3, 3, 9, 0)), null)
})

test('occursOn recognises a date in the series and rejects one outside it', () => {
  const rule: RecurrenceRule = { freq: 'weekly', interval: 1, byWeekday: [2] }
  const anchor = anchorAt(at(2026, 3, 3))

  assert.equal(occursOn(rule, anchor, at(2026, 3, 17)), true)
  assert.equal(occursOn(rule, anchor, at(2026, 3, 18)), false)
})

// -------------------------------------------------------------- describing

test('describeRecurrence reads back the way someone would say it', () => {
  const anchor = anchorAt(at(2026, 3, 3))
  const cases: Array<[RecurrenceRule, string]> = [
    [{ freq: 'daily', interval: 1 }, 'Every day'],
    [{ freq: 'daily', interval: 2 }, 'Every other day'],
    [{ freq: 'daily', interval: 3 }, 'Every 3 days'],
    [{ freq: 'weekly', interval: 1, byWeekday: [2] }, 'Every Tuesday'],
    [{ freq: 'weekly', interval: 2, byWeekday: [5] }, 'Every other Friday'],
    [{ freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }, 'Every Monday, Wednesday and Friday'],
    [{ freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] }, 'Every weekday'],
    [{ freq: 'monthly', interval: 1, byMonthDay: 1 }, 'Every month on the 1st'],
    [{ freq: 'monthly', interval: 3, byMonthDay: 22 }, 'Every 3 months on the 22nd'],
    [{ freq: 'yearly', interval: 1, byMonthDay: 14 }, 'Every year on the 14th'],
    [{ freq: 'monthly', interval: 1, byMonthDay: 31 }, 'Every month on the last day'],
    [
      { freq: 'monthly', interval: 1, byWeekday: [2], setPos: 2 },
      'Every month, the 2nd Tuesday',
    ],
    [{ freq: 'weekly', interval: 1, byWeekday: [2], count: 6 }, 'Every Tuesday, 6 times'],
  ]
  for (const [rule, expected] of cases) {
    assert.equal(describeRecurrence(rule, anchor), expected, JSON.stringify(rule))
  }
})

test('ordinal handles the teens and the twenties', () => {
  const got = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinal)
  assert.deepEqual(got, [
    '1st', '2nd', '3rd', '4th',
    '11th', '12th', '13th',
    '21st', '22nd', '23rd',
    '30th', '31st',
  ])
})
