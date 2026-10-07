import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Finding things, and finding the right people.
 *
 * Search is low-risk to get wrong in the "misses something" direction and
 * high-risk in the "shows you another account's data" one, so that is where
 * the weight sits. Person matching carries the extra job of knowing when it
 * does not know: two plumbers is a question, not a coin toss.
 */
let h: Harness
let me: Seeded
let other: Seeded
let search: typeof import('./search.ts')
let memory: typeof import('./memory.ts')

before(async () => {
  h = await createTestDb('search')
  process.env.DATABASE_URL = h.url
  search = await import('./search.ts')
  memory = await import('./memory.ts')
  me = await seedUser(h.sql, 'search@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from commitments`
  await h.sql`delete from trips`
  await h.sql`delete from intentions`
  await h.sql`delete from contacts`
})

async function plan(title: string, notes: string | null = null, user = me) {
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, notes)
    values (${user.orgId}, ${user.userId}, ${title}, now(), ${notes})`
}

async function contact(name: string, role: string | null, phone: string | null = null, user = me) {
  await h.sql`
    insert into contacts (org_id, name, role, phone)
    values (${user.orgId}, ${name}, ${role}, ${phone})`
}

const kinds = (hits: { kind: string }[]) => [...new Set(hits.map((x) => x.kind))].sort()
const titles = (hits: { title: string }[]) => hits.map((x) => x.title)

test('a word is found wherever it lives', async () => {
  await plan('Client review', 'Volkswagen contract renewal')
  await h.sql`insert into trips (org_id, user_id, place_label, starts_on, ends_on)
              values (${me.orgId}, ${me.userId}, 'Mathura', '2026-10-06', '2026-10-08')`
  await h.sql`insert into intentions (org_id, user_id, place_label, title)
              values (${me.orgId}, ${me.userId}, 'Mathura', 'Buy peda')`
  await contact('Ramesh Yadav', 'plumber')

  const r = await search.searchEverything(me.orgId, me.userId, 'Mathura')
  assert.deepEqual(kinds(r.hits), ['intention', 'trip'])
})

test('a plan you let go is not findable', async () => {
  // Soft delete keeps the row for History. Search is the first place that
  // would quietly resurrect it if the filter were forgotten.
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, status, deleted_at)
    values (${me.orgId}, ${me.userId}, 'Deleted invoice', now(), 'deleted', now())`
  const r = await search.searchEverything(me.orgId, me.userId, 'invoice')
  assert.deepEqual(titles(r.hits), [])
})

test('a cancelled plan is still findable', async () => {
  // It still exists and is still on its day — searching for it should work.
  await h.sql`
    insert into commitments (org_id, user_id, title, due_at, status, cancelled_at)
    values (${me.orgId}, ${me.userId}, 'Cancelled standup', now(), 'cancelled', now())`
  const r = await search.searchEverything(me.orgId, me.userId, 'standup')
  assert.deepEqual(titles(r.hits), ['Cancelled standup'])
})

test('a word inside a note is found, not just a title', async () => {
  await plan('Client review', 'Volkswagen contract renewal')
  const r = await search.searchEverything(me.orgId, me.userId, 'volkswagen')
  assert.deepEqual(titles(r.hits), ['Client review'])
})

test('an exact match outranks a word buried in a note', async () => {
  await plan('Invoice', null)
  await plan('Something else', 'chase the invoice at some point')

  const r = await search.searchEverything(me.orgId, me.userId, 'invoice')
  assert.equal(r.hits[0]!.title, 'Invoice')
})

test('search is case-insensitive', async () => {
  await plan('Dentist appointment')
  const r = await search.searchEverything(me.orgId, me.userId, 'DENTIST')
  assert.equal(r.hits.length, 1)
})

test("another account's data is never returned", async () => {
  await plan('Their secret meeting', null, other)
  await contact('Their contact', null, null, other)

  const r = await search.searchEverything(me.orgId, me.userId, 'their')
  assert.deepEqual(r.hits, [])
})

test('a query too short to mean anything returns nothing', async () => {
  await plan('Anything')
  assert.deepEqual((await search.searchEverything(me.orgId, me.userId, 'a')).hits, [])
  assert.deepEqual((await search.searchEverything(me.orgId, me.userId, '  ')).hits, [])
})

// --------------------------------------------------------------- people

test('a person is found by their job, not only their name', async () => {
  await contact('Ramesh Yadav', 'plumber', '+91 98765 43210')

  const byRole = await memory.findPeople(me.orgId, 'plumber')
  assert.equal(byRole.length, 1)
  assert.equal(byRole[0]!.phone, '+91 98765 43210')

  const byName = await memory.findPeople(me.orgId, 'Ramesh')
  assert.equal(byName.length, 1)
})

test('two plumbers is a question, not a coin toss', async () => {
  await contact('Ramesh Yadav', 'plumber', '+91 1')
  await contact('Suresh Kumar', 'plumber', '+91 2')

  const people = await memory.findPeople(me.orgId, 'the plumber')
  assert.equal(people.length, 2, 'picking one would put the plan against a stranger')
})

test('an exact name sorts above a partial one', async () => {
  await contact('Ramesh', 'plumber')
  await contact('Rameshwar Plumbing Co', 'plumber')

  const people = await memory.findPeople(me.orgId, 'Ramesh')
  assert.equal(people[0]!.name, 'Ramesh')
})

test('an occupation is stored as a role, so it can be searched for', async () => {
  const made = await memory.rememberPerson(me.orgId, me.userId, 'the dentist', 'Sirsi')
  assert.equal(made.created, true)

  const [row] = await h.sql<{ name: string; role: string }[]>`
    select name, role from contacts where id = ${made.contactId}`
  assert.equal(row!.role, 'dentist', 'a job belongs in the role column, where it is findable')
  assert.match(row!.name, /dentist/i)

  // And it is findable by that word.
  assert.equal((await memory.findPeople(me.orgId, 'dentist')).length, 1)
})

test('saying "the plumber" twice does not make two of them', async () => {
  const first = await memory.rememberPerson(me.orgId, me.userId, 'the plumber', 'Kothrud')
  const second = await memory.rememberPerson(me.orgId, me.userId, 'plumber', null)

  assert.equal(second.created, false)
  assert.equal(second.contactId, first.contactId)
  assert.equal(second.placeLabel, 'Kothrud', 'and where they are is remembered')
})

test('a known name in a sentence is recognised without any marker word', async () => {
  await contact('Ramesh Yadav', 'plumber', '+91 98765 43210')

  const found = await memory.matchKnownPerson(me.orgId, 'call Ramesh Yadav tomorrow at 11am')
  assert.ok(found, 'the contact list is more reliable than guessing from capitalisation')
  assert.equal(found.phone, '+91 98765 43210')
})

test('the longer name wins when both appear', async () => {
  await contact('Ramesh', null)
  await contact('Ramesh Yadav', 'plumber')

  const found = await memory.matchKnownPerson(me.orgId, 'call Ramesh Yadav tomorrow')
  assert.equal(found?.name, 'Ramesh Yadav')
})

test('a sentence naming nobody known matches nobody', async () => {
  await contact('Ramesh Yadav', 'plumber')
  assert.equal(await memory.matchKnownPerson(me.orgId, 'buy milk tomorrow'), null)
})
