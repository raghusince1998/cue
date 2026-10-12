import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Work and personal, through the routes: read from the words, changed by the
 * person and then kept, a repeat's choice carried to each of its days, and a
 * working week that has to make sense.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

before(async () => {
  h = await createTestDb('sphere')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { commitmentRoutes } = await import('./commitments.ts')
  const { meRoutes } = await import('./me.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'sphere@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.register(commitmentRoutes)
  await app.register(meRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'sphere@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('the preview says which half of the day a line is', async () => {
  assert.equal((await call('POST', '/quick/preview', { text: 'send the Q3 report friday 4pm' })).body.sphere, 'work')
  assert.equal((await call('POST', '/quick/preview', { text: 'call mom tonight at 9' })).body.sphere, 'personal')
  assert.equal((await call('POST', '/quick/preview', { text: 'call Ravi tomorrow 5pm' })).body.sphere, null)
})

test('read from the words until the person says otherwise, then kept', async () => {
  const saved = await call('POST', '/quick', { text: 'call mom tomorrow 7pm', allowConflict: true })
  assert.equal(saved.status, 201)
  const id = saved.body.id as string

  let plan = (await call('GET', `/commitments/${id}`)).body
  assert.equal(plan.sphere, 'personal')
  assert.equal(plan.sphereSaid, false)

  await call('PATCH', `/commitments/${id}`, { sphere: 'work' })
  plan = (await call('GET', `/commitments/${id}`)).body
  assert.equal(plan.sphere, 'work', 'their say wins over the words')
  assert.equal(plan.sphereSaid, true)

  await call('PATCH', `/commitments/${id}`, { sphere: null })
  plan = (await call('GET', `/commitments/${id}`)).body
  assert.equal(plan.sphere, 'personal', 'back to what the words say')
})

test('a choice made in the capture box is kept, and a repeat carries it to every day', async () => {
  const saved = await call('POST', '/quick', { text: 'gym every day 7am', sphere: 'work' })
  assert.equal(saved.status, 201)
  const [series] = await h.sql<{ sphere: string }[]>`select sphere from recurrences where id = ${saved.body.id as string}`
  assert.equal(series!.sphere, 'work')
  const days = await h.sql<{ sphere: string }[]>`select sphere from commitments where recurrence_id = ${saved.body.id as string}`
  assert.ok(days.length > 0)
  assert.ok(days.every((d) => d.sphere === 'work'))
})

test('the working week: saved, tidied, and never ending before it starts', async () => {
  const ok = await call('PATCH', '/me/preferences', { workDays: [5, 1, 1, 2], workStartHour: 10, workEndHour: 19, keepApart: true })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body.workDays, [1, 2, 5])
  assert.equal(ok.body.workStartHour, 10)
  assert.equal((await call('PATCH', '/me/preferences', { workStartHour: 20 })).status, 400, 'starts after it ends')
  assert.equal((await call('PATCH', '/me/preferences', { workEndHour: 9 })).status, 400)
})
