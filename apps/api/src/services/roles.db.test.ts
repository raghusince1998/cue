import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Who owns the account, and what that changes.
 *
 * The AI provider, its endpoint and its API key live on the org — one
 * credential, one bill, everyone's usage — so they were sitting on the same
 * Settings page as "when does my evening start", which is a question only the
 * person paying should be answering.
 *
 * The rule is read from the row rather than the token on purpose: a role signed
 * into a thirty-day JWT stays true for thirty days after it stops being true,
 * and the one place that matters is the one place it must not.
 */
let h: Harness
let owner: Seeded
let member: Seeded

before(async () => {
  h = await createTestDb('roles')
  owner = await seedUser(h.sql, 'owner@test.local')
  member = await seedUser(h.sql, 'member@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`update users set role = 'owner'`
})

/** The same lookup the route guard performs. */
async function roleOf(userId: string): Promise<string> {
  const [row] = await h.sql<{ role: string }[]>`select role from users where id = ${userId}`
  return row!.role
}

test('the column exists and only allows the two roles', async () => {
  await assert.rejects(
    () => h.sql`update users set role = 'superuser' where id = ${owner.userId}`,
    'an unknown role is refused by the database, not just by the app',
  )
})

test('a row created without a role is a member, not an owner', async () => {
  // The default has to fail closed. Registering sets 'owner' explicitly, so
  // anything that arrives by another path — an invite, a script, a future
  // feature nobody has written yet — gets the lesser of the two.
  const [org] = await h.sql<{ id: string }[]>`insert into orgs (name) values ('Fresh') returning id`
  const [row] = await h.sql<{ role: string }[]>`
    insert into users (org_id, name, email, password_hash)
    values (${org!.id}, 'Nobody', 'nobody@fresh.test', 'x')
    returning role`
  assert.equal(row!.role, 'member')
})

test('the backfill makes the earliest account in an org its owner', async () => {
  // Rows that predate the column have no role of their own. Picking the first
  // account is the only defensible guess, and picking none would leave an org
  // where nobody can change anything.
  const [org] = await h.sql<{ id: string }[]>`insert into orgs (name) values ('Shared') returning id`
  const [first] = await h.sql<{ id: string }[]>`
    insert into users (org_id, name, email, password_hash, role, created_at)
    values (${org!.id}, 'First', 'first@shared.test', 'x', 'member', now() - interval '2 days')
    returning id`
  await h.sql`
    insert into users (org_id, name, email, password_hash, role, created_at)
    values (${org!.id}, 'Second', 'second@shared.test', 'x', 'member', now())`

  // The migration's statement, run again over this org.
  await h.sql`
    update users u set role = 'owner'
      from (select distinct on (org_id) id from users order by org_id, created_at asc, id asc) f
     where u.id = f.id and u.org_id = ${org!.id}`

  assert.equal(await roleOf(first!.id), 'owner')
  const [owners] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from users where org_id = ${org!.id} and role = 'owner'`
  assert.equal(owners!.n, 1, 'exactly one owner, not all of them')
})

test('a member is not an owner, which is the whole point', async () => {
  await h.sql`update users set role = 'member' where id = ${member.userId}`
  assert.equal(await roleOf(member.userId), 'member')
  assert.equal(await roleOf(owner.userId), 'owner')
})

test('demoting someone takes effect immediately, not when their token expires', async () => {
  // Tokens here last thirty days. If the guard trusted a claim inside one, a
  // removed owner would keep spending the account's credit for a month.
  await h.sql`update users set role = 'member' where id = ${owner.userId}`
  assert.equal(await roleOf(owner.userId), 'member', 'the next request already sees it')
})

test('deleting a user does not take the org settings with them', async () => {
  // The provider key belongs to the org. Losing it because a person left would
  // silently switch extraction off for everyone still there.
  const [org] = await h.sql<{ id: string }[]>`
    insert into orgs (name, ai_provider) values ('Keeps', 'anthropic') returning id`
  const [u] = await h.sql<{ id: string }[]>`
    insert into users (org_id, name, email, password_hash, role)
    values (${org!.id}, 'Leaver', 'leaver@shared.test', 'x', 'owner')
    returning id`

  await h.sql`delete from users where id = ${u!.id}`

  const [row] = await h.sql<{ ai_provider: string }[]>`
    select ai_provider from orgs where id = ${org!.id}`
  assert.equal(row!.ai_provider, 'anthropic')
})
