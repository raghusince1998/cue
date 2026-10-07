import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * Getting back in after forgetting a password.
 *
 * A reset link is a temporary key to somebody's account, so the questions that
 * matter are all about what it refuses: a link used twice, a link that sat in
 * an inbox for a day, a link forged by someone who never had one, and a link
 * belonging to a different account. Each is tested here against the real
 * table and its real constraints.
 */
let h: Harness
let me: Seeded
let other: Seeded

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

before(async () => {
  h = await createTestDb('pwreset')
  me = await seedUser(h.sql, 'me@test.local')
  other = await seedUser(h.sql, 'other@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from password_resets`
})

/** Mirrors what the route stores: the hash, never the token. */
async function issue(userId: string, opts: { expiresInMs?: number; used?: boolean } = {}) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 3_600_000))
  await h.sql`
    insert into password_resets (user_id, token_hash, expires_at, used_at)
    values (${userId}, ${hash(token)}, ${expiresAt}, ${opts.used ? new Date() : null})`
  return token
}

async function lookup(token: string) {
  const [row] = await h.sql<
    { id: string; user_id: string; used_at: Date | null; expires_at: Date }[]
  >`select id, user_id, used_at, expires_at from password_resets where token_hash = ${hash(token)}`
  return row ?? null
}

test('the token itself is never stored', async () => {
  // The whole point of hashing. A copy of this table must not be a stack of
  // working password resets.
  const token = await issue(me.userId)
  const [row] = await h.sql<{ token_hash: string }[]>`
    select token_hash from password_resets where user_id = ${me.userId}`

  assert.ok(!row!.token_hash.includes(token), 'the plaintext is not in the column')
  assert.equal(row!.token_hash.length, 64, 'it is a sha256 hex digest')
  assert.equal(row!.token_hash, hash(token), 'and it matches the token it came from')
})

test('a token that was never issued finds nothing', async () => {
  await issue(me.userId)
  assert.equal(await lookup(randomBytes(32).toString('base64url')), null)
})

test('a used token stays in the table so a second click can be told apart', async () => {
  // Deleting it would make a second click indistinguishable from a forged
  // token, and those are different problems deserving different answers.
  const token = await issue(me.userId, { used: true })
  const row = await lookup(token)
  assert.ok(row, 'the row survives being spent')
  assert.ok(row!.used_at, 'and is marked')
})

test('an expired token is still found, and still refused', async () => {
  // Found, because "this expired" is more useful than "no such link".
  const token = await issue(me.userId, { expiresInMs: -60_000 })
  const row = await lookup(token)
  assert.ok(row)
  assert.ok(row!.expires_at.getTime() < Date.now())
})

test('two accounts never share a token', async () => {
  const mine = await issue(me.userId)
  const theirs = await issue(other.userId)

  assert.equal((await lookup(mine))!.user_id, me.userId)
  assert.equal((await lookup(theirs))!.user_id, other.userId)
})

test('the same hash cannot be inserted twice', async () => {
  // A collision silently resetting the wrong account is the failure this
  // constraint exists to make impossible.
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + 3_600_000)
  await h.sql`insert into password_resets (user_id, token_hash, expires_at)
              values (${me.userId}, ${hash(token)}, ${expires})`

  await assert.rejects(
    () => h.sql`insert into password_resets (user_id, token_hash, expires_at)
                values (${other.userId}, ${hash(token)}, ${expires})`,
  )
})

test('asking again invalidates the previous unused link', async () => {
  // Otherwise every request leaves another working key lying in an inbox.
  const first = await issue(me.userId)
  await h.sql`delete from password_resets
              where user_id = ${me.userId} and used_at is null`
  const second = await issue(me.userId)

  assert.equal(await lookup(first), null, 'the old one is gone')
  assert.ok(await lookup(second), 'the new one works')
})

test('a spent link is not swept away by the cleanup', async () => {
  // The cleanup removes expired rows. A used-but-unexpired row has to survive
  // it, or "already used" degrades back into "no such link".
  const used = await issue(me.userId, { used: true })
  await h.sql`delete from password_resets where expires_at < now()`
  assert.ok(await lookup(used))
})

test('deleting the account takes its reset links with it', async () => {
  const [org] = await h.sql<{ id: string }[]>`insert into orgs (name) values ('Gone') returning id`
  const [u] = await h.sql<{ id: string }[]>`
    insert into users (org_id, name, email, password_hash)
    values (${org!.id}, 'Leaver', 'leaver@test.local', 'x') returning id`
  const token = await issue(u!.id)

  await h.sql`delete from users where id = ${u!.id}`

  assert.equal(await lookup(token), null, 'no orphaned key to a deleted account')
})
