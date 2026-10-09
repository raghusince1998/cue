import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Wishes meeting plans: several for one place become one plan with a list,
 * not a reminder each; a plan that exists takes them onto its list.
 */
let h: Harness
let me: Seeded
let other: Seeded
let svc: typeof import('./wishes.ts')

before(async () => {
  h = await createTestDb('wishes')
  process.env.DATABASE_URL = h.url
  svc = await import('./wishes.ts')
  me = await seedUser(h.sql, 'wishes@test.local')
  other = await seedUser(h.sql, 'not-mine@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from intentions`
  await h.sql`delete from trips`
})

async function wish(title: string, placeLabel: string | null, who = me): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into intentions (org_id, user_id, title, place_label) values (${who.orgId}, ${who.userId}, ${title}, ${placeLabel})
    returning id`
  return row!.id
}

async function trip(placeLabel: string): Promise<string> {
  const [row] = await h.sql<{ id: string }[]>`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on)
    values (${me.orgId}, ${me.userId}, ${placeLabel}, '2026-11-02', '2026-11-04') returning id`
  return row!.id
}

const AFTERNOON = new Date(2026, 10, 3, 15, 0)

test('several wishes for a trip are one plan with a list', async () => {
  const jaipur = await trip('Jaipur')
  const ids = [await wish('visit Hawa Mahal', 'Jaipur'), await wish('buy lakh chudi', 'Jaipur')]

  const made = await svc.planWishes(me.orgId, me.userId, { ids, dueAt: AFTERNOON, tripId: jaipur })
  assert.deepEqual({ ...made, commitmentId: undefined }, { commitmentId: undefined, title: 'Things to do in Jaipur', items: 2 })

  const [plan] = await h.sql`select title, trip_id, place_label, flexibility from commitments where id = ${made!.commitmentId}`
  assert.deepEqual({ ...plan }, { title: 'Things to do in Jaipur', trip_id: jaipur, place_label: 'Jaipur', flexibility: 'flexible' })
  const list = await h.sql`select text from checklist_items where commitment_id = ${made!.commitmentId} order by position`
  assert.deepEqual(list.map((r) => r.text), ['visit Hawa Mahal', 'buy lakh chudi'])
  const states = await h.sql`select status, commitment_id from intentions order by created_at`
  assert.ok(states.every((s) => s.status === 'scheduled' && s.commitment_id === made!.commitmentId))

  // Already on a plan: not planned twice.
  assert.equal(await svc.planWishes(me.orgId, me.userId, { ids, dueAt: AFTERNOON, tripId: jaipur }), null)
})

test('one wish on its own keeps its own name, with no list', async () => {
  const jaipur = await trip('Jaipur')
  const made = await svc.planWishes(me.orgId, me.userId, {
    ids: [await wish('visit Hawa Mahal', 'Jaipur')],
    dueAt: AFTERNOON,
    tripId: jaipur,
  })
  assert.equal(made!.title, 'visit Hawa Mahal')
  const [items] = await h.sql<{ n: number }[]>`select count(*)::int as n from checklist_items`
  assert.equal(items!.n, 0)
})

test('wishes onto a plan that exists go on the end of its list', async () => {
  const [plan] = await h.sql<{ id: string }[]>`
    insert into commitments (org_id, user_id, title, kind, due_at)
    values (${me.orgId}, ${me.userId}, 'Saturday in town', 'task', ${AFTERNOON}) returning id`
  await h.sql`insert into checklist_items (org_id, commitment_id, text, position) values (${me.orgId}, ${plan!.id}, 'pick up the suit', 0)`

  const anytime = await wish('try the new Italian place', null)
  const theirs = await wish('not my wish', null, other)
  const result = await svc.attachWishes(me.orgId, me.userId, plan!.id, [anytime, theirs])
  assert.deepEqual(result, { added: 1 }, "someone else's wish is not mine to add")

  const list = await h.sql`select text from checklist_items where commitment_id = ${plan!.id} order by position`
  assert.deepEqual(list.map((r) => r.text), ['pick up the suit', 'try the new Italian place'])

  assert.equal(await svc.attachWishes(other.orgId, other.userId, plan!.id, [theirs]), null, 'not their plan')
})
