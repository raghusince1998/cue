import { createHash, randomBytes } from 'node:crypto'
import { and, eq, lt, sql } from 'drizzle-orm'
import { db } from '../db/index.ts'
import * as schema from '../db/schema.ts'
import { decryptSecret, encryptSecret } from '../secrets.ts'
import { configFor, type Provider } from './oauthProviders.ts'

/**
 * Connecting an account at a calendar provider, and keeping it alive.
 *
 * The secret-URL import this replaces worked, but only if you could find the
 * "secret address in iCal format" buried in the provider's settings — and on a
 * managed work account that option is frequently switched off by an
 * administrator, which is exactly where it fell over. OAuth asks the person
 * rather than asking them to go hunting for a credential they may not be
 * allowed to have.
 *
 * Read-only scope, deliberately. Cue mirrors a calendar; it never writes to
 * one, and asking for permission it will not use is how a consent screen
 * teaches people to stop reading consent screens.
 *
 * Written once for every provider: what differs between Google and Microsoft is
 * a handful of endpoints and parameters, and those live in `oauthProviders.ts`.
 * Two copies of this file would drift apart the first time one was fixed.
 */

/**
 * How many calendars each of this person's accounts is being read for.
 *
 * Settings lists the accounts, and "Google · reading 2 calendars" is what
 * tells two Gmail addresses apart at a glance, and says what removing one
 * would take with it.
 */
export async function calendarCountsFor(userId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({ accountId: schema.calendarFeeds.oauthAccountId, n: sql<number>`count(*)::int` })
    .from(schema.calendarFeeds)
    .where(eq(schema.calendarFeeds.userId, userId))
    .groupBy(schema.calendarFeeds.oauthAccountId)
  const counts = new Map<string, number>()
  for (const row of rows) if (row.accountId) counts.set(row.accountId, row.n)
  return counts
}

/** A consent screen left open overnight is not a session worth resuming. */
const STATE_TTL_MS = 10 * 60 * 1000

/**
 * Refresh this far before the token actually dies.
 *
 * Without a margin, a token that expires mid-request fails the request rather
 * than the refresh — and the user sees "sync failed" for something that was
 * only ever a clock being a few seconds out.
 */
const EXPIRY_MARGIN_MS = 60 * 1000

const FETCH_TIMEOUT_MS = 15_000

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** True when the fix is "connect it again", not "try again later". */
    readonly needsReconnect = false,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Where to send the browser, and the one-time secret that proves it came back.
 *
 * PKCE is not optional here even though this is a confidential client: the
 * authorization code travels through the user's browser, and the verifier is
 * what stops a code intercepted there being redeemed by anybody else.
 */
export async function beginConsent(
  provider: Provider,
  orgId: string,
  userId: string,
): Promise<string> {
  const config = configFor(provider)
  if (!config.clientId || !config.clientSecret) {
    throw new OAuthError(`${config.label} is not configured on this server.`, 'not_configured')
  }

  const state = base64url(randomBytes(32))
  const codeVerifier = base64url(randomBytes(64))
  const challenge = base64url(createHash('sha256').update(codeVerifier).digest())

  // Housekeeping on the way past, so expired rows cannot accumulate forever.
  await db.delete(schema.oauthStates).where(lt(schema.oauthStates.expiresAt, new Date()))

  await db.insert(schema.oauthStates).values({
    state,
    provider,
    orgId,
    userId,
    codeVerifier,
    expiresAt: new Date(Date.now() + STATE_TTL_MS),
  })

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...config.extraAuthParams,
  })

  return `${config.authEndpoint}?${params.toString()}`
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

/**
 * The address inside an id_token, without verifying the signature.
 *
 * Safe only because of where this token came from: a TLS connection we opened
 * to the provider's own token endpoint, in direct response to our own request.
 * That is the one case the OpenID Connect spec allows skipping validation. An
 * id_token arriving by any other route would have to be verified properly.
 *
 * Microsoft work accounts frequently carry no `email` claim at all and put the
 * address in `preferred_username` or `upn` instead, so all three are read.
 */
function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null
  const payload = idToken.split('.')[1]
  if (!payload) return null
  try {
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf8')) as {
      email?: string
      preferred_username?: string
      upn?: string
    }
    return json.email ?? json.preferred_username ?? json.upn ?? null
  } catch {
    return null
  }
}

/**
 * Finishes the round trip: validates the state, swaps the code, stores the account.
 *
 * The state row is consumed before anything else happens. Deleting it first
 * makes a replayed callback fail on the second attempt rather than letting the
 * first one succeed twice.
 */
export async function completeConsent(
  provider: Provider,
  state: string,
  code: string,
): Promise<{ accountId: string; email: string; userId: string }> {
  const config = configFor(provider)

  const [pending] = await db
    .delete(schema.oauthStates)
    .where(and(eq(schema.oauthStates.state, state), eq(schema.oauthStates.provider, provider)))
    .returning()

  if (!pending) {
    throw new OAuthError('That sign-in link has already been used.', 'bad_state')
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    throw new OAuthError('That sign-in took too long — start again.', 'expired_state')
  }

  const res = await postForm(config.tokenEndpoint, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: pending.codeVerifier,
  })

  const body = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok || !body.access_token) {
    throw new OAuthError(
      body.error_description ?? body.error ?? `${config.label} refused the sign-in.`,
      'exchange_failed',
    )
  }

  // Without this the account reads for an hour and then stops, which is the
  // worst way for it to fail: it looks like it worked.
  if (!body.refresh_token) {
    throw new OAuthError(
      `${config.label} did not grant lasting access. Remove Cue at ${config.permissionsUrl}, then connect again.`,
      'no_refresh_token',
      true,
    )
  }

  // The honest version of "did that work". A provider can hand back less than
  // was asked for if somebody unticks a box on the consent screen, and finding
  // that out at the first sync is too late to explain why nothing imported.
  //
  // Microsoft returns the scope without its resource prefix, so the tail is
  // what gets compared rather than the whole URI.
  const wanted = config.calendarScope.split('/').pop()!
  const granted = (body.scope ?? '').split(' ')
  if (body.scope && !granted.some((s) => s === config.calendarScope || s.endsWith(wanted))) {
    throw new OAuthError(
      'Calendar access was not granted — Cue needs permission to read your calendar.',
      'scope_missing',
      true,
    )
  }

  const email = emailFromIdToken(body.id_token) ?? `${config.label} account`
  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000)

  const values = {
    orgId: pending.orgId,
    userId: pending.userId,
    provider,
    email,
    accessTokenEncrypted: encryptSecret(body.access_token),
    refreshTokenEncrypted: encryptSecret(body.refresh_token),
    expiresAt,
    scope: body.scope ?? null,
    status: 'active',
    lastError: null,
  }

  // Reconnecting the same account updates it rather than stacking duplicates,
  // and clears whatever error made them reconnect in the first place.
  const [row] = await db
    .insert(schema.oauthAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.oauthAccounts.userId,
        schema.oauthAccounts.provider,
        schema.oauthAccounts.email,
      ],
      set: values,
    })
    .returning({ id: schema.oauthAccounts.id })

  return { accountId: row!.id, email, userId: pending.userId }
}

export type AccountRow = typeof schema.oauthAccounts.$inferSelect

/**
 * A usable access token, refreshing first if the stored one is spent.
 *
 * Every provider call goes through here rather than reading the column, so
 * there is exactly one place that knows when a token has gone stale.
 */
export async function freshAccessToken(account: AccountRow): Promise<string> {
  const config = configFor(account.provider as Provider)

  const stillGood =
    account.accessTokenEncrypted &&
    account.expiresAt &&
    account.expiresAt.getTime() - EXPIRY_MARGIN_MS > Date.now()

  if (stillGood) return decryptSecret(account.accessTokenEncrypted!)

  if (!account.refreshTokenEncrypted) {
    throw new OAuthError('This account needs connecting again.', 'no_refresh_token', true)
  }

  const res = await postForm(config.tokenEndpoint, {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: decryptSecret(account.refreshTokenEncrypted),
    grant_type: 'refresh_token',
    // Microsoft requires the scope again on refresh; Google ignores it.
    scope: config.scopes.join(' '),
  })

  const body = (await res.json().catch(() => ({}))) as TokenResponse

  if (!res.ok || !body.access_token) {
    // invalid_grant means the grant is gone for good — revoked in the
    // provider's own settings, or the password changed. Retrying forever would
    // mirror nothing and say nothing, so the account is marked and the UI asks.
    const revoked = body.error === 'invalid_grant'
    await db
      .update(schema.oauthAccounts)
      .set({
        status: revoked ? 'revoked' : account.status,
        lastError: body.error_description ?? body.error ?? 'Could not refresh access.',
      })
      .where(eq(schema.oauthAccounts.id, account.id))

    throw new OAuthError(
      revoked
        ? `Access to this ${config.label} account was withdrawn. Connect it again to keep mirroring.`
        : `${config.label} would not refresh access just now.`,
      revoked ? 'revoked' : 'refresh_failed',
      revoked,
    )
  }

  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000)
  await db
    .update(schema.oauthAccounts)
    .set({
      accessTokenEncrypted: encryptSecret(body.access_token),
      expiresAt,
      // A refresh that works clears a previous failure; otherwise a stale error
      // sits on screen for an account that is now perfectly healthy.
      status: 'active',
      lastError: null,
      // Refresh tokens rotate only sometimes. Keep the old one when none comes
      // back, or the next refresh has nothing to use.
      ...(body.refresh_token ? { refreshTokenEncrypted: encryptSecret(body.refresh_token) } : {}),
    })
    .where(eq(schema.oauthAccounts.id, account.id))

  return body.access_token
}

/**
 * Hand the grant back when disconnecting, where the provider allows it.
 *
 * Deleting our row alone would stop Cue reading the calendar but leave Cue
 * listed in the person's permissions forever. Best effort: a revoke that fails
 * must not block the disconnect they actually asked for. Microsoft publishes no
 * revocation endpoint, so there the local delete is all there is and the UI
 * says where to finish the job.
 */
export async function revokeAccount(account: AccountRow): Promise<void> {
  const config = configFor(account.provider as Provider)
  if (!config.revokeEndpoint) return

  const token = account.refreshTokenEncrypted
    ? decryptSecret(account.refreshTokenEncrypted)
    : account.accessTokenEncrypted
      ? decryptSecret(account.accessTokenEncrypted)
      : null
  if (!token) return

  try {
    await postForm(config.revokeEndpoint, { token })
  } catch {
    // Disconnecting locally is what was asked for, and still happens.
  }
}
