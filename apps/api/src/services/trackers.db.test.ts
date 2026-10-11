import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Trackers: items move through their board's stages with a history, each
 * one's next step is a linked plan, and an item left with nothing booked for
 * too long is noticed.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./trackers.ts')

before(async () => {
  h = await createTestDb('trackers')
  process.env.DATABASE_URL = h.url
  svc = await import('./trackers.ts')
  me = await seedUser(h.sql, 'trackers@test.local')
  other = await seedUser(h.sql, 'trackers-other@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from tracker_items`
})

async function plan(itemId: string, title: string, dueAt: string, status = 'pending') {
  await h.sql`
    insert into commitments (org_id, user_id, title, kind, due_at, status, tracker_item_id)
    values (${me.orgId}, ${me.userId}, ${title}, 'meeting', ${dueAt}, ${status}, ${itemId})`
}

test('stages move with a history, and closing stamps it closed', async () => {
  const job = await svc.createItem(me.orgId, me.userId, 'jobs', { title: ' Infosys ', detail: 'Data analyst' })
  assert.ok(job !== 'unknown_stage')
  assert.equal(job.stage, 'applied', 'the board’s starting stage')
  assert.equal(job.title, 'Infosys')
  assert.equal(await svc.createItem(me.orgId, me.userId, 'jobs', { title: 'X', stage: 'hired' }), 'unknown_stage', 'a hiring stage')

  assert.equal(await svc.updateItem(other.orgId, other.userId, job.id, { stage: 'offer' }), 'not_found')
  const moved = await svc.updateItem(me.orgId, me.userId, job.id, { stage: 'interview', notes: ' Two rounds ' })
  assert.ok(typeof moved === 'object')
  assert.equal(moved.stage, 'interview')
  assert.equal(moved.notes, 'Two rounds')
  assert.equal(moved.closedAt, null)

  const done = await svc.updateItem(me.orgId, me.userId, job.id, { stage: 'rejected' })
  assert.ok(typeof done === 'object' && done.closedAt, 'closed')
  const history = await svc.itemHistory(me.userId, job.id)
  assert.deepEqual(
    history!.events.map((e) => [e.from, e.to]),
    [
      [null, 'applied'],
      ['applied', 'interview'],
      ['interview', 'rejected'],
    ],
  )
  assert.equal(await svc.itemHistory(other.userId, job.id), null)
})

test('the next step is the soonest open plan, and with none it can go quiet', async () => {
  // A minute on, so 'nine days ago' in the database is nine whole days before it.
  const now = new Date(Date.now() + 60_000)
  const job = (await svc.createItem(me.orgId, me.userId, 'jobs', { title: 'Swiggy' })) as { id: string }
  await h.sql`update tracker_items set stage_changed_at = now() - interval '9 days' where id = ${job.id}`

  let [item] = await svc.boardItems(me.userId, 'jobs', now)
  assert.equal(item!.next, null)
  assert.equal(item!.quietDays, 9)
  assert.deepEqual((await svc.quietItems(me.userId, now)).map((i) => i.title), ['Swiggy'])

  await plan(job.id, 'Second round', new Date(Date.now() + 3 * 86_400_000).toISOString())
  await plan(job.id, 'Send portfolio', new Date(Date.now() + 86_400_000).toISOString())
  await plan(job.id, 'Old call', new Date(Date.now() - 86_400_000).toISOString(), 'done')
  ;[item] = await svc.boardItems(me.userId, 'jobs', now)
  assert.equal(item!.next!.title, 'Send portfolio')
  assert.equal(item!.quietDays, null, 'something is booked')
  assert.deepEqual(await svc.quietItems(me.userId, now), [])
  assert.equal((await svc.itemHistory(me.userId, job.id))!.plans.length, 3)
})

test('a board lists open items by stage, then the closed, newest first', async () => {
  const make = async (title: string, stage: string) => (await svc.createItem(me.orgId, me.userId, 'hiring', { title, stage })) as { id: string }
  await make('Arjun', 'interview')
  await make('Priya', 'new')
  await make('Meera', 'hired')
  await make('Kabir', 'screening')
  await svc.createItem(other.orgId, other.userId, 'hiring', { title: 'Not mine' })
  assert.deepEqual((await svc.boardItems(me.userId, 'hiring')).map((i) => i.title), ['Priya', 'Kabir', 'Arjun', 'Meera'])
  assert.deepEqual(await svc.openCounts(me.userId), { hiring: 3 })
})

test('the one open item a line is about', async () => {
  await svc.createItem(me.orgId, me.userId, 'jobs', { title: 'Infosys' })
  await svc.createItem(me.orgId, me.userId, 'jobs', { title: 'Tata Motors' })
  await svc.createItem(me.orgId, me.userId, 'deals', { title: 'Tata Steel', stage: 'lost' })
  assert.equal((await svc.itemMentionedIn(me.userId, 'interview at infosys friday 11am'))!.title, 'Infosys')
  assert.equal(await svc.itemMentionedIn(me.userId, 'call about Tata Steel'), null, 'closed')
  assert.equal(await svc.itemMentionedIn(me.userId, 'lunch friday'), null)
  assert.equal(await svc.itemMentionedIn(other.userId, 'interview at Infosys'), null, 'not theirs')
})
