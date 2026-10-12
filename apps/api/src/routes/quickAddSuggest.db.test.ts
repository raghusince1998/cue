import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The assistant's half of the capture box, through the real routes: asking
 * when a line is too vague to plan, with answers from the person's own day,
 * and suggesting a better plan — applied on save only when accepted.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const inDays = (n: number, hour = 9, minute = 0) => {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + n, hour, minute)
}

interface Plan {
  kind: string
  title: string
  dueAt: string | null
  question: string | null
  choices: { label: string; line: string }[]
  people: { id: string; name: string }[]
  personName: string | null
  suggestions: { id: string; text: string; action: string; warning?: boolean; moveTo?: string; extra?: { dueAt: string; title: string } }[]
  assumptions: string[]
  id?: string
  extras?: { kind: string; id: string }[]
}

async function call(path: string, body: Record<string, unknown>, method: 'POST' | 'DELETE' = 'POST') {
  const res = await app.inject({ method, url: path, payload: method === 'POST' ? body : undefined, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Plan & { plan?: Plan } }
}
const preview = async (text: string) => (await call('/quick/preview', { text })).body

before(async () => {
  h = await createTestDb('quick_suggest')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'suggest@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'suggest@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

// ------------------------------------------------------------------- asking

test('a meeting with no time asks what time, with the times free that day', async () => {
  // Busy 10–11 the day after tomorrow, so that hour is never offered.
  const day = inDays(2)
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, duration_minutes)
    values (${me.orgId}, ${me.userId}, 'Busy', 'meeting', ${inDays(2, 10)}, 60)`
  const plan = await preview(`meeting with the CA on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })}`)
  assert.equal(plan.kind, 'needsTime')
  assert.match(plan.question!, /What time/)
  assert.ok(plan.choices.length > 0, 'free times are offered')
  for (const c of plan.choices) assert.ok(!/\b10am\b/.test(c.line), `10am is taken: ${c.line}`)

  // Tapping one reads as a plan at that time.
  const picked = await preview(plan.choices[0]!.line)
  assert.equal(picked.kind, 'commitment', `${plan.choices[0]!.line} -> ${picked.kind}`)
  assert.equal(ymd(new Date(picked.dueAt!)), ymd(day))
})

test('one vague word asks when, with the next free times', async () => {
  const plan = await preview('doctor')
  assert.equal(plan.kind, 'needsTime')
  assert.equal(plan.question?.startsWith('When is “doctor”?'), true)
  assert.ok(plan.choices.length > 0)
  const picked = await preview(plan.choices[0]!.line)
  assert.equal(picked.kind, 'commitment', `${plan.choices[0]!.line} -> ${picked.kind}`)
})

test('"call him later" asks who, offering the people this account talks to', async () => {
  await h.sql`insert into contacts (org_id, name, last_contacted_at) values (${me.orgId}, 'Ravi Kumar', now() - interval '1 day')`
  await h.sql`insert into contacts (org_id, name, last_contacted_at) values (${me.orgId}, 'Anita Desai', now() - interval '10 days')`
  const plan = await preview('call him later')
  assert.equal(plan.kind, 'needsPerson')
  assert.equal(plan.question, 'Who is “him”?')
  assert.deepEqual(plan.choices.map((c) => c.label).slice(0, 2), ['Ravi Kumar', 'Anita Desai'], 'most recent first')
  assert.equal(plan.choices[0]!.line, 'call Ravi Kumar later')

  const named = await preview('call Ravi and tell him the price')
  assert.notEqual(named.kind, 'needsPerson', 'a name in the line is who "him" is')
})

test('an errand with no time is not interrogated', async () => {
  const plan = await preview('buy milk and eggs on the way home')
  assert.equal(plan.kind, 'commitment')
})

// -------------------------------------------------------------- suggesting

test('a far-off deadline offers a head start, and only adds it when accepted', async () => {
  const plan = await preview('renew passport before December')
  const offer = plan.suggestions.find((s) => s.id === 'start-early')
  assert.ok(offer, 'offered')
  assert.match(offer.text, /weeks/)
  const startOn = new Date(offer.extra!.dueAt)
  assert.ok((new Date(plan.dueAt!).getTime() - startOn.getTime()) / 86_400_000 >= 29, 'a month ahead for a passport')

  const plain = await call('/quick', { text: 'renew passport before December' })
  assert.equal(plain.status, 201)
  assert.deepEqual(plain.body.extras, [], 'not accepted, not added')

  const withStart = await call('/quick', { text: 'renew passport before December', accept: ['start-early'], allowConflict: true })
  assert.equal(withStart.status, 201)
  assert.equal(withStart.body.extras!.length, 1)
  const [row] = await h.sql<{ title: string; due_at: Date }[]>`select title, due_at from commitments where id = ${withStart.body.extras![0]!.id}`
  assert.equal(row!.title, 'Start: renew passport')
  assert.equal(ymd(row!.due_at), ymd(startOn))
})

test('an interview offers an hour to prepare the evening before', async () => {
  const day = inDays(5)
  const line = `interview with Infosys on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })} 11am`
  const plan = await preview(line)
  const prep = plan.suggestions.find((s) => s.id === 'prepare')
  assert.ok(prep, `offered for ${line}`)
  const at = new Date(prep.extra!.dueAt)
  assert.equal(ymd(at), ymd(inDays(4)))
  assert.equal(at.getHours(), 18)

  const saved = await call('/quick', { text: line, accept: ['prepare'], allowConflict: true })
  assert.equal(saved.status, 201)
  const [row] = await h.sql<{ title: string; kind: string }[]>`select title, kind from commitments where id = ${saved.body.extras![0]!.id}`
  assert.equal(row!.kind, 'focus')
  assert.match(row!.title, /^Prepare: /)

  // Undo takes it away too.
  for (const extra of saved.body.extras!) {
    assert.equal((await call(`/quick/${extra.kind}/${extra.id}`, {}, 'DELETE')).status, 200)
  }
})

test('a birthday offers a gift reminder the evening before, every year', async () => {
  const plan = await preview("Riya's birthday on 3 Nov")
  const gift = plan.suggestions.find((s) => s.id === 'gift')
  assert.ok(gift)
  const saved = await call('/quick', { text: "Riya's birthday on 3 Nov", accept: ['gift'] })
  assert.equal(saved.status, 201)
  const [row] = await h.sql<{ title: string; freq: string; by_month: number; by_month_day: number; hour: number }[]>`
    select title, freq, by_month, by_month_day, hour from recurrences where id = ${saved.body.extras![0]!.id}`
  assert.deepEqual({ ...row }, { title: "Gift or wishes: Riya's birthday", freq: 'yearly', by_month: 10, by_month_day: 2, hour: 19 })
})

test('an in-person plan on a day away warns, and moves when accepted', async () => {
  const from = inDays(20)
  const to = inDays(23)
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, 'Goa', ${ymd(from)}, ${ymd(to)})`
  const day = inDays(21)
  const line = `meeting with the builder on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })} 4pm`
  const plan = await preview(line)
  const warn = plan.suggestions.find((s) => s.id === 'move-after-trip')
  assert.ok(warn, `warned for ${line}`)
  assert.equal(warn.warning, true)
  assert.match(warn.text, /You’re in Goa/)
  const back = new Date(warn.moveTo!)
  assert.equal(ymd(back), ymd(inDays(24)), 'the day after the trip')
  assert.equal(back.getHours(), 16, 'same time')

  const remote = await preview(`video call with the builder on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })} 4pm`)
  assert.ok(!remote.suggestions.some((s) => s.id === 'move-after-trip'), 'a call can happen from anywhere')

  const saved = await call('/quick', { text: line, accept: ['move-after-trip'], allowConflict: true })
  assert.equal(saved.status, 201)
  const [row] = await h.sql<{ due_at: Date }[]>`select due_at from commitments where id = ${saved.body.id!}`
  assert.equal(ymd(row!.due_at), ymd(inDays(24)), 'saved on the day back')
})

test('a flight says when to leave, by the clock', async () => {
  const day = inDays(6)
  const plan = await preview(`flight to Goa on ${day.getDate()} ${day.toLocaleDateString('en-IN', { month: 'short' })} 7am`)
  assert.ok(plan.assumptions.some((a) => a.startsWith('A reminder at 4 am to leave for the airport')), plan.assumptions.join(' | '))
})
