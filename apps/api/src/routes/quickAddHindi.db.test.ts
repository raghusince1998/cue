import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Quick add, for someone who reads Cue in Hindi: what it understood, what it
 * assumed, what it asks and what it offers come back in Hindi. The title stays
 * what they typed, a tap still sets a line the date reader reads, and someone
 * who reads English hears exactly what they always did.
 */

let h: Harness
let hindi: Seeded
let english: Seeded
let app: FastifyInstance
let hiToken: string
let enToken: string

const DEVANAGARI = /[ऀ-ॿ]/

const inDays = (n: number) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
}
const dayMonth = (d: Date) => `${d.getDate()} ${d.toLocaleDateString('en-IN', { month: 'short' })}`

interface Plan {
  kind: string
  title: string
  summary: string
  question: string | null
  problem: string | null
  choices: { label: string; line: string }[]
  assumptions: string[]
  suggestions: { id: string; text: string; action: string }[]
  id?: string
}

async function call(token: string, path: string, body: Record<string, unknown>) {
  const res = await app.inject({ method: 'POST', url: path, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Plan }
}
const previewHi = async (text: string) => (await call(hiToken, '/quick/preview', { text })).body
const previewEn = async (text: string) => (await call(enToken, '/quick/preview', { text })).body

before(async () => {
  h = await createTestDb('quick_hindi')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  hindi = await seedUser(h.sql, 'hindi@test.local')
  english = await seedUser(h.sql, 'english@test.local')
  await h.sql`update users set language = 'hi' where id = ${hindi.userId}`
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.ready()
  hiToken = app.jwt.sign({ sub: hindi.userId, orgId: hindi.orgId, email: 'hindi@test.local' })
  enToken = app.jwt.sign({ sub: english.userId, orgId: english.orgId, email: 'english@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('a bill reads back in Hindi, and in English for someone who reads English', async () => {
  const line = 'rent ₹15,000 on the 1st every month'
  const hi = await previewHi(line)
  assert.equal(hi.kind, 'bill')
  assert.equal(hi.title, 'Rent', 'the name stays as it was read')
  assert.match(hi.summary, /^Rent · ₹15,000 · .*(देय) · हर महीने$/)
  assert.deepEqual(hi.assumptions, ['हर बार, देय तारीख से 3 दिन पहले एक रिमाइंडर।'])

  const en = await previewEn(line)
  assert.match(en.summary, /^Rent · ₹15,000 · due .* · every month$/)
  assert.deepEqual(en.assumptions, ['A reminder 3 days before, each time.'])
})

test('a repeat is described in Hindi, from a date in Hindi', async () => {
  const plan = await previewHi('gym every monday 7am')
  assert.equal(plan.kind, 'recurrence')
  assert.match(plan.summary, /^gym — हर सोमवार, .+ से$/)
})

test('a plan with no time says what it filed it for, in Hindi', async () => {
  const plan = await previewHi('buy milk')
  assert.equal(plan.kind, 'commitment')
  assert.equal(plan.title, 'buy milk')
  assert.match(plan.assumptions[0]!, /^कोई समय नहीं दिया, इसलिए इसे बिना तय समय के (आज सुबह|आज दोपहर|आज शाम|कल सुबह) के लिए रखा है।$/)
  assert.match(plan.summary, /^buy milk — (आज सुबह|आज दोपहर|आज शाम|कल सुबह), जब सुविधा हो$/)
})

test('a date in a summary has Hindi day and month names', async () => {
  const day = inDays(9)
  const plan = await previewHi(`submit the report on ${dayMonth(day)} 4pm`)
  assert.equal(plan.kind, 'commitment')
  const month = day.toLocaleDateString('hi-IN', { month: 'short' })
  assert.ok(plan.summary.includes(month), `${plan.summary} has ${month}`)
})

test('money owed reads in Hindi', async () => {
  const plan = await previewHi('Ravi owes me ₹500')
  assert.equal(plan.kind, 'owed')
  assert.equal(plan.summary, 'Ravi से ₹500')
})

test('a question is asked in Hindi, with chips in Hindi and lines the reader reads', async () => {
  const plan = await previewHi('doctor')
  assert.equal(plan.kind, 'needsTime')
  assert.ok(plan.question!.startsWith('“doctor” कब है?'), plan.question!)
  assert.ok(plan.choices.length > 0)
  for (const c of plan.choices) {
    assert.ok(DEVANAGARI.test(c.label), `chip in Hindi: ${c.label}`)
    assert.ok(/^doctor (today|tomorrow|on \d)/.test(c.line), `line in words the reader reads: ${c.line}`)
  }
  const picked = await previewHi(plan.choices[0]!.line)
  assert.equal(picked.kind, 'commitment')
})

test('a better plan is offered in Hindi', async () => {
  const plan = await previewHi(`submit visa documents before ${dayMonth(inDays(60))}`)
  const offer = plan.suggestions.find((s) => s.id === 'start-early')
  assert.ok(offer, 'offered')
  assert.equal(offer.text, 'पासपोर्ट और वीज़ा की अपॉइंटमेंट में हफ़्तों लग सकते हैं।')
  assert.match(offer.action, / को शुरू करने की याद दिलाएँ$/)
})

test('a line it cannot read says so in Hindi', async () => {
  const plan = await previewHi('tomorrow 5pm')
  assert.equal(plan.kind, 'unclear')
  assert.equal(plan.problem, 'समय तो मिल गया, पर यह किस काम के लिए है, यह नहीं।')
})

test('saving says what was saved in Hindi too', async () => {
  const saved = await call(hiToken, '/quick', { text: 'passport expires 12 march 2030' })
  assert.equal(saved.status, 201)
  assert.equal(saved.body.kind, 'bill')
  assert.match(saved.body.summary, /^Passport · .* में ख़त्म$/)
  assert.deepEqual(saved.body.assumptions, ['ख़त्म होने से एक महीना पहले एक रिमाइंडर।'])
  const [row] = await h.sql<{ name: string }[]>`select name from bills where id = ${saved.body.id!}`
  assert.equal(row!.name, 'Passport', 'what is stored is not translated')
})

test('a careful reading asks the AI for Hindi notes, and says who read it in Hindi', async () => {
  const ai = await import('../services/captureAi.ts')
  const langs: string[] = []
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  ai.setCaptureAiForTest((_text, _now, lang) => {
    langs.push(lang)
    return Promise.resolve({
      kind: 'plan', title: 'Pick up laundry', date: ymd, time: null, partOfDay: 'evening', endDate: null, repeat: null,
      place: null, person: null, planKind: 'task', question: null, choices: [], assumptions: ['शाम को, जब सुविधा हो।'],
    })
  })
  try {
    const plan = (await call(hiToken, '/quick/preview', { text: 'pick up laundry', careful: true })).body
    assert.deepEqual(langs, ['hi'], 'the reader was asked for Hindi')
    assert.equal(plan.title, 'Pick up laundry', 'the title stays as the AI wrote it')
    assert.deepEqual(plan.assumptions, ['शाम को, जब सुविधा हो।', 'आम नियम पक्के नहीं थे, इसलिए Cue के AI ने इसे ध्यान से पढ़ा।'])
  } finally {
    ai.setCaptureAiForTest(null)
  }
})
