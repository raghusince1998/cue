import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * A notification's Done and Snooze can be tapped long after the plan changed:
 * neither brings back something deleted, Snooze never reopens what is closed,
 * and Done twice keeps when it was first done.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, unknown> }
}

async function plan(title: string): Promise<string> {
  const dueAt = new Date(Date.now() + 2 * 3600_000).toISOString()
  const saved = await call('POST', '/commitments', { title, dueAt, allowConflict: true })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  return saved.body.id as string
}

before(async () => {
  h = await createTestDb('stalebuttons')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { commitmentRoutes } = await import('./commitments.ts')
  me = await seedUser(h.sql, 'stale@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(commitmentRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'stale@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('Done on a deleted plan leaves it deleted', async () => {
  const id = await plan('Send the deck')
  assert.equal((await call('DELETE', `/commitments/${id}`)).status, 200)
  assert.equal((await call('POST', `/commitments/${id}/done`)).status, 404)
  const [row] = await h.sql`select status from commitments where id = ${id}`
  assert.equal(row!.status, 'deleted')
})

test('Done twice keeps the first time', async () => {
  const id = await plan('Pay the electricity bill')
  assert.equal((await call('POST', `/commitments/${id}/done`)).status, 200)
  const [first] = await h.sql`select completed_at from commitments where id = ${id}`
  const again = await call('POST', `/commitments/${id}/done`)
  assert.equal(again.status, 200)
  assert.equal(again.body.already, true)
  const [second] = await h.sql`select completed_at from commitments where id = ${id}`
  assert.deepEqual(second!.completed_at, first!.completed_at)
})

test('Snooze reopens nothing', async () => {
  const done = await plan('Call the plumber')
  await call('POST', `/commitments/${done}/done`)
  const late = await call('POST', `/commitments/${done}/snooze`, { minutes: 15 })
  assert.equal(late.status, 409)
  assert.equal(late.body.status, 'done')

  const gone = await plan('Book the cab')
  await call('DELETE', `/commitments/${gone}`)
  assert.equal((await call('POST', `/commitments/${gone}/snooze`, { minutes: 15 })).status, 404)

  const rows = await h.sql`select id, status from commitments where id in (${done}, ${gone}) order by title`
  assert.deepEqual(
    rows.map((r) => r.status),
    ['deleted', 'done'],
  )
})

test('Snooze on an open plan moves it', async () => {
  const id = await plan('Reply to Meera')
  const res = await call('POST', `/commitments/${id}/snooze`, { minutes: 15 })
  assert.equal(res.status, 200)
  const moved = new Date(res.body.dueAt as string).getTime()
  assert.ok(Math.abs(moved - (Date.now() + 15 * 60_000)) < 60_000)
})
