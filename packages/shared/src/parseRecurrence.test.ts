import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRecurrence, stripRecurrence } from './parseRecurrence.ts'
import type { RecurrenceRule } from './recurrence.ts'

const NOW = new Date(2026, 8, 29, 10, 0) // Tue 29 Sep 2026

function rule(input: string): RecurrenceRule | null {
  return parseRecurrence(input, NOW)?.rule ?? null
}

function expect(input: string, want: Partial<RecurrenceRule>) {
  const got = rule(input)
  assert.ok(got, `"${input}" was not understood at all`)
  for (const [key, value] of Object.entries(want)) {
    assert.deepEqual(
      got[key as keyof RecurrenceRule],
      value,
      `"${input}" -> ${key} was ${JSON.stringify(got[key as keyof RecurrenceRule])}, wanted ${JSON.stringify(value)}`,
    )
  }
}

// ----------------------------------------------------------------- weekly

test('a named weekday becomes a weekly rule', () => {
  expect('standup every Tuesday at 10am', { freq: 'weekly', interval: 1, byWeekday: [2] })
  expect('every monday', { freq: 'weekly', interval: 1, byWeekday: [1] })
  expect('call mom every sunday evening', { freq: 'weekly', interval: 1, byWeekday: [0] })
})

test('short weekday forms work', () => {
  expect('every tue', { freq: 'weekly', byWeekday: [2] })
  expect('every thurs', { freq: 'weekly', byWeekday: [4] })
  expect('every weds', { freq: 'weekly', byWeekday: [3] })
})

test('a run of days written with nothing but spaces', () => {
  // How it actually gets typed, at least as often as "mon, wed and fri".
  expect('team sync every mon wed fri at 10', { freq: 'weekly', byWeekday: [1, 3, 5] })
  expect('gym every tue thu sat', { freq: 'weekly', byWeekday: [2, 4, 6] })
})

test('several weekdays in one phrase', () => {
  expect('gym every monday and wednesday', { freq: 'weekly', byWeekday: [1, 3] })
  expect('every mon, wed and fri', { freq: 'weekly', byWeekday: [1, 3, 5] })
  expect('every tuesday/thursday', { freq: 'weekly', byWeekday: [2, 4] })
})

test('the plural alone implies a repeat', () => {
  expect('gym on tuesdays', { freq: 'weekly', byWeekday: [2] })
  expect('yoga on mondays and thursdays', { freq: 'weekly', byWeekday: [1, 4] })
})

test('every other, and numeric week intervals', () => {
  expect('every other tuesday', { freq: 'weekly', interval: 2, byWeekday: [2] })
  expect('every 2 weeks on friday', { freq: 'weekly', interval: 2, byWeekday: [5] })
  expect('team sync every 3 weeks', { freq: 'weekly', interval: 3 })
  expect('fortnightly review', { freq: 'weekly', interval: 2 })
})

test('weekday runs', () => {
  expect('standup every weekday', { freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] })
  expect('take the tablet on weekdays', { freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] })
})

// ------------------------------------------------------------------ daily

test('daily phrasings', () => {
  expect('walk every day', { freq: 'daily', interval: 1 })
  expect('daily standup', { freq: 'daily', interval: 1 })
  expect('water the plants every 3 days', { freq: 'daily', interval: 3 })
  expect('every other day', { freq: 'daily', interval: 2 })
})

// ---------------------------------------------------------------- monthly

test('monthly phrasings', () => {
  expect('pay rent on the 1st of every month', { freq: 'monthly', interval: 1, byMonthDay: 1 })
  expect('15th of each month', { freq: 'monthly', byMonthDay: 15 })
  expect('every month on the 5th', { freq: 'monthly', interval: 1, byMonthDay: 5 })
  expect('monthly budget review', { freq: 'monthly', interval: 1 })
  expect('every 2 months', { freq: 'monthly', interval: 2 })
  expect('quarterly tax filing', { freq: 'monthly', interval: 3 })
})

test('the nth weekday of the month is not a fortnightly rule', () => {
  // The dangerous one: "every second tuesday" read as "every other tuesday"
  // looks right for a month and then drifts off the real date forever.
  expect('every second tuesday of the month', {
    freq: 'monthly',
    interval: 1,
    byWeekday: [2],
    setPos: 2,
  })
  expect('club meeting on the first monday of every month', {
    freq: 'monthly',
    byWeekday: [1],
    setPos: 1,
  })
  expect('last friday of the month drinks', { freq: 'monthly', byWeekday: [5], setPos: -1 })
})

test('the last day of the month is stored as a clamping 31st', () => {
  expect('salary comes on the last day of every month', {
    freq: 'monthly',
    interval: 1,
    byMonthDay: 31,
  })
})

test('a part of the day implies daily, and survives for parseWhen to read', () => {
  expect('every morning walk', { freq: 'daily', interval: 1 })
  expect('every evening call mom', { freq: 'daily', interval: 1 })

  // "morning" must stay in the title text, because it is what later tells the
  // planner which window to use.
  const parsed = parseRecurrence('every morning walk', NOW)!
  assert.equal(stripRecurrence('every morning walk', parsed), 'morning walk')
})

test('"alternate" means the same as "other"', () => {
  expect('every alternate day', { freq: 'daily', interval: 2 })
  expect('every alternate friday', { freq: 'weekly', interval: 2, byWeekday: [5] })
})

// ----------------------------------------------------------------- yearly

test('yearly phrasings', () => {
  expect('every year', { freq: 'yearly', interval: 1 })
  expect('annually', { freq: 'yearly', interval: 1 })
  expect("mom's birthday every year on 14 March", {
    freq: 'yearly',
    byMonth: 2,
    byMonthDay: 14,
  })
  expect('insurance renewal yearly on March 14', { freq: 'yearly', byMonth: 2, byMonthDay: 14 })
})

// -------------------------------------------------------------- how it ends

test('a count ends the series', () => {
  expect('physio every tuesday 6 times', { freq: 'weekly', byWeekday: [2], count: 6 })
  expect('every day for 10 times', { freq: 'daily', count: 10 })
})

test('a span ends the series', () => {
  // NOW is 29 Sep 2026, so eight weeks out is 24 Nov.
  expect('every monday for 8 weeks', { freq: 'weekly', byWeekday: [1], until: '2026-11-24' })
  expect('every day for 3 days', { freq: 'daily', until: '2026-10-02' })
})

test('an until date ends the series', () => {
  expect('every tuesday until 15 December', { freq: 'weekly', byWeekday: [2], until: '2026-12-15' })
  expect('daily till 5th October', { freq: 'daily', until: '2026-10-05' })
})

test('an interval is not mistaken for a count', () => {
  const got = rule('every 2 weeks')
  assert.equal(got?.interval, 2)
  assert.equal(got?.count, undefined)
})

// ---------------------------------------------------------- not a recurrence

test('one-off plans are left alone', () => {
  const oneOffs = [
    'dentist on friday at 6pm',
    'meeting tomorrow at 3',
    'call ramesh next tuesday',
    'buy milk',
    'flight to mumbai on 12 october',
    'lunch with priya this weekend',
  ]
  for (const text of oneOffs) {
    assert.equal(rule(text), null, `"${text}" should not be a repeating rule`)
  }
})

// ---------------------------------------------------------------- the title

test('the recurrence phrase is cut out of the title', () => {
  const cases: Array<[string, string]> = [
    ['standup every tuesday', 'standup'],
    ['gym every monday and wednesday', 'gym'],
    ['pay rent on the 1st of every month', 'pay rent'],
    ['water the plants every 3 days', 'water the plants'],
    ['physio every tuesday 6 times', 'physio'],
    ['team sync every other friday until 15 December', 'team sync'],
  ]
  for (const [input, want] of cases) {
    const parsed = parseRecurrence(input, NOW)
    assert.ok(parsed, `"${input}" was not understood`)
    assert.equal(stripRecurrence(input, parsed), want, `title from "${input}"`)
  }
})
