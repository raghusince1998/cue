import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createTestDb, type Harness } from '../testing/harness.ts'

/**
 * The admin portal: only admins get in; sign-ins and admin actions leave a
 * trail; guessing is slowed down; an account turned off or signed out
 * everywhere stops working at once; and a person's page shows how they use
 * Cue, never what they wrote.
 */

let h: Harness
let app: FastifyInstance
let resetThrottle: () => void

const ADMIN = 'boss@test.local'
const PASSWORD = 'correct horse battery'

async function call(
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  token?: string,
  body?: Record<string, unknown>,
) {
  const res = await app.inject({
    method,
    url,
    payload: body,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'user-agent': 'AdminTest/1.0' },
  })
  return { status: res.statusCode, body: res.json() as Record<string, any> }
}

async function register(email: string, name = 'Pat') {
  const r = await call('POST', '/auth/register', undefined, { name, email, password: PASSWORD })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { token: r.body.token as string, id: r.body.user.id as string }
}

/** The trail is written without holding up the request; give it a moment. */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let last = await read()
  for (let i = 0; i < 40 && !ok(last); i++) {
    await new Promise((r) => setTimeout(r, 25))
    last = await read()
  }
  return last
}

let admin: { token: string; id: string }

before(async () => {
  h = await createTestDb('admin')
  process.env.DATABASE_URL = h.url
  const Fastify = (await import('fastify')).default
  const { env } = await import('../env.ts')
  env.adminEmails = [ADMIN]
  const { registerAuth } = await import('../auth.ts')
  const { handleError } = await import('../errors.ts')
  const { authRoutes } = await import('./auth.ts')
  const { adminRoutes } = await import('./admin.ts')
  resetThrottle = (await import('../services/throttle.ts')).resetThrottle
  app = Fastify()
  app.setErrorHandler(handleError)
  await registerAuth(app)
  await app.register(authRoutes)
  await app.register(adminRoutes)
  await app.ready()
  admin = await register(ADMIN, 'Boss')
})

beforeEach(() => resetThrottle())

after(async () => {
  await app.close()
  await h.close()
})

test('only admins get in, and to anyone else there is nothing there', async () => {
  const pat = await register('pat@test.local')
  assert.equal((await call('GET', '/admin/overview')).status, 401)
  assert.equal((await call('GET', '/admin/overview', pat.token)).status, 404)
  const ok = await call('GET', '/admin/overview', admin.token)
  assert.equal(ok.status, 200)
  assert.ok(ok.body.users.total >= 2)
  assert.equal(ok.body.days.length, 14)
})

test('sign-ins leave a trail, failures included', async () => {
  await register('sam@test.local')
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'sam@test.local', password: PASSWORD })).status, 200)
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'sam@test.local', password: 'nope-nope' })).status, 401)
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'ghost@test.local', password: 'nope-nope' })).status, 401)

  const trail = await eventually(
    async () => (await call('GET', '/admin/audit?action=auth.login', admin.token)).body.events as any[],
    (e) => e.filter((x) => x.email === 'ghost@test.local').length > 0 && e.filter((x) => x.email === 'sam@test.local').length >= 2,
  )
  const sam = trail.filter((e) => e.email === 'sam@test.local')
  assert.deepEqual(sam.map((e) => e.outcome).sort(), ['failed', 'ok'])
  assert.equal(sam.find((e) => e.outcome === 'failed').detail.reason, 'wrong_password')
  const ghost = trail.find((e) => e.email === 'ghost@test.local')
  assert.equal(ghost.detail.reason, 'no_account')
  assert.equal(ghost.user_agent, 'AdminTest/1.0')
})

test('guessing a password is cut off, even when the guess is finally right', async () => {
  await register('lee@test.local')
  for (let i = 0; i < 8; i++) {
    assert.equal((await call('POST', '/auth/login', undefined, { email: 'lee@test.local', password: `guess-${i}` })).status, 401)
  }
  const held = await call('POST', '/auth/login', undefined, { email: 'lee@test.local', password: PASSWORD })
  assert.equal(held.status, 429)
  assert.equal(held.body.error, 'too_many_attempts')

  const security = await call('GET', '/admin/security', admin.token)
  assert.ok((security.body.held as any[]).some((x) => x.rule === 'loginEmail' && x.subject === 'lee@test.local'))
})

test('turned off: tokens stop working and so does signing in; turned on again, both work', async () => {
  const kim = await register('kim@test.local')
  assert.equal((await call('GET', '/auth/me', kim.token)).status, 200)

  assert.equal((await call('POST', `/admin/users/${kim.id}/disable`, admin.token, { reason: 'abuse report' })).status, 200)
  const refused = await call('GET', '/auth/me', kim.token)
  assert.equal(refused.status, 401)
  assert.equal(refused.body.error, 'account_disabled')
  const login = await call('POST', '/auth/login', undefined, { email: 'kim@test.local', password: PASSWORD })
  assert.equal(login.status, 403)
  assert.equal(login.body.error, 'account_disabled')
  // A wrong password says nothing about the account being off.
  assert.equal((await call('POST', '/auth/login', undefined, { email: 'kim@test.local', password: 'wrong-one' })).status, 401)

  assert.equal((await call('POST', `/admin/users/${kim.id}/enable`, admin.token)).status, 200)
  assert.equal((await call('GET', '/auth/me', kim.token)).status, 200)

  const actions = await eventually(
    async () => (await call('GET', `/admin/audit?action=admin&userId=${kim.id}`, admin.token)).body.events as any[],
    (e) => e.length >= 2,
  )
  assert.deepEqual(actions.map((e) => e.action).sort(), ['admin.user_disabled', 'admin.user_enabled'])
  assert.equal(actions.find((e) => e.action === 'admin.user_disabled').actor_email, ADMIN)
})

test('signed out everywhere: older tokens are refused, a new sign-in works', async () => {
  const jo = await register('jo@test.local')
  const old = app.jwt.sign({ sub: jo.id, orgId: 'x', email: 'jo@test.local', iat: Math.floor(Date.now() / 1000) - 120 })
  assert.equal((await call('POST', `/admin/users/${jo.id}/sign-out`, admin.token)).status, 200)
  const refused = await call('GET', '/auth/me', old)
  assert.equal(refused.status, 401)
  assert.equal(refused.body.error, 'session_revoked')
  const fresh = await call('POST', '/auth/login', undefined, { email: 'jo@test.local', password: PASSWORD })
  assert.equal(fresh.status, 200)
  assert.equal((await call('GET', '/auth/me', fresh.body.token)).status, 200)
})

test('admins cannot switch themselves or each other off from here', async () => {
  const self = await call('POST', `/admin/users/${admin.id}/disable`, admin.token)
  assert.equal(self.status, 409)
  assert.equal(self.body.error, 'protected_account')
})

test('a password reset signs out every device that had the old one', async () => {
  const ana = await register('ana@test.local')
  const old = app.jwt.sign({ sub: ana.id, orgId: 'x', email: 'ana@test.local', iat: Math.floor(Date.now() / 1000) - 120 })
  const token = 'reset-token-for-ana'
  await h.sql`
    insert into password_resets (user_id, token_hash, expires_at)
    values (${ana.id}, ${createHash('sha256').update(token).digest('hex')}, now() + interval '1 hour')`
  assert.equal((await call('POST', '/auth/reset', undefined, { token, password: 'a brand new one' })).status, 200)
  assert.equal((await call('GET', '/auth/me', old)).body.error, 'session_revoked')
})

test('a person’s page: how they use Cue, never what they wrote', async () => {
  const max = await register('max@test.local')
  const [u] = await h.sql`select org_id from users where id = ${max.id}`
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, notes)
    values (${u!.org_id}, ${max.id}, 'SECRET TITLE about the divorce', 'task', now() + interval '1 day', 'PRIVATE NOTE')`

  const page = await call('GET', `/admin/users/${max.id}`, admin.token)
  assert.equal(page.status, 200)
  assert.equal(page.body.counts.plans_open, 1)
  const raw = JSON.stringify(page.body)
  assert.ok(!raw.includes('SECRET TITLE'), 'no plan titles')
  assert.ok(!raw.includes('PRIVATE NOTE'), 'no notes')
  assert.ok(!raw.includes('password'), 'nothing about the password')

  const viewed = await eventually(
    async () => (await call('GET', `/admin/audit?action=admin.user_viewed&userId=${max.id}`, admin.token)).body.events as any[],
    (e) => e.length > 0,
  )
  assert.equal(viewed[0].actor_email, ADMIN)
})

test('security and system pages answer, with their checks and jobs', async () => {
  const security = await call('GET', '/admin/security', admin.token)
  assert.equal(security.status, 200)
  assert.ok(Array.isArray(security.body.checks) && security.body.checks.length > 0)
  assert.deepEqual(security.body.admins.map((a: any) => a.email), [ADMIN])
  assert.equal(security.body.admins[0].hasAccount, true)

  const system = await call('GET', '/admin/system', admin.token)
  assert.equal(system.status, 200)
  assert.ok(Number(system.body.database.size_bytes) > 0)
  assert.ok(Array.isArray(system.body.jobs))
  assert.ok(system.body.server.uptimeSeconds >= 0)

  const people = await call('GET', '/admin/users?filter=all&q=test.local', admin.token)
  assert.equal(people.status, 200)
  assert.ok(people.body.users.some((u: any) => u.email === ADMIN && u.isAdmin))
})
