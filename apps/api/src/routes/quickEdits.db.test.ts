import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { FastifyInstance } from 'fastify'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Changing a plan by hand: the Add box's preview edited before saving wins
 * over the words, a line with no time saves once a time is picked, and a plan
 * saved for "the evening" set to 7:30 is at 7:30 — no longer "the evening".
 */

let h: Harness
let me: Seeded
let app: FastifyInstance
let token: string

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, body?: Record<string, unknown>) {
  const res = await app.inject({ method, url, payload: body, headers: { authorization: `Bearer ${token}` } })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, minute, 0, 0)
  return d
}

before(async () => {
  h = await createTestDb('quickedits')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { registerAuth } = await import('../auth.ts')
  const { quickAddRoutes } = await import('./quickAdd.ts')
  const { commitmentRoutes } = await import('./commitments.ts')
  const { env } = await import('../env.ts')
  env.captureAiKey = ''
  me = await seedUser(h.sql, 'edits@test.local')
  app = Fastify()
  await registerAuth(app)
  await app.register(quickAddRoutes)
  await app.register(commitmentRoutes)
  await app.ready()
  token = app.jwt.sign({ sub: me.userId, orgId: me.orgId, email: 'edits@test.local' })
})

after(async () => {
  await app.close()
  await h.close()
})

test('the preview, changed before saving: title, day, time and length as set', async () => {
  const preview = await call('POST', '/quick/preview', { text: 'gym tomorrow evening' })
  assert.equal(preview.body.kind, 'commitment')
  assert.ok(preview.body.dueAt, 'the preview says when, for the editor to start from')

  const at = tomorrowAt(19, 30)
  const saved = await call('POST', '/quick', {
    text: 'gym tomorrow evening',
    allowConflict: true,
    edits: { title: 'Gym — leg day', dueAt: at.toISOString(), durationMinutes: 90, flexibility: 'fixed', preferredWindow: null },
  })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const plan = (await call('GET', `/commitments/${saved.body.id}`)).body
  assert.equal(plan.title, 'Gym — leg day')
  assert.equal(new Date(plan.dueAt).getTime(), at.getTime())
  assert.equal(plan.durationMinutes, 90)
  assert.equal(plan.flexibility, 'fixed')
  assert.equal(plan.preferredWindow, null)
})

test('a line with no time saves once a time is picked by hand', async () => {
  const preview = await call('POST', '/quick/preview', { text: 'dentist appointment' })
  assert.equal(preview.body.kind, 'needsTime')
  const without = await call('POST', '/quick', { text: 'dentist appointment' })
  assert.equal(without.status, 428)

  const at = tomorrowAt(11)
  const saved = await call('POST', '/quick', {
    text: 'dentist appointment',
    allowConflict: true,
    edits: { dueAt: at.toISOString() },
  })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const plan = (await call('GET', `/commitments/${saved.body.id}`)).body
  assert.equal(new Date(plan.dueAt).getTime(), at.getTime())
  assert.equal(plan.flexibility, 'fixed')
})

test('"any time in the evening" can be chosen by hand too', async () => {
  const at = tomorrowAt(17)
  const saved = await call('POST', '/quick', {
    text: 'call the bank tomorrow 4pm',
    allowConflict: true,
    edits: { dueAt: at.toISOString(), flexibility: 'flexible', preferredWindow: 'evening' },
  })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const plan = (await call('GET', `/commitments/${saved.body.id}`)).body
  assert.equal(plan.flexibility, 'flexible')
  assert.equal(plan.preferredWindow, 'evening')
})

test('a plan saved for the evening, set to 7:30, is at 7:30', async () => {
  const saved = await call('POST', '/quick', { text: 'walk the dog tomorrow evening', allowConflict: true })
  assert.equal(saved.status, 201, JSON.stringify(saved.body))
  const id = saved.body.id as string
  // Saved however the words read it; then set to a time by hand.
  await h.sql`update commitments set flexibility = 'flexible', preferred_window = 'evening' where id = ${id}`

  const at = tomorrowAt(19, 30)
  const edited = await call('PATCH', `/commitments/${id}`, {
    dueAt: at.toISOString(),
    flexibility: 'fixed',
    preferredWindow: null,
    allowConflict: true,
  })
  assert.equal(edited.status, 200, JSON.stringify(edited.body))
  const plan = (await call('GET', `/commitments/${id}`)).body
  assert.equal(new Date(plan.dueAt).getTime(), at.getTime())
  assert.equal(plan.flexibility, 'fixed')
  assert.equal(plan.preferredWindow, null)
})
