import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * After the exam: a score worked out from the answer key, by the board's
 * marking or one typed in, held against the newest cut-off Cue has. And the
 * exam day kept as the admit card gave it, to tell family.
 */

let h: Harness
let app: FastifyInstance
let asha: Seeded
let admin: Seeded

before(async () => {
  h = await createTestDb('exam_expected')
  process.env.DATABASE_URL = h.url
  const { env } = await import('../env.ts')
  env.adminEmails = ['admin@test.local']
  asha = await seedUser(h.sql, 'asha@test.local')
  admin = await seedUser(h.sql, 'admin@test.local')
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  const { noticeRoutes } = await import('../routes/notices.ts')
  const { ZodError } = await import('zod')
  app = Fastify()
  app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: err.message }))
  await registerAuth(app)
  await app.register(examRoutes)
  await app.register(noticeRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const as = (who: Seeded, email: string) => app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown, who = asha, email = 'asha@test.local') {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${as(who, email)}` } })
  return { status: res.statusCode, body: res.json() as any }
}

let cgl: string

test('a score by the board’s marking, kept by round', async () => {
  cgl = (await call('POST', '/exams', { examKey: 'ssc-cgl', name: 'SSC CGL', cycle: '2026', stage: 'applied' })).body.id
  const saved = await call('PUT', `/exams/${cgl}/expected`, { round: 'tier1', right: 78, wrong: 12 })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.expected.tier1.score, 150)
  assert.equal(saved.body.expected.tier1.outOf, 200)
  assert.equal(saved.body.expected.tier1.perWrong, 0.5)

  const again = await call('PUT', `/exams/${cgl}/expected`, { round: 'tier1', right: 80, wrong: 10 })
  assert.equal(again.body.expected.tier1.score, 155, 'the latest replaces the last')
})

test('a paper Cue does not know is marked as typed; with no marking, it asks for one', async () => {
  assert.equal((await call('PUT', `/exams/${cgl}/expected`, { round: 'tier2', right: 50, wrong: 10 })).body.error, 'no_marking')
  const typed = await call('PUT', `/exams/${cgl}/expected`, { round: 'tier2', right: 50, wrong: 10, questions: 130, perRight: 3, perWrong: 1 })
  assert.equal(typed.body.expected.tier2.score, 140)
  assert.equal(typed.body.expected.tier2.outOf, 390)
  assert.equal((await call('PUT', `/exams/${cgl}/expected`, { round: 'tier1', right: 90, wrong: 20 })).body.error, 'too_many')
  assert.equal((await call('PUT', `/exams/${cgl}/expected`, { round: 'tier1', right: -1, wrong: 0 })).status, 400)
})

test('held against the newest cut-off Cue has, of any year', async () => {
  const token = 'admin@test.local'
  const added = await call('POST', '/admin/notices', { url: 'https://ssc.gov.in/cgl-2025-result', title: 'SSC CGL 2025: Tier 1 result', board: null }, admin, token)
  const proposals = [
    {
      examKey: 'ssc-cgl',
      cycle: '2025',
      kind: 'result',
      dates: [],
      list: null,
      cutoffs: [
        { category: 'UR', marks: 149.5 },
        { category: 'OBC', marks: 141.2 },
      ],
    },
  ]
  await call('POST', `/admin/notices/${added.body.id}/approve`, { proposals }, admin, token)
  const exam = (await call('GET', `/exams/${cgl}`)).body
  assert.equal(exam.lastCutoffs.cycle, '2025', 'last year’s, for this year’s exam')
  assert.deepEqual(exam.lastCutoffs.cutoffs.find((c: { category: string }) => c.category === 'OBC'), { category: 'OBC', marks: 141.2 })
})

test('the exam day is kept as the admit card gave it', async () => {
  await call('POST', '/exams/day', {
    examId: cgl,
    date: '2026-12-08',
    reportingAt: '07:30',
    gateClosesAt: '08:30',
    startsAt: '09:00',
    endsAt: '10:00',
    centreName: 'iON Digital Zone',
    centreAddress: 'Mansarovar',
    centreCity: 'Jaipur',
    round: 'tier1',
  })
  const exam = (await call('GET', `/exams/${cgl}`)).body
  assert.deepEqual(exam.examDay, { date: '2026-12-08', reportingAt: '07:30', gateClosesAt: '08:30', startsAt: '09:00', endsAt: '10:00' })
})
