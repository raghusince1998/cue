import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Not everything is a meeting or a task. "Diwali on Sunday" is a day to mark,
 * "Ravi's wedding on Saturday at 7pm" somewhere to be: read as such from the
 * words, never overdue once they have passed, never chased.
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

before(async () => {
  h = await createTestDb('happenings')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { commitmentRoutes } = await import('./commitments.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'festivals@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.register(commitmentRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'festivals@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('a festival with no time is the whole day, reminded that morning', async () => {
  const preview = await call('POST', '/quick/preview', { text: 'Diwali on sunday' })
  assert.equal(preview.body.kind, 'commitment')
  assert.equal(preview.body.commitmentKind, 'celebration')
  assert.equal(preview.body.allDay, true)
  assert.match(preview.body.summary, /all day/)
  assert.ok(!preview.body.assumptions.some((a: string) => a.includes('9am')), preview.body.assumptions.join(' | '))

  const saved = await call('POST', '/quick', { text: 'Diwali on sunday', allowConflict: true })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const [row] = await h.sql<{ kind: string; all_day: boolean; due_at: Date; ends_at: Date | null }[]>`
    select kind, all_day, due_at, ends_at from commitments where id = ${saved.body.id}`
  assert.equal(row!.kind, 'celebration')
  assert.equal(row!.all_day, true)
  assert.equal(row!.due_at.getHours(), 9)
  assert.equal(row!.ends_at!.toDateString(), row!.due_at.toDateString())
  assert.equal(row!.ends_at!.getHours(), 23)
})

test('an occasion at a time is an event, at that time', async () => {
  const preview = await call('POST', '/quick/preview', { text: 'Ravi wedding on saturday at 7pm' })
  assert.equal(preview.body.commitmentKind, 'event')
  assert.ok(!preview.body.allDay)
  assert.equal(new Date(preview.body.dueAt).getHours(), 19)
})

test('something to do for an occasion is still a task — even after Diwali was saved', async () => {
  // "Diwali" is already saved above: history must not make the errand a festival.
  const preview = await call('POST', '/quick/preview', { text: 'buy diwali sweets tomorrow' })
  assert.equal(preview.body.commitmentKind, 'task')
  assert.ok(!preview.body.allDay)
})

test('mom’s birthday every year is a day to mark, every year', async () => {
  const preview = await call('POST', '/quick/preview', { text: 'mom birthday every year on 12 march' })
  assert.equal(preview.body.kind, 'recurrence')
  assert.equal(preview.body.commitmentKind, 'celebration')
})

test('once passed, an event or a festival is not overdue; a task still is', async () => {
  const ids: Record<string, string> = {}
  for (const kind of ['celebration', 'event', 'task']) {
    const [row] = await h.sql<{ id: string }[]>`
      insert into commitments (org_id, user_id, title, kind, due_at)
      values (${me.orgId}, ${me.userId}, ${`past ${kind}`}, ${kind}, now() - interval '2 days') returning id`
    ids[kind] = row!.id
  }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime() + 86_400_000)
  const day = await call('GET', `/commitments/agenda?from=${start.toISOString()}&to=${end.toISOString()}`)
  assert.equal(day.status, 200, JSON.stringify(day.body))
  const overdue = new Set((day.body.overdue as { id: string }[]).map((c) => c.id))
  assert.ok(overdue.has(ids.task!))
  assert.ok(!overdue.has(ids.celebration!))
  assert.ok(!overdue.has(ids.event!))
})
