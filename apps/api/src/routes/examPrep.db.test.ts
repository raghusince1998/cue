import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Preparing for an exam: a study plan as repeating plans that end the day
 * before the exam and stop when the exam does; mock scores, typed or added;
 * and, for someone who reads Hindi, the exam's plans in Hindi.
 */

let h: Harness
let me: Seeded
let hindi: Seeded
let app: FastifyInstance

before(async () => {
  h = await createTestDb('exam_prep')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { examRoutes } = await import('./exams.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { meRoutes } = await import('./me.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'prep@test.local')
  hindi = await seedUser(h.sql, 'hindi@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(examRoutes)
  await app.register(quickAddRoutes)
  await app.register(meRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const token = (who: Seeded, email: string) => app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
async function call(who: Seeded, email: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token(who, email)}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}
const ahead = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test('a study plan: each subject on its days, a mock on Sunday, until the day before the exam', async () => {
  const made = await call(me, 'prep@test.local', 'POST', '/exams', {
    examKey: 'ssc-cgl',
    name: 'SSC CGL',
    cycle: '2026',
    dates: [{ step: 'exam', on: ahead(40), round: 'tier1' }],
  })
  const id = made.body.id as string
  const plan = await call(me, 'prep@test.local', 'POST', `/exams/${id}/study-plan`, {
    subjects: ['Quant', 'Reasoning', 'English', 'GA'],
    days: [1, 2, 3, 4, 5, 6],
    at: '06:30',
    minutes: 90,
    mock: { day: 0, at: '10:00', minutes: 120 },
  })
  assert.equal(plan.status, 201)
  assert.deepEqual(
    plan.body.study.map((s: { title: string; weekdays: number[]; untilOn: string }) => [s.title, s.weekdays, s.untilOn]),
    [
      ['Study Quant: SSC CGL 2026', [1, 5], ahead(39)],
      ['Study Reasoning: SSC CGL 2026', [2, 6], ahead(39)],
      ['Study English: SSC CGL 2026', [3], ahead(39)],
      ['Study GA: SSC CGL 2026', [4], ahead(39)],
      ['Mock test: SSC CGL 2026', [0], ahead(39)],
    ],
  )
  const sessions = await h.sql<{ n: number }[]>`select count(*)::int as n from commitments where recurrence_id is not null and user_id = ${me.userId}`
  assert.ok(sessions[0]!.n >= 30, 'five or six weeks of sessions, on Today')

  // Made again: the last plan replaced, not doubled.
  await call(me, 'prep@test.local', 'POST', `/exams/${id}/study-plan`, { subjects: ['Quant'], days: [1], at: '07:00', minutes: 60, mock: null })
  assert.deepEqual((await call(me, 'prep@test.local', 'GET', `/exams/${id}`)).body.study.map((s: { title: string }) => s.title), ['Study Quant: SSC CGL 2026'])

  // The exam ends: so does its study plan.
  await call(me, 'prep@test.local', 'PATCH', `/exams/${id}`, { stage: 'dropped' })
  assert.deepEqual((await call(me, 'prep@test.local', 'GET', `/exams/${id}`)).body.study, [])
  const left = await h.sql<{ n: number }[]>`
    select count(*)::int as n from commitments where recurrence_id is not null and user_id = ${me.userId} and status = 'pending' and due_at > now()`
  assert.equal(left[0]!.n, 0)
})

test('mock scores: typed in a line, added, and taken back', async () => {
  const preview = (await call(me, 'prep@test.local', 'POST', '/quick/preview', { text: 'scored 142/200 in RRB NTPC mock' })).body
  assert.equal(preview.kind, 'exam')
  assert.match(preview.summary, /mock 142\/200 \(71%\)/)
  const saved = await call(me, 'prep@test.local', 'POST', '/quick', { text: 'scored 142/200 in RRB NTPC mock' })
  assert.equal(saved.status, 201)
  const examId = saved.body.id as string

  const more = await call(me, 'prep@test.local', 'POST', `/exams/${examId}/mocks`, { takenOn: ahead(-3), score: 128, outOf: 200, note: 'Full mock 3' })
  assert.deepEqual(
    more.body.mocks.map((m: { score: number; outOf: number }) => [m.score, m.outOf]),
    [[128, 200], [142, 200]],
    'oldest first, for the trend',
  )
  const gone = await call(me, 'prep@test.local', 'DELETE', `/exams/${examId}/mocks/${more.body.mocks[0].id}`)
  assert.equal(gone.status, 200)
  assert.equal((await call(me, 'prep@test.local', 'GET', `/exams/${examId}`)).body.mocks.length, 1)
})

test('for someone who reads Hindi, the exam’s plans and study plan are in Hindi', async () => {
  const set = await call(hindi, 'hindi@test.local', 'PATCH', '/me/preferences', { language: 'hi' })
  assert.equal(set.body.language, 'hi')
  const made = await call(hindi, 'hindi@test.local', 'POST', '/exams', {
    examKey: 'rssb-patwari',
    name: 'Rajasthan Patwari',
    cycle: '2025',
    stage: 'to_apply',
    dates: [{ step: 'apply_by', on: ahead(10) }, { step: 'exam', on: ahead(45) }],
  })
  const titles = await h.sql<{ title: string; notes: string | null }[]>`
    select title, notes from commitments where exam_id = ${made.body.id} order by due_at`
  assert.deepEqual(titles.map((t) => t.title), ['आवेदन की अंतिम तिथि: Rajasthan Patwari 2025', 'परीक्षा: Rajasthan Patwari 2025'])
  assert.match(titles[0]!.notes!, /^फॉर्म भरें और पुष्टि पृष्ठ सँभाल कर रखें/)

  const plan = await call(hindi, 'hindi@test.local', 'POST', `/exams/${made.body.id}/study-plan`, {
    subjects: ['राजस्थान GK', 'गणित'],
    days: [1, 3],
    at: '18:00',
    minutes: 60,
    mock: { day: 0, at: '09:00', minutes: 120 },
  })
  assert.deepEqual(
    plan.body.study.map((s: { title: string }) => s.title),
    ['पढ़ाई राजस्थान GK: Rajasthan Patwari 2025', 'पढ़ाई गणित: Rajasthan Patwari 2025', 'मॉक टेस्ट: Rajasthan Patwari 2025'],
  )
})
