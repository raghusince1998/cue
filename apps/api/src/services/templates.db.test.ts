import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { STARTER_TEMPLATES } from '@cue/shared'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/** Quick messages: each person's own, the most sent first, starters added once. */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./templates.ts')

before(async () => {
  h = await createTestDb('templates')
  process.env.DATABASE_URL = h.url
  svc = await import('./templates.ts')
  me = await seedUser(h.sql, 'templates@test.local')
  other = await seedUser(h.sql, 'someone-else@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from message_templates`
})

test('the starters are added once, however many times they are asked for', async () => {
  await svc.createTemplate(me.orgId, me.userId, { title: 'missed your call', body: 'My own version' })
  await svc.addStarters(me.orgId, me.userId)
  const list = await svc.addStarters(me.orgId, me.userId)
  assert.equal(list.length, STARTER_TEMPLATES.length, 'one each, and mine kept instead of the starter')
  assert.equal(list.find((t) => t.title === 'missed your call')!.body, 'My own version')
})

test('the ones actually sent come first', async () => {
  const a = await svc.createTemplate(me.orgId, me.userId, { title: 'A', body: 'a' })
  const b = await svc.createTemplate(me.orgId, me.userId, { title: 'B', body: 'b' })
  const c = await svc.createTemplate(me.orgId, me.userId, { title: 'C', body: 'c' })
  await svc.markUsed(me.userId, c.id, new Date(2026, 9, 9, 10))
  await svc.markUsed(me.userId, b.id, new Date(2026, 9, 9, 11))
  await svc.markUsed(me.userId, c.id, new Date(2026, 9, 9, 12))
  assert.deepEqual((await svc.listTemplates(me.userId)).map((t) => t.title), ['C', 'B', 'A'])
  assert.equal((await svc.listTemplates(me.userId))[0]!.uses, 2)
  void a
})

test("someone else's messages are not yours to see, change or delete", async () => {
  const mine = await svc.createTemplate(me.orgId, me.userId, { title: 'Mine', body: 'x' })
  assert.deepEqual(await svc.listTemplates(other.userId), [])
  assert.equal(await svc.updateTemplate(other.userId, mine.id, { title: 'Theirs', body: 'y' }), null)
  assert.equal(await svc.deleteTemplate(other.userId, mine.id), false)
  assert.equal(await svc.markUsed(other.userId, mine.id), false)
  assert.equal((await svc.listTemplates(me.userId))[0]!.title, 'Mine')

  assert.equal((await svc.updateTemplate(me.userId, mine.id, { title: 'Renamed', body: 'z' }))!.title, 'Renamed')
  assert.equal(await svc.deleteTemplate(me.userId, mine.id), true)
  assert.deepEqual(await svc.listTemplates(me.userId), [])
})
