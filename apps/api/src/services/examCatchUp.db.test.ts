import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { EXAMS, WATCHED_BOARDS } from '@cue/shared'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Dates an aspirant never has to type. An exam added after its notice was
 * approved gets that notice's dates; a later notice that moves a date moves
 * the plan rather than adding a second; and a category said once is said for
 * every exam.
 */

let h: Harness
let app: FastifyInstance
let admin: Seeded
let asha: Seeded
let ravi: Seeded

before(async () => {
  h = await createTestDb('exam_catch_up')
  process.env.DATABASE_URL = h.url
  const { env } = await import('../env.ts')
  env.adminEmails = ['admin@test.local']
  admin = await seedUser(h.sql, 'admin@test.local')
  asha = await seedUser(h.sql, 'asha@test.local')
  ravi = await seedUser(h.sql, 'ravi@test.local')
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { noticeRoutes } = await import('../routes/notices.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  app = Fastify()
  await registerAuth(app)
  await app.register(noticeRoutes)
  await app.register(examRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const as = (who: Seeded, email: string) => app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
async function call(token: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

/** A notice added by hand and approved with these dates, as the reviewer would. */
async function approve(url: string, title: string, dates: { step: string; on: string }[], examKey = 'ssc-cgl', cycle = '2026') {
  const token = as(admin, 'admin@test.local')
  const added = await call(token, 'POST', '/admin/notices', { url, title, board: null })
  assert.equal(added.status, 201)
  const proposals = [
    { examKey, cycle, kind: 'schedule', dates: dates.map((d) => ({ ...d, at: null, round: null, note: null })), list: null },
  ]
  return (await call(token, 'POST', `/admin/notices/${added.body.id}/approve`, { proposals })).body
}

const examPlans = (who: Seeded) =>
  h.sql<{ id: string; exam_step: string; due: string; notes: string | null }[]>`
    select id, exam_step, to_char(due_at, 'YYYY-MM-DD') as due, notes from commitments
    where user_id = ${who.userId} and exam_id is not null and status = 'pending' order by due_at`

test('an exam added after its notice gets the notice’s dates — nothing to type', async () => {
  const told = await approve('https://ssc.gov.in/notice/cgl-2026-calendar', 'SSC CGL 2026: Tier-I exam schedule', [
    { step: 'apply_by', on: '2027-01-10' },
    { step: 'exam', on: '2027-02-14' },
  ])
  assert.equal(told.told, 0, 'nobody tracks it yet')

  const made = await call(as(asha, 'asha@test.local'), 'POST', '/exams', { examKey: 'ssc-cgl', name: 'SSC CGL', stage: 'to_apply' })
  assert.equal(made.status, 201)
  assert.equal(made.body.officialDates, 2)
  const plans = await examPlans(asha)
  assert.deepEqual(plans.map((p) => [p.exam_step, p.due]), [['apply_by', '2027-01-10'], ['exam', '2027-02-14']])
  assert.ok(plans.every((p) => p.notes?.includes('https://ssc.gov.in/notice/cgl-2026-calendar')), 'each with the notice it came from')
})

test('a notice that moves the exam moves the plan, reminders and all', async () => {
  const before = (await examPlans(asha)).find((p) => p.exam_step === 'exam')!
  const told = await approve('https://ssc.gov.in/notice/cgl-2026-postponed', 'SSC CGL 2026: Tier-I postponed', [{ step: 'exam', on: '2027-03-07' }])
  assert.equal(told.told, 1)

  const exam = (await examPlans(asha)).filter((p) => p.exam_step === 'exam')
  assert.equal(exam.length, 1, 'one exam day, not two')
  assert.equal(exam[0]!.id, before.id, 'the same plan, moved')
  assert.equal(exam[0]!.due, '2027-03-07')
  const reminders = await h.sql<{ fire: string }[]>`
    select to_char(fire_at, 'YYYY-MM-DD') as fire from reminders where commitment_id = ${before.id} and status = 'pending'`
  assert.ok(reminders.length > 0)
  assert.ok(reminders.every((r) => r.fire > '2027-02-14'), 'no reminder left for the old day')
})

test('someone adding it now gets only the newest date for each step', async () => {
  const made = await call(as(ravi, 'ravi@test.local'), 'POST', '/exams', { examKey: 'ssc-cgl', name: 'SSC CGL', stage: 'to_apply' })
  assert.equal(made.body.officialDates, 2)
  assert.deepEqual((await examPlans(ravi)).map((p) => [p.exam_step, p.due]), [['apply_by', '2027-01-10'], ['exam', '2027-03-07']])
})

test('with no year said, the newest round — by its year, not its spelling', async () => {
  await approve('https://rrbapply.gov.in/ntpc-2026', 'RRB NTPC 2026: CBT-1 schedule', [{ step: 'exam', on: '2027-04-04' }], 'rrb-ntpc', '2026')
  await approve('https://rrbapply.gov.in/cen-05-2025', 'RRB NTPC CEN 05/2025: CBT-2', [{ step: 'exam', on: '2027-01-05' }], 'rrb-ntpc', 'CEN 05/2025')
  const made = await call(as(ravi, 'ravi@test.local'), 'POST', '/exams', { examKey: 'rrb-ntpc', name: 'RRB NTPC', stage: 'to_apply' })
  assert.equal(made.body.officialDates, 1)
  const plans = await h.sql<{ due: string }[]>`
    select to_char(due_at, 'YYYY-MM-DD') as due from commitments where exam_id = ${made.body.id} and status = 'pending'`
  assert.deepEqual(plans.map((p) => p.due), ['2027-04-04'])
})

test('an exam nobody has a notice for comes with none, and says so', async () => {
  const made = await call(as(ravi, 'ravi@test.local'), 'POST', '/exams', { examKey: 'upsc-cse', name: 'UPSC CSE', stage: 'to_apply' })
  assert.equal(made.body.officialDates, 0)
})

test('a category said once is said for every exam', async () => {
  const token = as(asha, 'asha@test.local')
  const second = await call(token, 'POST', '/exams', { examKey: 'rrb-ntpc', name: 'RRB NTPC', stage: 'applied' })
  const first = (await call(token, 'GET', '/exams')).body as unknown as { id: string; examKey: string }[]
  const cgl = first.find((x) => x.examKey === 'ssc-cgl')!
  assert.equal((await call(token, 'PATCH', `/exams/${cgl.id}`, { category: 'OBC' })).status, 200)

  const after = (await call(token, 'GET', '/exams')).body as unknown as { id: string; category: string | null }[]
  assert.equal(after.find((x) => x.id === second.body.id)!.category, 'OBC', 'the other exam too')
  const third = await call(token, 'POST', '/exams', { examKey: 'ssc-chsl', name: 'SSC CHSL', stage: 'applied' })
  assert.equal(third.body.category, 'OBC', 'and every new one')

  const ravis = (await call(as(ravi, 'ravi@test.local'), 'GET', '/exams')).body as unknown as { category: string | null }[]
  assert.ok(ravis.every((x) => x.category === null), 'nobody else’s')
})

test('every board Cue reads by itself holds an exam in the catalog, and the watcher reads exactly those', async () => {
  const { NOTICE_SOURCES } = await import('./noticeWatch.ts')
  assert.deepEqual([...new Set(NOTICE_SOURCES.map((s) => s.board))].sort(), Object.keys(WATCHED_BOARDS).sort())
  for (const body of Object.values(WATCHED_BOARDS)) {
    assert.ok(EXAMS.some((x) => x.body === body), `${body} holds an exam in the catalog`)
  }
})
