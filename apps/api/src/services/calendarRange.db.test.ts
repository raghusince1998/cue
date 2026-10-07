import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * What the calendar grid is given.
 *
 * Trips live in their own table and were simply never fetched here, so a
 * planned trip was invisible on the screens whose entire job is showing what a
 * day holds. The grid was not wrong about the data it had — it was missing a
 * table.
 */
let h: Harness
let me: Seeded
let other: Seeded
let dbm: typeof import('../db/index.ts')

before(async () => {
  h = await createTestDb('calrange')
  process.env.DATABASE_URL = h.url
  dbm = await import('../db/index.ts')
  me = await seedUser(h.sql, 'range@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from trips`
  await h.sql`delete from commitments`
})

async function trip(place: string, startsOn: string, endsOn: string, user = me, status = 'planned') {
  await h.sql`
    insert into trips (org_id, user_id, place_label, starts_on, ends_on, status)
    values (${user.orgId}, ${user.userId}, ${place}, ${startsOn}, ${endsOn}, ${status})`
}

/** The same overlap test the route runs, against the real columns. */
async function tripsInRange(from: string, to: string) {
  const rows = await h.sql<{ place_label: string }[]>`
    select place_label from trips
    where user_id = ${me.userId}
      and status <> 'cancelled'
      and starts_on <= ${to}
      and ends_on >= ${from}
    order by starts_on`
  return rows.map((r) => r.place_label)
}

test('a trip inside the window is returned', async () => {
  await trip('Agra', '2026-10-02', '2026-10-04')
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-31'), ['Agra'])
})

test('a trip already under way still shows', async () => {
  // Started before the window opened: the test has to be overlap, not
  // "starts inside", or today looks free while you are away.
  await trip('Mathura', '2026-09-28', '2026-10-03')
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-07'), ['Mathura'])
})

test('a trip ending after the window still shows', async () => {
  await trip('Goa', '2026-10-30', '2026-11-05')
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-31'), ['Goa'])
})

test('a trip outside the window is not returned', async () => {
  await trip('Jaipur', '2026-12-01', '2026-12-04')
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-31'), [])
})

test('a cancelled trip is not drawn', async () => {
  await trip('Cancelled', '2026-10-02', '2026-10-04', me, 'cancelled')
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-31'), [])
})

test("another person's trip is never on your calendar", async () => {
  await trip('Theirs', '2026-10-02', '2026-10-04', other)
  assert.deepEqual(await tripsInRange('2026-10-01', '2026-10-31'), [])
})

test('a one-day trip is a trip', async () => {
  await trip('Nashik', '2026-10-05', '2026-10-05')
  assert.deepEqual(await tripsInRange('2026-10-05', '2026-10-05'), ['Nashik'])
})

/**
 * Cancelling and deleting are not the same thing, and the grid is where the
 * difference shows. Cancelling used to wipe the item off the calendar, which
 * loses the one fact worth keeping — that the slot is free, and why.
 */
async function plan(title: string, dueAt: string, status = 'pending') {
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, status)
    values (${me.orgId}, ${me.userId}, ${title}, ${dueAt}, ${status})`
}

/** The same filter the route runs, against the real columns. */
async function plansInRange(from: string, to: string) {
  const rows = await h.sql<{ title: string }[]>`
    select title from commitments
    where org_id = ${me.orgId}
      and status <> 'deleted'
      and due_at <= ${to}
      and due_at >= ${from}
    order by due_at`
  return rows.map((r) => r.title)
}

test('a cancelled plan stays on the grid', async () => {
  await plan('Cancelled standup', '2026-10-02T09:00:00Z', 'cancelled')
  assert.deepEqual(await plansInRange('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'), [
    'Cancelled standup',
  ])
})

test('a deleted plan is off the grid', async () => {
  await plan('Gone', '2026-10-02T09:00:00Z', 'deleted')
  assert.deepEqual(await plansInRange('2026-10-01T00:00:00Z', '2026-10-31T00:00:00Z'), [])
})
