import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Sections show only for those whose uses need them — or who put something
 * there anyway. "Applied to Infosys" typed by someone who never picked a job
 * hunt must not vanish into a tab they cannot see, so the account says which
 * sections have something in them.
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
  h = await createTestDb('sections')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { authRoutes } = await import('./auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { meRoutes } = await import('./me.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'sections@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(authRoutes)
  await app.register(quickAddRoutes)
  await app.register(meRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'sections@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('the account lists the sections with something in them', async () => {
  await h.sql`update users set uses = '{personal}' where id = ${me.userId}`
  assert.deepEqual((await call('GET', '/auth/me')).body.filled, [], 'nothing in any yet')

  const saved = await call('POST', '/quick', { text: 'applied to Infosys for data analyst' })
  assert.equal(saved.status, 201)

  const after = (await call('GET', '/auth/me')).body
  assert.deepEqual(after.filled, ['jobs'])
  assert.deepEqual(after.uses, ['personal'], 'what they picked is left as they picked it')

  await call('POST', '/quick', { text: 'spent 250 on lunch' })
  assert.deepEqual(((await call('GET', '/me/filled')).body.filled as string[]).sort(), ['expenses', 'jobs'])
})
