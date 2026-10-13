import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Watching boards' notice pages, against a pretend web: robots.txt obeyed,
 * a site that refuses robots left alone, the first visit kept as the
 * baseline, new notices proposed for review, a PDF read for its dates only
 * where robots.txt allows — and nothing reaching anyone until a reviewer
 * approves it, when it reaches exactly the people tracking that exam.
 */

let h: Harness
let svc: typeof import('./noticeWatch.ts')
let app: FastifyInstance
let admin: Seeded
let asha: Seeded
let ravi: Seeded
let meera: Seeded

const NOW = new Date(2026, 9, 13, 10, 0)
const pdf = readFileSync(new URL('./fixtures/rrb-admit-card.pdf', import.meta.url))

/** Pages as the boards lay them out; every title made up in their style. */
const RSSB_ROBOTS = 'User-agent: *\nDisallow: /admin/\nDisallow: /Documents/\nDisallow: /storage/news_item/1004.pdf\n'
const rssbPage = (items: [string, string][]) =>
  `<html><body><div class="news">${items.map(([href, title]) => `<li><a href="${href}" target="_blank">${title} </a></li>`).join('\n')}</div>
   <a href="/about">About the Board and its history</a></body></html>`
const FIRST_RSSB: [string, string][] = [
  ['https://rssb.rajasthan.gov.in/storage/news_item/1001.pdf', 'Patwari 2025 : Admit Card for Written Exam'],
  ['https://rssb.rajasthan.gov.in/storage/news_item/1002.pdf', 'Lab Assistant 2026 : Last chance of Document Verification'],
]
const rpscRow = (n: number, released: string, exam: string, title: string, on: string) =>
  `<tr class='align-middle'><td class='d-none'>${n}</td><td class='d-none'>${released}</td><td align='left'>${exam}</td><td align='left'>${title}</td><td>${on}</td></tr>`
const RPSC_PAGE = `<table><thead><tr><th>Sr. No.</th><th>Release Date</th><th>Exam Name</th><th>Title</th><th>Exam Date</th></tr></thead><tbody>
  ${rpscRow(1, '02/07/2026', 'RAJ. STATE AND SUB. SERVICES COMB. COMP EXAM 2026', 'Pre', '06/12/2026')}
  ${rpscRow(2, '02/07/2026', 'ASST. PROSECUTION OFFICER 2026', 'Mains', '27/12/2026')}
  ${rpscRow(3, '15/01/2026', 'SENIOR TEACHER 2025', 'Senior Teacher', '20/03/2026')}
</tbody></table>`

let rssbItems = FIRST_RSSB
const fetched: { url: string; agent: string }[] = []
const fakeFetch = (async (url: string, init: { headers: Record<string, string> }) => {
  fetched.push({ url, agent: init.headers['user-agent']! })
  const ok = (body: string | Buffer, type = 'text/html') => new Response(body, { status: 200, headers: { 'content-type': type } })
  if (url === 'https://rssb.rajasthan.gov.in/robots.txt') return ok(RSSB_ROBOTS, 'text/plain')
  if (url === 'https://rpsc.rajasthan.gov.in/robots.txt') return new Response('Not here', { status: 404 })
  if (url === 'https://nta.ac.in/robots.txt') return new Response('<h1>Access Denied</h1>', { status: 403 })
  if (url === 'https://rssb.rajasthan.gov.in/') return ok(rssbPage(rssbItems))
  if (url === 'https://rpsc.rajasthan.gov.in/proposedexamdate') return ok(RPSC_PAGE)
  if (url.endsWith('.pdf')) return ok(pdf, 'application/pdf')
  return new Response('', { status: 404 })
}) as unknown as import('./noticeWatch.ts').Fetcher
const noPause = async () => undefined

before(async () => {
  h = await createTestDb('notices')
  process.env.DATABASE_URL = h.url
  const { env } = await import('../env.ts')
  env.adminEmails = ['admin@test.local']
  svc = await import('./noticeWatch.ts')
  admin = await seedUser(h.sql, 'admin@test.local')
  asha = await seedUser(h.sql, 'asha@test.local')
  ravi = await seedUser(h.sql, 'ravi@test.local')
  meera = await seedUser(h.sql, 'meera@test.local')
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
async function call(token: string, method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

test('robots.txt read the way robots read it', () => {
  const rules = svc.parseRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /Documents/\nAllow: /Documents/public/\nDisallow: /*.zip$\n')
  assert.equal(svc.robotsAllow(rules, '/storage/news_item/1.pdf'), true)
  assert.equal(svc.robotsAllow(rules, '/Documents/notice.pdf'), false)
  assert.equal(svc.robotsAllow(rules, '/Documents/public/notice.pdf'), true, 'the longer rule wins')
  assert.equal(svc.robotsAllow(rules, '/files/all.zip'), false)
  assert.equal(svc.robotsAllow(svc.parseRobots('User-agent: CueBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n'), '/'), false, 'named, it obeys its own rules')
})

test('the first visit is the baseline, but dates still to come in a table are proposed', async () => {
  const runs = await svc.runNoticeWatch(NOW, fakeFetch, noPause)
  assert.deepEqual(
    runs.map((r) => [r.source, r.ok]),
    [['rssb-news', true], ['rpsc-exam-dates', true], ['nta-notices', false]],
  )
  assert.match(runs[2]!.message, /robots/)
  assert.ok(!fetched.some((f) => f.url === 'https://nta.ac.in/'), 'a site refusing robots is not read')
  assert.ok(fetched.every((f) => f.agent.startsWith('CueBot/')), 'always by name')

  const rows = await h.sql<{ title: string; status: string }[]>`select title, status from notices order by title`
  assert.deepEqual(
    rows.map((r) => [r.title, r.status]),
    [
      ['ASST. PROSECUTION OFFICER 2026 — Mains', 'unmatched'],
      ['Lab Assistant 2026 : Last chance of Document Verification', 'baseline'],
      ['Patwari 2025 : Admit Card for Written Exam', 'baseline'],
      ['RAJ. STATE AND SUB. SERVICES COMB. COMP EXAM 2026 — Pre', 'pending'],
      ['SENIOR TEACHER 2025 — Senior Teacher', 'baseline'],
    ],
  )
})

test('new notices after it: proposed, and a PDF read for its dates only where allowed', async () => {
  rssbItems = [
    ['https://rssb.rajasthan.gov.in/storage/news_item/1003.pdf', 'Patwari 2025 : Press Note regarding Exam Schedule (Exam Dates &amp; Time)'],
    ['https://rssb.rajasthan.gov.in/storage/news_item/1004.pdf', 'Village Development Officer 2025 : DV Schedule'],
    ...FIRST_RSSB,
  ]
  fetched.length = 0
  const runs = await svc.runNoticeWatch(NOW, fakeFetch, noPause)
  assert.equal(runs[0]!.added, 2)
  assert.ok(fetched.some((f) => f.url.endsWith('/storage/news_item/1003.pdf')), 'the PDF in an open path is read')
  assert.ok(!fetched.some((f) => f.url.endsWith('/1004.pdf')), 'one robots.txt closes is not')

  const patwari = (await svc.listNotices('pending')).find((n) => n.title.startsWith('Patwari'))!
  assert.equal(patwari.title, 'Patwari 2025 : Press Note regarding Exam Schedule (Exam Dates & Time)')
  assert.deepEqual(patwari.proposals, [{ examKey: 'rssb-patwari', cycle: '2025', kind: 'schedule', dates: [], list: null }])
  assert.deepEqual(patwari.hints, ['2026-11-18'], 'the dates in its PDF, for the reviewer')
  const vdo = (await svc.listNotices('pending')).find((n) => n.title.startsWith('Village'))!
  assert.deepEqual(vdo.hints, [])
})

test('only a reviewer sees the queue', async () => {
  assert.equal((await call(as(asha, 'asha@test.local'), 'GET', '/admin/notices')).status, 404)
  const queue = await call(as(admin, 'admin@test.local'), 'GET', '/admin/notices')
  assert.equal(queue.status, 200)
  assert.equal(queue.body.notices.length, 3)
  assert.equal(queue.body.sources.find((s: { id: string }) => s.id === 'nta-notices').ok, false)
})

test('approved, it reaches exactly the people tracking that exam — once', async () => {
  const { createExam } = await import('./exams.ts')
  const mine = await createExam(asha.orgId, asha.userId, { examKey: 'rssb-patwari', name: 'Rajasthan Patwari', cycle: '2025' }, NOW)
  await createExam(ravi.orgId, ravi.userId, { examKey: 'rssb-patwari', name: 'Rajasthan Patwari', cycle: '2024' }, NOW)
  await createExam(meera.orgId, meera.userId, { examKey: 'ssc-cgl', name: 'SSC CGL', cycle: '2026' }, NOW)
  assert.ok(mine !== 'unknown_stage')

  const patwari = (await svc.listNotices('pending')).find((n) => n.title.startsWith('Patwari'))!
  const token = as(admin, 'admin@test.local')
  // The reviewer read the PDF and put in the exam's day.
  const proposals = [{ ...patwari.proposals[0]!, dates: [{ step: 'exam', on: '2026-11-18', at: null, round: null, note: null }] }]
  const done = await call(token, 'POST', `/admin/notices/${patwari.id}/approve`, { proposals })
  assert.equal(done.status, 200)
  assert.equal(done.body.told, 1, 'Asha, and not Ravi (2024) or Meera (another exam)')

  const plans = await h.sql<{ user: string; title: string; notes: string }[]>`select user_id as user, title, notes from commitments where exam_id is not null`
  assert.deepEqual(plans.map((p) => [p.user, p.title]), [[asha.userId, 'Exam: Rajasthan Patwari 2025']])
  assert.match(plans[0]!.notes, /From the official notice: https:\/\/rssb\.rajasthan\.gov\.in\/storage\/news_item\/1003\.pdf/)

  assert.equal((await call(token, 'POST', `/admin/notices/${patwari.id}/approve`, { proposals })).status, 409, 'never twice')

  // On her exam's page, with where to read it.
  const page = await call(as(asha, 'asha@test.local'), 'GET', `/exams/${mine.exam.id}`)
  assert.deepEqual(
    page.body.notices.map((n: { summary: string; url: string }) => [n.summary, n.url]),
    [['Rajasthan Patwari 2025: exam on Wed, 18 Nov', 'https://rssb.rajasthan.gov.in/storage/news_item/1003.pdf']],
  )
})

test('a notice with no date is a plan to read it; one added by hand works the same', async () => {
  const token = as(admin, 'admin@test.local')
  const added = await call(token, 'POST', '/admin/notices', {
    url: 'https://ssc.gov.in/notice/cgl-2026-tier-1-admit-card',
    title: 'SSC CGL 2026: Admit card for Tier-I released',
    board: null,
  })
  assert.equal(added.status, 201)
  assert.equal(added.body.source, 'manual')
  assert.deepEqual(added.body.proposals, [{ examKey: 'ssc-cgl', cycle: '2026', kind: 'admit_card', dates: [], list: null }])

  const done = await call(token, 'POST', `/admin/notices/${added.body.id}/approve`, { proposals: added.body.proposals })
  assert.equal(done.body.told, 1, 'Meera tracks SSC CGL 2026')
  const plan = await h.sql<{ title: string }[]>`select title from commitments where user_id = ${meera.userId}`
  assert.deepEqual(plan.map((p) => p.title), ['Download the admit card: SSC CGL 2026'])

  const unmatched = (await svc.listNotices('unmatched'))[0]!
  assert.equal((await call(token, 'POST', `/admin/notices/${unmatched.id}/dismiss`)).status, 200)
})
