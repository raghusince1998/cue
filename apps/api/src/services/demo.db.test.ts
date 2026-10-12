import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness } from '../testing/harness.ts'

/**
 * The website's "Try the demo": an account full of a realistic week, gone a
 * day later — and a real account never swept up with them.
 */
let h: Harness
let svc: typeof import('./demo.ts')

before(async () => {
  h = await createTestDb('demo')
  process.env.DATABASE_URL = h.url
  svc = await import('./demo.ts')
})

after(async () => {
  await h.close()
})

test('a demo comes with a week in it: plans, bills, a parcel, a job, money owed', async () => {
  const demo = await svc.createDemo()
  const [user] = await h.sql<{ is_demo: boolean; uses: string[] }[]>`select is_demo, uses from users where id = ${demo.userId}`
  assert.equal(user!.is_demo, true)
  const count = async (table: string) =>
    (await h.sql.unsafe(`select count(*)::int as n from ${table} where user_id = '${demo.userId}'`))[0]!.n as number
  assert.ok((await count('commitments')) > 5, 'a sample week of plans')
  assert.equal(await count('bills'), 3)
  assert.equal(await count('deliveries'), 1)
  assert.equal(await count('tracker_items'), 1)
  assert.equal(await count('money_owed'), 1)
})

test('old demos go; a real account never does', async () => {
  const real = await seedUser(h.sql, 'real@test.local')
  const fresh = await svc.createDemo()
  const old = await svc.createDemo()
  await h.sql`update users set created_at = now() - interval '25 hours' where id = ${old.userId}`
  await h.sql`update users set created_at = now() - interval '25 hours' where id = ${real.userId}`

  const removed = await svc.removeOldDemos()
  assert.ok(removed >= 1)
  const left = await h.sql<{ id: string }[]>`select id from users where id in (${real.userId}, ${fresh.userId}, ${old.userId})`
  assert.deepEqual(left.map((r) => r.id).sort(), [real.userId, fresh.userId].sort())
})

test('a handful an hour from one address', () => {
  const now = Date.now()
  for (let i = 0; i < 5; i++) assert.equal(svc.demoAllowed('203.0.113.9', now), true)
  assert.equal(svc.demoAllowed('203.0.113.9', now), false)
  assert.equal(svc.demoAllowed('198.51.100.7', now), true, 'others still can')
  assert.equal(svc.demoAllowed('203.0.113.9', now + 3_700_000), true, 'an hour later, again')
})
