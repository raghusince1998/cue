import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Exam days that collide, found from the dates Cue holds; a new one told at
 * once. And the Exams section kept to those who chose it — not for having an
 * exam in it.
 */

let h: Harness
let app: FastifyInstance
let svc: typeof import('./exams.ts')
let sections: typeof import('./sections.ts')
let asha: Seeded

before(async () => {
  h = await createTestDb('exam_clash')
  process.env.DATABASE_URL = h.url
  svc = await import('./exams.ts')
  sections = await import('./sections.ts')
  asha = await seedUser(h.sql, 'asha@test.local')
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  app = Fastify()
  await registerAuth(app)
  await app.register(examRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const token = () => app.jwt.sign({ sub: asha.userId, orgId: asha.orgId, email: 'asha@test.local' })
async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token()}` } })
  return { status: res.statusCode, body: res.json() as any }
}

let chsl: string
let ntpc: string

test('two exams on one day are found, each named with its round', async () => {
  chsl = (await call('POST', '/exams', { examKey: 'ssc-chsl', name: 'SSC CHSL', cycle: '2027', stage: 'applied', dates: [{ step: 'exam', on: '2027-03-10', round: 'tier1' }] })).body.id
  ntpc = (await call('POST', '/exams', { examKey: 'rrb-ntpc', name: 'RRB NTPC', cycle: '2026', stage: 'applied', dates: [{ step: 'exam', on: '2027-03-10' }] })).body.id
  await call('POST', '/exams', { examKey: 'ssc-cgl', name: 'SSC CGL', stage: 'applied', dates: [{ step: 'exam', on: '2027-04-02' }] })

  const clashes = (await call('GET', '/exams/clashes')).body as { kind: string; on: string; a: { label: string }; b: { label: string } }[]
  assert.equal(clashes.length, 1)
  assert.equal(clashes[0]!.kind, 'same-day')
  assert.equal(clashes[0]!.on, '2027-03-10')
  assert.deepEqual([clashes[0]!.a.label, clashes[0]!.b.label].sort(), ['RRB NTPC 2026', 'SSC CHSL 2027 — Tier 1'])
})

test('a new day that lands on another exam’s is told at once; others are not', async () => {
  const sent: { title: string; body: string }[] = []
  const send = (async (_userId: string, p: { title: string; body: string }) => {
    sent.push(p)
    return 1
  }) as never
  const now = new Date(2027, 0, 5)
  assert.equal(await svc.tellOfClashes(asha.userId, chsl, ['2027-03-10'], now, send), 1)
  assert.match(sent[0]!.title, /^Two exams on /)
  assert.match(sent[0]!.body, /SSC CHSL 2027 — Tier 1|RRB NTPC 2026/)
  assert.equal(await svc.tellOfClashes(asha.userId, chsl, ['2027-04-02'], now, send), 0, 'a day with no clash says nothing')
})

test('a finished exam clashes with nothing, and no exam keeps an Exams section', async () => {
  assert.ok(!(await sections.filledSections(asha.userId)).includes('exams'), 'an exam going is not choosing Exams')
  await call('PATCH', `/exams/${ntpc}`, { stage: 'not_selected' })
  assert.deepEqual((await call('GET', '/exams/clashes')).body, [])

  const all = (await call('GET', '/exams')).body as { id: string }[]
  for (const x of all) if (x.id !== ntpc) await call('PATCH', `/exams/${x.id}`, { stage: 'dropped' })
  assert.ok(!(await sections.filledSections(asha.userId)).includes('exams'), 'tried once is not having exams')
})
