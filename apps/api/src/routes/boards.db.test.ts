import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Jobs, Hiring and Deals show only for those who picked them — or who put
 * something there anyway. "Applied to Infosys" typed by someone who never
 * picked a job hunt must not vanish into a tab they cannot see, so the
 * account says which boards have something on them.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

before(async () => {
  h = await createTestDb('boards')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { authRoutes } = await import('./auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'boards@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(authRoutes)
  await app.register(quickAddRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'boards@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('the account lists the boards with something on them', async () => {
  await h.sql`update users set uses = '{personal}' where id = ${me.userId}`
  assert.deepEqual((await call('GET', '/auth/me')).body.boards, [], 'nothing tracked yet')

  const saved = await call('POST', '/quick', { text: 'applied to Infosys for data analyst' })
  assert.equal(saved.status, 201)
  assert.equal((saved.body.tracker as { board: string }).board, 'jobs', 'the app is told which board it went on')

  const after = (await call('GET', '/auth/me')).body
  assert.deepEqual(after.boards, ['jobs'])
  assert.deepEqual(after.uses, ['personal'], 'what they picked is left as they picked it')
})
