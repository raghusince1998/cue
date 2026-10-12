import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * How well the capture box reads the lines people actually type: personal,
 * work, travel, money, and the vague ones. Each line says what a careful
 * assistant would do with it.
 *
 * This is the accuracy bar. A change that makes a line here read worse fails
 * the build. A line marked `todo` is one the app does not get right yet — it
 * runs, it is counted, and it does not fail the build — so the score at the
 * end is an honest one. Fixing one means deleting its `todo`.
 */

let h: Harness
let me: Seeded
let quick: typeof import('./quickAdd.ts')

/** Monday 12 October 2026, 4:35pm: every line is read as if typed then. */
const NOW = new Date(2026, 9, 12, 16, 35)

const pad = (n: number) => String(n).padStart(2, '0')
const local = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

interface Expect {
  kind: string
  title?: string
  /** Local "YYYY-MM-DD HH:MM". */
  due?: string
  /** Local "YYYY-MM-DD", when the hour is not the point. */
  day?: string
  /** A repeat's time of day, "HH:MM". */
  at?: string
  /** A repeat's further times of day. */
  also?: string[]
  rule?: Record<string, unknown>
  place?: string
  booking?: string
  trip?: [string, string]
  window?: string
  /** Not right yet: why, and which phase of the roadmap fixes it. */
  todo?: string
}

const LINES: [string, Expect][] = [
  // ---------------------------------------------------------------- personal
  ['call mom tonight at 9', { kind: 'commitment', title: 'call mom', due: '2026-10-12 21:00' }],
  ['dentist appointment next Tuesday 11am', { kind: 'commitment', due: '2026-10-20 11:00' }],
  ['pay electricity bill by 15th', { kind: 'bill', title: 'Electricity bill' }],
  ['buy milk and eggs on the way home', { kind: 'commitment', day: '2026-10-12' }],
  ['gym every mon wed fri 7am', { kind: 'recurrence', title: 'gym', at: '07:00', rule: { freq: 'weekly', byWeekday: [1, 3, 5] } }],
  ["Riya's birthday on 3 Nov", { kind: 'recurrence', rule: { freq: 'yearly', byMonth: 10, byMonthDay: 3 } }],
  ['renew passport before December', { kind: 'commitment', title: 'renew passport', due: '2026-11-30 09:00' }],
  ['take medicine at 9am and 9pm every day', { kind: 'recurrence', title: 'take medicine', at: '09:00', also: ['21:00'], rule: { freq: 'daily' } }],
  ['pick up kids from school at 3:30 every weekday', { kind: 'recurrence', at: '15:30', rule: { byWeekday: [1, 2, 3, 4, 5] } }],
  ['kal subah 8 baje doodh lena', { kind: 'commitment', due: '2026-10-13 08:00' }],
  [
    'mom ko sham ko call karna hai',
    { kind: 'commitment', day: '2026-10-12', window: 'evening', todo: '"sham ko" is evening here but a name elsewhere: the AI reading' },
  ],
  ['remind me in 30 minutes to check the oven', { kind: 'commitment', due: '2026-10-12 17:05' }],
  ['dinner at 8:30 with Priya', { kind: 'commitment', due: '2026-10-12 20:30' }],
  ['yoga at 6:30 tomorrow', { kind: 'commitment', due: '2026-10-13 06:30' }],

  // -------------------------------------------------------------------- work
  ['send the Q3 report to Ankit by Friday EOD', { kind: 'commitment', due: '2026-10-16 17:00' }],
  ['1:1 with manager every Thursday 4pm', { kind: 'recurrence', at: '16:00', rule: { freq: 'weekly', byWeekday: [4] } }],
  ['follow up with Priya from HR about the offer letter in 2 days', { kind: 'commitment', due: '2026-10-14 09:00' }],
  ['interview with Google on 20 Oct 2pm', { kind: 'commitment', due: '2026-10-20 14:00' }],
  ['applied to Infosys for data analyst', { kind: 'tracker', title: 'Infosys · Data analyst' }],
  ['submit timesheet every Friday', { kind: 'recurrence', rule: { freq: 'weekly', byWeekday: [5] } }],
  ['client call with Acme tomorrow 10:30', { kind: 'commitment', due: '2026-10-13 10:30' }],
  ['review the PR before standup', { kind: 'needsTime', title: 'review the PR' }],
  ['review the PR before standup tomorrow 10am', { kind: 'commitment', due: '2026-10-13 10:00' }],
  ["prepare slides for Monday's board meeting", { kind: 'commitment', title: "prepare slides for Monday's board meeting", due: '2026-10-16 17:00' }],
  ['team lunch last Friday of every month', { kind: 'recurrence', at: '13:00', rule: { freq: 'monthly', setPos: -1 } }],
  ['next week sometime finish tax filing', { kind: 'commitment', day: '2026-10-19' }],
  ['submit ITR before 31 July', { kind: 'commitment', title: 'submit ITR', due: '2027-07-30 09:00' }],
  ['pay fees by month end', { kind: 'commitment', due: '2026-10-31 09:00' }],

  // ------------------------------------------------------------------ travel
  ['flight to Bangalore on 25 Oct 6am', { kind: 'commitment', booking: 'flight', title: 'Flight to Bengaluru', due: '2026-10-25 06:00' }],
  ['trip to Goa from 1 to 5 Nov', { kind: 'trip', place: 'Goa', trip: ['2026-11-01', '2026-11-05'] }],
  ['when I go to Mumbai meet Rahul', { kind: 'intention', place: 'Mumbai', title: 'meet Rahul' }],
  ['book cab to airport at 4am tomorrow', { kind: 'commitment', due: '2026-10-13 04:00' }],
  ['pack charger and passport for the Delhi trip', { kind: 'intention', place: 'Delhi', title: 'pack charger and passport' }],
  ['hotel check-in Taj Jaipur 10 Nov', { kind: 'commitment', booking: 'hotel', title: 'Check in: Taj Jaipur', due: '2026-11-10 14:00' }],
  ['train 12127 to Pune on Friday 7:10am', { kind: 'commitment', booking: 'train', due: '2026-10-16 07:10' }],

  // ------------------------------------------------------------------- money
  ['₹450 cab to office', { kind: 'expense', title: 'cab to office' }],
  ['Ravi owes me 500 for dinner', { kind: 'owed' }],
  ['rent 15000 on the 1st every month', { kind: 'bill', title: 'Rent' }],
  ['Netflix renews on 18th', { kind: 'bill', title: 'Netflix' }],

  // ------------------------------------------------- vague: ask, do not guess
  ['something about the bank', { kind: 'needsTime' }],
  ['lunch at 1', { kind: 'commitment', due: '2026-10-13 13:00' }],
  ['meeting tomorrow', { kind: 'needsTime', todo: 'a meeting with no time or person: ask (phase 2)' }],
  ['call him later', { kind: 'needsPerson', todo: '"him" is nobody yet: ask who (phase 2)' }],
  ['doctor', { kind: 'needsTime', todo: 'one word: ask what and when (phase 2)' }],
]

const score = { right: 0, total: 0, todoRight: 0, todo: 0 }

before(async () => {
  h = await createTestDb('capture_accuracy')
  process.env.DATABASE_URL = h.url
  quick = await import('./quickAdd.ts')
  me = await seedUser(h.sql, 'accuracy@test.local')
})

after(async () => {
  const done = score.total - score.todo
  console.log(
    `capture accuracy: ${score.right}/${score.total} read right` +
      ` (${score.right - score.todoRight}/${done} of the lines it must get right, ${score.todo} still to do)`,
  )
  await h.close()
})

for (const [line, expect] of LINES) {
  test(line, expect.todo ? { todo: expect.todo } : {}, async () => {
    score.total++
    if (expect.todo) score.todo++
    const plan = await quick.interpret(me.userId, me.orgId, line, NOW)

    assert.equal(plan.kind, expect.kind, `kind (${plan.problem ?? plan.summary})`)
    if (expect.title !== undefined) assert.equal(plan.title, expect.title, 'title')
    if (expect.due) assert.equal(plan.dueAt && local(new Date(plan.dueAt)), expect.due, 'when')
    if (expect.day) assert.equal(plan.dueAt && local(new Date(plan.dueAt)).slice(0, 10), expect.day, 'day')
    if (expect.at) assert.equal(`${pad(plan.hour ?? -1)}:${pad(plan.minute ?? -1)}`, expect.at, 'time of day')
    if (expect.also) assert.deepEqual(plan.alsoAt.map((t) => `${pad(t.hour)}:${pad(t.minute)}`), expect.also, 'further times')
    if (expect.rule) {
      for (const [key, value] of Object.entries(expect.rule)) {
        assert.deepEqual((plan.rule as Record<string, unknown> | null)?.[key], value, `rule.${key}`)
      }
    }
    if (expect.place) assert.equal(plan.placeLabel, expect.place, 'place')
    if (expect.booking) assert.equal(plan.booking?.type, expect.booking, 'booking')
    if (expect.trip) assert.deepEqual([plan.startsOn, plan.endsOn], expect.trip, 'trip dates')
    if (expect.window) assert.equal(plan.preferredWindow, expect.window, 'part of the day')

    score.right++
    if (expect.todo) score.todoRight++
  })
}
