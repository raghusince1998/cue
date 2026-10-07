import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createTestDb, seedUser, type Harness, type Seeded } from '../testing/harness.ts'

/**
 * The half of OAuth that has to be right.
 *
 * The callback is a bare browser redirect carrying no credential of ours, so
 * the state parameter is the only thing tying it to whoever started the flow.
 * If it can be replayed, guessed, or used after the fact, that is how somebody
 * else's calendar gets attached to your account — so that is what is tested
 * here. The token exchange itself needs Google and is not faked: these tests
 * exercise the checks that run *before* any network call.
 */
let h: Harness
let me: Seeded
let other: Seeded
let auth: typeof import('./oauthConnect.ts')

before(async () => {
  h = await createTestDb('googleauth')
  process.env.DATABASE_URL = h.url
  // Read at module load, so they have to be set before the import.
  process.env.GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
  process.env.GOOGLE_REDIRECT_URI = 'https://example.test/api/oauth/google/callback'
  process.env.MICROSOFT_CLIENT_ID = 'test-ms-client-id'
  process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret'
  process.env.MICROSOFT_REDIRECT_URI = 'https://example.test/api/oauth/microsoft/callback'
  process.env.ENCRYPTION_KEY ||= 'a'.repeat(64)
  auth = await import('./oauthConnect.ts')
  me = await seedUser(h.sql, 'google@test.local')
  other = await seedUser(h.sql, 'notme@test.local')
})

after(async () => {
  await h.close()
})

beforeEach(async () => {
  await h.sql`delete from oauth_states`
  await h.sql`delete from oauth_accounts`
})

const stateOf = (url: string) => new URL(url).searchParams.get('state')!

test('the consent URL carries everything Google needs', async () => {
  const url = new URL(await auth.beginConsent('google', me.orgId, me.userId))

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assert.equal(url.searchParams.get('client_id'), 'test-client-id')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://example.test/api/oauth/google/callback')
})

test('it asks only to read, never to write', async () => {
  // A consent screen asking for more than the app uses is how people learn to
  // stop reading consent screens.
  const url = new URL(await auth.beginConsent('google', me.orgId, me.userId))
  const scopes = (url.searchParams.get('scope') ?? '').split(' ')

  assert.ok(scopes.includes('https://www.googleapis.com/auth/calendar.readonly'))
  assert.ok(
    !scopes.some((s) => s === 'https://www.googleapis.com/auth/calendar'),
    'never the read-write calendar scope',
  )
})

test('offline access is requested, or it works for an hour and then stops', async () => {
  const url = new URL(await auth.beginConsent('google', me.orgId, me.userId))
  assert.equal(url.searchParams.get('access_type'), 'offline')
  // Google hands back a refresh token only on a fresh grant. Without this,
  // reconnecting after a revoke yields an account that dies in an hour.
  assert.equal(url.searchParams.get('prompt'), 'consent')
})

test('PKCE is used, and the verifier never leaves the server', async () => {
  const url = new URL(await auth.beginConsent('google', me.orgId, me.userId))
  const challenge = url.searchParams.get('code_challenge')

  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(challenge && challenge.length > 20)

  const [row] = await h.sql<{ code_verifier: string }[]>`
    select code_verifier from oauth_states where state = ${stateOf(url.toString())}`
  assert.ok(row!.code_verifier.length >= 43, 'a real verifier is stored')
  assert.notEqual(row!.code_verifier, challenge, 'the challenge is a hash, not the verifier')
})

test('two flows never share a state', async () => {
  const a = stateOf(await auth.beginConsent('google', me.orgId, me.userId))
  const b = stateOf(await auth.beginConsent('google', me.orgId, me.userId))
  assert.notEqual(a, b)
})

test('an unknown state is refused', async () => {
  await assert.rejects(
    () => auth.completeConsent('google', 'never-issued', 'some-code'),
    (err: Error) => (err as { code?: string }).code === 'bad_state',
  )
})

test('a state cannot be used twice', async () => {
  // Replay is the attack this exists to stop: a callback captured once must
  // not keep working.
  const state = stateOf(await auth.beginConsent('google', me.orgId, me.userId))

  // The first attempt consumes the state and then fails at the network, which
  // is expected — there is no Google here. What matters is that it is gone.
  await auth.completeConsent('google', state, 'code-1').catch(() => undefined)

  await assert.rejects(
    () => auth.completeConsent('google', state, 'code-2'),
    (err: Error) => (err as { code?: string }).code === 'bad_state',
  )
})

test('a stale state is refused rather than honoured', async () => {
  const state = stateOf(await auth.beginConsent('google', me.orgId, me.userId))
  await h.sql`update oauth_states set expires_at = now() - interval '1 minute' where state = ${state}`

  await assert.rejects(
    () => auth.completeConsent('google', state, 'code'),
    (err: Error) => (err as { code?: string }).code === 'expired_state',
  )
})

test('expired states are cleared out rather than accumulating', async () => {
  const stale = stateOf(await auth.beginConsent('google', me.orgId, me.userId))
  await h.sql`update oauth_states set expires_at = now() - interval '1 hour' where state = ${stale}`

  await auth.beginConsent('google', me.orgId, me.userId)

  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from oauth_states where state = ${stale}`
  assert.equal(row!.n, 0)
})

test('the state remembers whose flow it is', async () => {
  // Without this the callback has no way to know which account to attach the
  // calendar to, and guessing is not an option.
  const mine = stateOf(await auth.beginConsent('google', me.orgId, me.userId))
  const theirs = stateOf(await auth.beginConsent('google', other.orgId, other.userId))

  const rows = await h.sql<{ state: string; user_id: string }[]>`
    select state, user_id from oauth_states where state in (${mine}, ${theirs})`

  assert.equal(rows.find((r) => r.state === mine)!.user_id, me.userId)
  assert.equal(rows.find((r) => r.state === theirs)!.user_id, other.userId)
})

test('a stored token is not readable from the column', async () => {
  // A refresh token is a standing grant to read somebody's calendar. Anyone
  // who reaches the database must not come away with one.
  const secrets = await import('../secrets.ts')
  const token = '1//0ethisisarefreshtokenvalue'

  await h.sql`
    insert into oauth_accounts (org_id, user_id, provider, email, refresh_token_encrypted)
    values (${me.orgId}, ${me.userId}, 'google', 'a@b.test', ${secrets.encryptSecret(token)})`

  const [row] = await h.sql<{ refresh_token_encrypted: string }[]>`
    select refresh_token_encrypted from oauth_accounts where user_id = ${me.userId}`

  assert.ok(!row!.refresh_token_encrypted.includes(token), 'the plaintext is not in there')
  assert.ok(!row!.refresh_token_encrypted.includes('refreshtoken'), 'nor any readable part of it')
  assert.equal(secrets.decryptSecret(row!.refresh_token_encrypted), token, 'and it round-trips')
})

test('the same token encrypts differently every time', async () => {
  // A fixed nonce would let anyone holding the table see which two accounts
  // share a credential.
  const secrets = await import('../secrets.ts')
  const a = secrets.encryptSecret('same-token')
  const b = secrets.encryptSecret('same-token')
  assert.notEqual(a, b)
  assert.equal(secrets.decryptSecret(a), secrets.decryptSecret(b))
})

test('the same account reconnecting updates rather than duplicating', async () => {
  for (let i = 0; i < 2; i++) {
    await h.sql`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${me.orgId}, ${me.userId}, 'google', 'same@b.test')
      on conflict (user_id, provider, email) do update set status = 'active'`
  }
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from oauth_accounts where user_id = ${me.userId}`
  assert.equal(row!.n, 1)
})

/**
 * Microsoft, which differs in exactly the places it is easy to get wrong.
 *
 * There is no `access_type` parameter — a refresh token comes from the
 * `offline_access` *scope* instead, and leaving it out produces a connection
 * that works for an hour and then quietly stops. That is the failure these
 * pin down.
 */
test('Microsoft asks the right endpoint with the right client', async () => {
  const url = new URL(await auth.beginConsent('microsoft', me.orgId, me.userId))

  assert.match(url.origin + url.pathname, /login\.microsoftonline\.com/)
  assert.match(url.pathname, /\/oauth2\/v2\.0\/authorize$/)
  assert.equal(url.searchParams.get('client_id'), 'test-ms-client-id')
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://example.test/api/oauth/microsoft/callback',
  )
})

test('Microsoft asks for offline_access, or the link dies after an hour', async () => {
  const url = new URL(await auth.beginConsent('microsoft', me.orgId, me.userId))
  const scopes = (url.searchParams.get('scope') ?? '').split(' ')

  // Microsoft has no access_type parameter; this scope is the whole mechanism.
  assert.ok(scopes.includes('offline_access'), 'offline_access is requested')
  assert.ok(scopes.includes('https://graph.microsoft.com/Calendars.Read'))
})

test('Microsoft is asked only to read calendars', async () => {
  const url = new URL(await auth.beginConsent('microsoft', me.orgId, me.userId))
  const scopes = (url.searchParams.get('scope') ?? '').split(' ')

  assert.ok(
    !scopes.some((s) => /Calendars\.ReadWrite/i.test(s)),
    'never the read-write calendar scope',
  )
  assert.ok(!scopes.some((s) => /Mail\./i.test(s)), 'and never mail')
})

test('Microsoft uses PKCE too', async () => {
  const url = new URL(await auth.beginConsent('microsoft', me.orgId, me.userId))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok((url.searchParams.get('code_challenge') ?? '').length > 20)
})

test('a state issued for one provider is not accepted by the other', async () => {
  // Otherwise a callback from one provider could redeem a flow begun for
  // another, which is a confused-deputy waiting to happen.
  const msState = new URL(await auth.beginConsent('microsoft', me.orgId, me.userId)).searchParams.get(
    'state',
  )!

  await assert.rejects(
    () => auth.completeConsent('google', msState, 'code'),
    (err: Error) => (err as { code?: string }).code === 'bad_state',
  )
})

test('the same address at two providers is two accounts', async () => {
  // One person's work address can exist at both, and they are not the same
  // calendar. The uniqueness constraint has to include the provider.
  for (const provider of ['google', 'microsoft']) {
    await h.sql`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${me.orgId}, ${me.userId}, ${provider}, 'both@okruti.com')`
  }
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from oauth_accounts where email = 'both@okruti.com'`
  assert.equal(row!.n, 2)
})

/**
 * One app registration, many people, many mailboxes.
 *
 * The client id and secret identify Cue, not an account — so the thing that
 * has to be true is that every *grant* is separate: scoped to the person who
 * gave it, never shared, never visible across accounts. These pin that down,
 * because getting it wrong would mean one person's calendar appearing in
 * somebody else's planner.
 */
test('one person can connect several mailboxes at the same provider', async () => {
  for (const email of ['personal@gmail.com', 'work@okruti.com']) {
    await h.sql`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${me.orgId}, ${me.userId}, 'google', ${email})`
  }
  const rows = await h.sql<{ email: string }[]>`
    select email from oauth_accounts where user_id = ${me.userId} order by email`
  assert.deepEqual(
    rows.map((r) => r.email),
    ['personal@gmail.com', 'work@okruti.com'],
  )
})

test('two people connecting the same mailbox get their own grant', async () => {
  // A shared team address is the obvious case. One revoking it must not take
  // the other's access with it, so they cannot be the same row.
  for (const who of [me, other]) {
    await h.sql`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${who.orgId}, ${who.userId}, 'google', 'shared@okruti.com')`
  }
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from oauth_accounts where email = 'shared@okruti.com'`
  assert.equal(row!.n, 2)
})

test('the same mailbox connected twice by one person updates, never duplicates', async () => {
  for (let i = 0; i < 3; i++) {
    await h.sql`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${me.orgId}, ${me.userId}, 'google', 'again@gmail.com')
      on conflict (user_id, provider, email) do update set status = 'active'`
  }
  const [row] = await h.sql<{ n: number }[]>`
    select count(*)::int as n from oauth_accounts where user_id = ${me.userId}`
  assert.equal(row!.n, 1)
})

test('a consent round trip is bound to the person who began it', async () => {
  // The callback carries no credential of ours, so the state row is the only
  // thing deciding whose account the calendar lands on. If this were guessable
  // or shared, one person's consent could attach to another's planner.
  const mine = new URL(await auth.beginConsent('google', me.orgId, me.userId)).searchParams.get(
    'state',
  )!
  const theirs = new URL(
    await auth.beginConsent('google', other.orgId, other.userId),
  ).searchParams.get('state')!

  const rows = await h.sql<{ state: string; user_id: string; org_id: string }[]>`
    select state, user_id, org_id from oauth_states where state in (${mine}, ${theirs})`

  const a = rows.find((r) => r.state === mine)!
  const b = rows.find((r) => r.state === theirs)!
  assert.equal(a.user_id, me.userId)
  assert.equal(b.user_id, other.userId)
  assert.notEqual(a.org_id, b.org_id)
})

test('each account says how many of its calendars are being read, and only its own', async () => {
  await h.sql`delete from calendar_feeds`
  const account = async (who: Seeded, email: string) => {
    const [row] = await h.sql<{ id: string }[]>`
      insert into oauth_accounts (org_id, user_id, provider, email)
      values (${who.orgId}, ${who.userId}, 'google', ${email}) returning id`
    return row!.id
  }
  const read = async (who: Seeded, accountId: string, name: string) => {
    await h.sql`
      insert into calendar_feeds (org_id, user_id, label, source, oauth_account_id, external_calendar_id)
      values (${who.orgId}, ${who.userId}, ${name}, 'google', ${accountId}, ${name})`
  }

  const work = await account(me, 'work@okruti.com')
  const personal = await account(me, 'personal@gmail.com')
  const theirs = await account(other, 'theirs@gmail.com')
  await read(me, work, 'Work')
  await read(me, work, 'Holidays')
  await read(other, theirs, 'Theirs')

  const counts = await auth.calendarCountsFor(me.userId)
  assert.equal(counts.get(work), 2)
  // Connected but nothing chosen yet: absent, which the route reads as 0.
  assert.equal(counts.get(personal), undefined)
  // Somebody else's account never appears in my counts.
  assert.equal(counts.has(theirs), false)
})
