import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What an aspirant has studied, said once, and a form opening told to those
 * it may matter to: tracking an exam of the same family, not this one, not
 * told no, and not plainly short of what it asks for. Once per form; a
 * board's calendar tells nobody.
 */

let h: Harness
let app: FastifyInstance
let svc: typeof import('./noticeWatch.ts')
const people: Record<string, Seeded> = {}

before(async () => {
  h = await createTestDb('exam_fit')
  process.env.DATABASE_URL = h.url
  const { env } = await import('../env.ts')
  env.adminEmails = ['admin@test.local']
  svc = await import('./noticeWatch.ts')
  for (const name of ['admin', 'priya', 'aman', 'neha', 'raj', 'kiran', 'meera']) people[name] = await seedUser(h.sql, `${name}@test.local`)
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { noticeRoutes } = await import('../routes/notices.ts')
  const { examRoutes } = await import('../routes/exams.ts')
  const { meRoutes } = await import('../routes/me.ts')
  const { ZodError } = await import('zod')
  app = Fastify()
  // As the server answers a bad request: 400, not a crash.
  app.setErrorHandler((err: Error, _req, reply) => reply.code(err instanceof ZodError ? 400 : 500).send({ error: err.message }))
  await registerAuth(app)
  await app.register(noticeRoutes)
  await app.register(examRoutes)
  await app.register(meRoutes)
  await app.ready()
})

after(async () => {
  await app.close()
  await h.close()
})

const as = (name: string) => app.jwt.sign({ sub: people[name]!.userId, orgId: people[name]!.orgId, email: `${name}@test.local` })
async function call(name: string, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body as never, headers: { authorization: `Bearer ${as(name)}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}
const track = (name: string, examKey: string, examName: string) => call(name, 'POST', '/exams', { examKey, name: examName, stage: 'applied' })

async function approve(examKey: string, cycle: string, applyBy: string, note: string | null = null) {
  const added = await call('admin', 'POST', '/admin/notices', { url: `https://ssc.gov.in/${examKey}-${cycle}-${applyBy}`, title: `${examKey} ${cycle}`, board: null })
  const proposals = [{ examKey, cycle, kind: 'notification', dates: [{ step: 'apply_by', on: applyBy, at: null, round: null, note }], list: null }]
  await call('admin', 'POST', `/admin/notices/${added.body.id}/approve`, { proposals })
  return { id: added.body.id as string, proposal: proposals[0]! }
}
const nameOf = (id: string) => Object.entries(people).find(([, p]) => p.userId === id)![0]

test('what someone studied is said once, and only what the lists allow', async () => {
  assert.equal((await call('priya', 'PATCH', '/me/preferences', { examLevel: 'phd' })).status, 400)
  const saved = await call('priya', 'PATCH', '/me/preferences', { examLevel: '12th', examTraining: ['iti', 'iti'] })
  assert.equal(saved.body.examLevel, '12th')
  assert.deepEqual(saved.body.examTraining, ['iti'])
  assert.equal(saved.body.examFormAlerts, true, 'told of forms unless they say no')
})

test('a form opening is for the same family, those it fits, once — never the calendar', async () => {
  await track('priya', 'ssc-cgl', 'SSC CGL') // 12th
  await call('aman', 'PATCH', '/me/preferences', { examLevel: 'graduate' })
  await track('aman', 'ssc-mts', 'SSC MTS & Havaldar')
  await track('neha', 'ssc-cgl', 'SSC CGL')
  await call('neha', 'PATCH', '/me/preferences', { examFormAlerts: false })
  await track('raj', 'ssc-chsl', 'SSC CHSL') // already tracking it
  await track('kiran', 'rrb-ntpc', 'RRB NTPC') // railways, not SSC
  await track('meera', 'ssc-gd', 'SSC GD Constable') // has not said what she studied

  const now = new Date(2027, 0, 5)
  const chsl = await approve('ssc-chsl', '2027', '2027-02-20')
  const told = await svc.formOpenedFor(chsl.proposal as never, chsl.id, now)
  assert.deepEqual(told?.userIds.map(nameOf).sort(), ['aman', 'meera', 'priya'], 'CHSL asks for 12th: Priya fits; Meera has not said, so she is told')

  const cgl = await approve('ssc-cgl', '2027', '2027-02-25')
  const forCgl = await svc.formOpenedFor(cgl.proposal as never, cgl.id, now)
  assert.deepEqual(forCgl?.userIds.map(nameOf).sort(), ['aman', 'meera', 'raj'], 'CGL asks for graduation: not Priya, and not those tracking CGL')

  const again = await approve('ssc-chsl', '2027', '2027-02-28')
  assert.equal(await svc.formOpenedFor(again.proposal as never, again.id, now), null, 'an extension is not news')
  const calendar = await approve('ssc-mts', '2027', '2027-03-15', 'Tentative, from the SSC calendar')
  assert.equal(await svc.formOpenedFor(calendar.proposal as never, calendar.id, now), null, 'a calendar is a plan, not an opening')
})

test('forms open now are marked against what was studied, those that fit first', async () => {
  const forms = (await call('priya', 'GET', '/exams/open-forms')).body as unknown as { examKey: string; fit: string | null }[]
  const mine = forms.filter((f) => ['ssc-chsl', 'ssc-mts'].includes(f.examKey)).map((f) => [f.examKey, f.fit])
  assert.deepEqual(mine, [
    ['ssc-chsl', 'fits'],
    ['ssc-mts', 'fits'],
  ])
  assert.ok(!forms.some((f) => f.examKey === 'ssc-cgl'), 'one she tracks is not offered')

  const meeras = (await call('meera', 'GET', '/exams/open-forms')).body as unknown as { examKey: string; fit: string | null }[]
  assert.ok(meeras.every((f) => f.fit === null), 'not said, not judged')

  await call('kiran', 'PATCH', '/me/preferences', { examLevel: '12th' })
  const kirans = (await call('kiran', 'GET', '/exams/open-forms')).body as unknown as { examKey: string; fit: string | null }[]
  assert.deepEqual(
    kirans.map((f) => [f.examKey, f.fit]),
    [
      ['ssc-chsl', 'fits'],
      ['ssc-mts', 'fits'],
      ['ssc-cgl', 'needs'],
    ],
    'what plainly asks for more comes last, still there',
  )
})
