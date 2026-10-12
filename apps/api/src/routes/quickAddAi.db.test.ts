import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The AI's part in the capture box: only for lines the rules were unsure of,
 * never per keystroke, the same reading for preview and save, and the rules'
 * reading whenever the AI is off, over its allowance, or says something that
 * cannot be used. No test here calls the network: the reader is a fake.
 */

let h: Harness
let me: Seeded
let quick: typeof import('./quickAdd.ts')
let ai: typeof import('../services/captureAi.ts')
let env: typeof import('../env.ts')['env']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** What the fake model was asked, line by line. */
let asked: string[] = []

/** Canned readings, keyed by line, dated from the moment it is asked. */
function fake(text: string, now: Date): Promise<unknown> {
  asked.push(text)
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
  const blank = { date: null, time: null, partOfDay: null, endDate: null, repeat: null, place: null, person: null, planKind: 'task', question: null, choices: [], assumptions: [] }
  const readings: Record<string, unknown> = {
    'sort the car thing': { ...blank, kind: 'ask', title: 'Car service', question: 'When should the car be sorted?', choices: ['tomorrow 10am', 'friday 5pm'] },
    'mom ko sham ko call karna hai': { ...blank, kind: 'plan', title: 'Call mom', date: ymd(now), partOfDay: 'evening', planKind: 'callback' },
    'papa ki dawai lana kal': { ...blank, kind: 'plan', title: 'Get dad’s medicine', date: tomorrow, time: '11:30', planKind: 'task' },
    'sabzi lana har sunday': { ...blank, kind: 'repeat', title: 'Buy vegetables', time: '10:00', repeat: { freq: 'weekly', interval: 1, weekdays: [0], monthDay: null } },
    'something odd': { nonsense: true },
    'meeting yesterday': { ...blank, kind: 'plan', title: 'Meeting', date: '2020-01-01', time: '10:00' },
  }
  return Promise.resolve(readings[text] ?? { ...blank, kind: 'not_a_plan', title: '' })
}

before(async () => {
  h = await createTestDb('quick_ai')
  process.env.DATABASE_URL = h.url
  quick = await import('./quickAdd.ts')
  ai = await import('../services/captureAi.ts')
  env = (await import('../env.ts')).env
  // A developer's own key in .env must never make these tests call out.
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'quick-ai@test.local')
})

beforeEach(() => {
  asked = []
  env.captureAiDailyLimit = 40
  ai.setCaptureAiForTest(fake)
})

after(async () => {
  ai.setCaptureAiForTest(null)
  await h.close()
})

const read = (text: string, mode: 'preview' | 'careful' | 'save') => quick.readForTest(me.userId, me.orgId, text, mode)

test('with the AI off, every line reads exactly as the rules read it', async () => {
  ai.setCaptureAiForTest(null)
  const plan = await read('sort the car thing', 'careful')
  assert.equal(plan.readBy, 'rules')
  assert.equal(plan.canReadCarefully, undefined, 'nothing to offer')
  assert.deepEqual(asked, [])
})

test('a sure line never goes to the AI', async () => {
  for (const line of ['call mom tonight at 9', '₹450 cab to office', 'gym every mon wed fri 7am', 'flight to Bangalore on 25 Oct 6am']) {
    const plan = await read(line, 'careful')
    assert.equal(plan.readBy, 'rules', line)
  }
  assert.deepEqual(asked, [])
})

test('typing previews never wait on the AI; a pause reads carefully', async () => {
  const typing = await read('sort the car thing', 'preview')
  assert.equal(typing.readBy, 'rules')
  assert.equal(typing.canReadCarefully, true, 'the screen is told a better reading is possible')
  assert.deepEqual(asked, [], 'no call while typing')

  const careful = await read('sort the car thing', 'careful')
  assert.equal(careful.readBy, 'ai')
  assert.equal(careful.kind, 'needsTime', 'too vague to plan: a question, not a guess')
  assert.equal(careful.question, 'When should the car be sorted?')
  assert.deepEqual(careful.choices.map((c) => c.line), ['sort the car thing tomorrow 10am', 'sort the car thing friday 5pm'])
  assert.equal(asked.length, 1)
})

test('save uses the reading the preview showed, without asking again', async () => {
  const shown = await read('mom ko sham ko call karna hai', 'careful')
  assert.equal(shown.readBy, 'ai')
  assert.equal(shown.kind, 'commitment')
  assert.equal(shown.title, 'Call mom')
  assert.equal(shown.preferredWindow, 'evening')
  assert.equal(shown.commitmentKind, 'callback')
  assert.ok(shown.assumptions.some((a) => /AI/.test(a)), 'it says who read it')

  const saved = await read('mom ko sham ko call karna hai', 'save')
  assert.equal(saved.dueAt, shown.dueAt)
  assert.equal(saved.title, shown.title)
  assert.equal(asked.length, 1, 'one call, for preview and save together')
})

test('save with no careful preview keeps what the person saw: the rules', async () => {
  const plan = await read('papa ki dawai lana kal', 'save')
  assert.equal(plan.readBy, 'rules')
  assert.deepEqual(asked, [])
})

test('Hindi left in a title reads in plain words, and a Hinglish repeat as a repeat', async () => {
  const medicine = await read('papa ki dawai lana kal', 'careful')
  assert.equal(medicine.readBy, 'ai')
  const due = new Date(medicine.dueAt!)
  assert.equal(`${pad(due.getHours())}:${pad(due.getMinutes())}`, '11:30')
  assert.equal(medicine.flexibility, 'fixed')
  assert.equal(medicine.title, 'Get dad’s medicine', 'Hindi left in the title went for a careful reading')

  const veg = await read('sabzi lana har sunday', 'careful')
  assert.equal(veg.readBy, 'ai')
  assert.equal(veg.kind, 'recurrence')
  assert.deepEqual(veg.rule, { freq: 'weekly', interval: 1, byWeekday: [0] })
  assert.equal(veg.hour, 10)
  assert.equal(new Date(`${veg.startsOn}T00:00:00`).getDay(), 0, 'starts on a Sunday')
})

test('a reading that cannot be used leaves the rules’ reading standing', async () => {
  for (const line of ['something odd', 'meeting yesterday']) {
    const plan = await read(line, 'careful')
    assert.equal(plan.readBy, 'rules', `${line}: malformed or in the past`)
  }
})

test('each person has a daily allowance, after which the rules read alone', async () => {
  env.captureAiDailyLimit = 1
  ai.setCaptureAiForTest(fake)
  assert.equal((await read('sort the car thing', 'careful')).readBy, 'ai')
  assert.equal((await read('papa ki dawai lana kal', 'careful')).readBy, 'rules', 'over the allowance')
  assert.equal(asked.length, 1)
})

test('what the model says is checked before it is used', () => {
  assert.equal(ai.sanitiseReading(null), null)
  assert.equal(ai.sanitiseReading({ kind: 'launch', title: 'x' }), null, 'unknown kind')
  assert.equal(ai.sanitiseReading({ kind: 'plan', title: '' }), null, 'no title')
  assert.equal(ai.sanitiseReading({ kind: 'repeat', title: 'gym', repeat: null }), null, 'a repeat with no rule')
  const r = ai.sanitiseReading({
    kind: 'plan',
    title: 'Call Ravi',
    date: '2026-13-45x',
    time: '25:99',
    partOfDay: 'teatime',
    planKind: 'party',
    choices: ['a'],
    assumptions: ['x', 'y', 'z'],
  })!
  assert.equal(r.date, null, 'a malformed date is dropped')
  assert.equal(r.time, null, 'an impossible time is dropped')
  assert.equal(r.partOfDay, null)
  assert.equal(r.planKind, 'task')
  assert.deepEqual(r.choices, [], 'choices only come with a question')
  assert.equal(r.assumptions.length, 2)
})
