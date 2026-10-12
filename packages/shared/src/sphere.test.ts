import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WORK_HOURS, describeWorkHours, isWorkTime, nextWorkBoundary, sphereOf } from './sphere.ts'

test('work and personal, from the words a plan uses', () => {
  for (const title of ['Client call with Acme', 'send the Q3 report to Ankit', 'Daily standup', '1:1 with manager', 'Interview with Google', 'review the PR', 'submit timesheet']) {
    assert.equal(sphereOf(title), 'work', title)
  }
  for (const title of ['call mom', 'dentist appointment', 'gym', 'sabzi lana', "Riya's birthday", 'pick up kids from school', 'pay electricity bill', 'renew passport', 'Take evening medicines', 'Book the annual health check-up']) {
    assert.equal(sphereOf(title), 'personal', title)
  }
})

test('a plan that says neither is left unsorted, not guessed', () => {
  assert.equal(sphereOf('call Ravi'), null)
  assert.equal(sphereOf('lunch'), null)
  assert.equal(sphereOf('team lunch on Friday with family'), null, 'one of each: it could be either')
})

test('what a plan is says something too', () => {
  assert.equal(sphereOf('Flight to Goa', { booking: true }), 'personal')
  assert.equal(sphereOf('Flight to Pune for client meeting', { booking: true }), 'work')
  assert.equal(sphereOf('Priya · Designer', { board: 'hiring' }), 'work')
  assert.equal(sphereOf('Deep work', { kind: 'focus' }), 'work')
})

test('the working day, in the person’s own zone', () => {
  const tz = 'Asia/Kolkata'
  // Monday 12 Oct 2026: 11:00 IST is 05:30 UTC.
  const monMorning = new Date(Date.UTC(2026, 9, 12, 5, 30))
  assert.equal(isWorkTime(monMorning, tz, DEFAULT_WORK_HOURS), true)
  // 19:00 IST.
  const monEvening = new Date(Date.UTC(2026, 9, 12, 13, 30))
  assert.equal(isWorkTime(monEvening, tz, DEFAULT_WORK_HOURS), false)
  // Saturday 11:00 IST.
  assert.equal(isWorkTime(new Date(Date.UTC(2026, 9, 17, 5, 30)), tz, DEFAULT_WORK_HOURS), false)
})

test('when the stretch changes: end of the working day, or the start of the next', () => {
  const tz = 'Asia/Kolkata'
  const iso = (d: Date | null) => d?.toISOString()
  // Monday 11:00 IST → 18:00 IST, which is 12:30 UTC.
  assert.equal(iso(nextWorkBoundary(new Date(Date.UTC(2026, 9, 12, 5, 30)), tz, DEFAULT_WORK_HOURS)), '2026-10-12T12:30:00.000Z')
  // Monday 19:00 IST → Tuesday 09:00 IST.
  assert.equal(iso(nextWorkBoundary(new Date(Date.UTC(2026, 9, 12, 13, 30)), tz, DEFAULT_WORK_HOURS)), '2026-10-13T03:30:00.000Z')
  // Friday 19:00 IST → Monday 09:00 IST: the weekend is not working days.
  assert.equal(iso(nextWorkBoundary(new Date(Date.UTC(2026, 9, 16, 13, 30)), tz, DEFAULT_WORK_HOURS)), '2026-10-19T03:30:00.000Z')
  // Monday 07:00 IST → 09:00 the same day.
  assert.equal(iso(nextWorkBoundary(new Date(Date.UTC(2026, 9, 12, 1, 30)), tz, DEFAULT_WORK_HOURS)), '2026-10-12T03:30:00.000Z')
  assert.equal(nextWorkBoundary(new Date(), tz, { days: [], start: 9, end: 18 }), null)
})

test('the working week, said plainly', () => {
  assert.equal(describeWorkHours(DEFAULT_WORK_HOURS), 'Mon–Fri, 9 am – 6 pm')
  assert.equal(describeWorkHours({ days: [1, 3, 5], start: 10, end: 19 }), 'Mon, Wed, Fri, 10 am – 7 pm')
  assert.equal(describeWorkHours({ days: [1, 2, 3, 4, 5, 6], start: 8, end: 12 }), 'Mon–Sat, 8 am – 12 pm')
})
