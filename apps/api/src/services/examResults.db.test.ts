import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Results: a board's list of roll numbers, approved by a reviewer, looked
 * through for each person's number. Found, the exam moves on to the round
 * it is a shortlist for; not found, they are told so, carefully; with no
 * number, they are told to look. A list a robot may not fetch is handed over
 * by the reviewer instead, and its cut-offs read for them. A number added
 * later is looked for in the lists already out, and anyone can look through
 * a list they have themselves.
 */

let h: Harness
let svc: typeof import('./noticeWatch.ts')
let exams: typeof import('./exams.ts')
let app: FastifyInstance
let admin: Seeded
let asha: Seeded
let ravi: Seeded
let meera: Seeded
let kiran: Seeded

const NOW = new Date(2026, 10, 20, 10, 0)
const list = readFileSync(new URL('./fixtures/rrb-result-list.pdf', import.meta.url))
const LIST_URL = 'https://www.rrbcdg.gov.in/uploads/cen-05-2024-cbt1-result.pdf'
const TITLE = 'CEN 05/2024 (NTPC Graduate): Result of CBT-1 and list of candidates shortlisted for CBT-2'

const fetched: string[] = []
const fakeFetch = (async (url: string) => {
  fetched.push(url)
  if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nDisallow: /private/\n', { status: 200, headers: { 'content-type': 'text/plain' } })
  if (url === LIST_URL) return new Response(list, { status: 200, headers: { 'content-type': 'application/pdf' } })
  return new Response('', { status: 404 })
}) as unknown as import('./noticeWatch.ts').Fetcher

before(async () => {
  h = await createTestDb('exam_results')
  process.env.DATABASE_URL = h.url
  const { env } = await import('../env.ts')
  env.adminEmails = ['admin@test.local']
  svc = await import('./noticeWatch.ts')
  exams = await import('./exams.ts')
  admin = await seedUser(h.sql, 'admin@test.local')
  asha = await seedUser(h.sql, 'asha@test.local')
  ravi = await seedUser(h.sql, 'ravi@test.local')
  meera = await seedUser(h.sql, 'meera@test.local')
  kiran = await seedUser(h.sql, 'kiran@test.local')
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

const token = (who: Seeded, email: string) => app.jwt.sign({ sub: who.userId, orgId: who.orgId, email })
async function call(t: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, type?: string) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${t}`, ...(type ? { 'content-type': type } : {}) } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

/** An RRB NTPC (CEN 05/2024) exam at CBT 1, with this roll number. */
async function ntpc(who: Seeded, rollNo: string | null) {
  const made = await exams.createExam(who.orgId, who.userId, { examKey: 'rrb-ntpc', name: 'RRB NTPC', cycle: 'CEN 05/2024', rollNo, stage: 'cbt1' }, NOW)
  assert.ok(made !== 'unknown_stage')
  return made.exam.id
}

test('a shortlist, looked through for everyone with a number', async () => {
  const mine = await ntpc(asha, '24 1234 5678')
  const notMine = await ntpc(ravi, '2499999999')
  await ntpc(meera, null)

  const notice = await svc.addNotice({ url: LIST_URL, title: TITLE, board: 'RRB' }, NOW)
  assert.deepEqual(notice.proposals, [
    { examKey: 'rrb-ntpc', cycle: 'CEN 05/2024', kind: 'result', dates: [], list: { means: 'shortlist', round: 'cbt2', pdfUrl: null } },
  ])

  const done = await svc.approveNotice(notice.id, admin.userId, notice.proposals, NOW, fakeFetch)
  assert.ok(typeof done === 'object')
  assert.deepEqual([done.checked, done.found, done.told, done.listProblem], [2, 1, 3, null])
  assert.equal(done.listNumbers, 541)
  assert.ok(fetched.includes(LIST_URL) && fetched.some((u) => u.endsWith('/robots.txt')), 'robots.txt first, then the list')

  const stages = await h.sql<{ user: string; stage: string }[]>`select user_id as user, stage from exams order by stage`
  assert.equal(stages.find((s) => s.user === asha.userId)!.stage, 'cbt2', 'on to CBT 2')
  assert.equal(stages.find((s) => s.user === ravi.userId)!.stage, 'cbt1', 'not found is not "failed": the stage stays')

  const page = await call(token(asha, 'asha@test.local'), 'GET', `/exams/${mine}`)
  assert.deepEqual(
    page.body.checks.map((c: Record<string, unknown>) => [c.found, c.means, c.round, typeof c.page]),
    [[true, 'shortlist', 'cbt2', 'number']],
  )
  const theirs = await call(token(ravi, 'ravi@test.local'), 'GET', `/exams/${notMine}`)
  assert.deepEqual(theirs.body.checks.map((c: Record<string, unknown>) => [c.found, c.page]), [[false, null]])

  // No number to look for: told to go and look.
  const plans = await h.sql<{ title: string }[]>`select title from commitments where user_id = ${meera.userId}`
  assert.deepEqual(plans.map((p) => p.title), ['Result: RRB NTPC CEN 05/2024'])
})

test('a list no robot may fetch is handed over, its cut-offs read for the reviewer', async () => {
  const blocked = 'https://www.rrbcdg.gov.in/private/final-result.pdf'
  const notice = await svc.addNotice({ url: blocked, title: 'CEN 05/2024 (NTPC Graduate): Final result', board: 'RRB' }, NOW)
  const t = token(admin, 'admin@test.local')
  const read = await call(t, 'POST', `/admin/notices/${notice.id}/list`, list, 'application/pdf')
  assert.equal(read.status, 200)
  assert.equal(read.body.numbers, 541)
  assert.deepEqual(read.body.cutoffs, [
    { category: 'UR', marks: 72.5 },
    { category: 'EWS', marks: 65.1 },
    { category: 'OBC', marks: 68.25 },
    { category: 'SC', marks: 58.4 },
    { category: 'ST', marks: 52 },
  ])

  const proposals = [{ ...notice.proposals[0]!, cutoffs: read.body.cutoffs }]
  fetched.length = 0
  const done = await call(t, 'POST', `/admin/notices/${notice.id}/approve`, { proposals })
  assert.equal(done.body.found, 1, 'Asha is on this list too: selected')
  assert.equal(done.body.listProblem, null, 'the handed-over list was used')
  assert.equal((await h.sql`select stage from exams where user_id = ${asha.userId}`)[0]!.stage, 'selected')
  assert.ok(!fetched.includes(blocked), 'never fetched')

  const mine = (await h.sql<{ id: string }[]>`select id from exams where user_id = ${asha.userId}`)[0]!.id
  const page = await call(token(asha, 'asha@test.local'), 'GET', `/exams/${mine}`)
  const final = page.body.notices.find((n: { title: string }) => n.title.includes('Final result'))
  assert.deepEqual(final.cutoffs[2], { category: 'OBC', marks: 68.25 })
})

test('a roll number added later is looked for in the lists already out', async () => {
  const id = await ntpc(kiran, null)
  const t = token(kiran, 'kiran@test.local')
  const res = await call(t, 'PATCH', `/exams/${id}`, { rollNo: '2412004119', category: 'OBC' })
  assert.equal(res.status, 200)
  assert.equal(res.body.category, 'OBC')
  assert.deepEqual(
    res.body.checks.map((c: { found: boolean; means: string }) => [c.means, c.found]).sort(),
    [['selected', true], ['shortlist', true]],
    'on both lists already out',
  )
  assert.equal(res.body.stage, 'selected')
})

test('anyone can look through a list they have', async () => {
  const mine = (await h.sql<{ id: string }[]>`select id from exams where user_id = ${asha.userId}`)[0]!.id
  const found = await call(token(asha, 'asha@test.local'), 'POST', `/exams/${mine}/check-list`, list, 'application/pdf')
  assert.equal(found.status, 200)
  assert.ok(found.body.page >= 1 && found.body.page <= found.body.pages)
  const theirs = (await h.sql<{ id: string }[]>`select id from exams where user_id = ${ravi.userId}`)[0]!.id
  assert.equal((await call(token(ravi, 'ravi@test.local'), 'POST', `/exams/${theirs}/check-list`, list, 'application/pdf')).body.page, null)
  const none = (await h.sql<{ id: string }[]>`select id from exams where user_id = ${meera.userId}`)[0]!.id
  assert.equal((await call(token(meera, 'meera@test.local'), 'POST', `/exams/${none}/check-list`, list, 'application/pdf')).status, 422, 'no number to look for')
})
