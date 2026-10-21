import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env.ts'

/**
 * The admin portal's sign-in: one email and password from the server's .env
 * (ADMIN_EMAIL, ADMIN_PASSWORD), not a Cue account — so it works without
 * reset email, and a user's session can never open it.
 *
 * Its session token is signed with its own key, derived from the JWT secret
 * and the admin credentials: a user's token is not valid here, an admin's is
 * not valid in the app, and changing the password ends every admin session.
 */

export const ADMIN_MIN_PASSWORD = 12
export const ADMIN_SESSION_HOURS = 12

export type AdminSetup = 'ok' | 'not_configured' | 'password_too_short'

export function adminSetup(): AdminSetup {
  if (!env.adminEmail || !env.adminPassword) return 'not_configured'
  if (env.adminPassword.length < ADMIN_MIN_PASSWORD) return 'password_too_short'
  return 'ok'
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/** Equal, in the same time either way: no clue from how long a wrong guess took. */
function same(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

export function credentialsMatch(email: string, password: string): boolean {
  if (adminSetup() !== 'ok') return false
  // Both compared, always, so a right email with a wrong password takes as
  // long as a wrong email.
  const emailOk = same(email.trim().toLowerCase(), env.adminEmail)
  const passwordOk = same(password, env.adminPassword)
  return emailOk && passwordOk
}

function key(): Buffer {
  return createHmac('sha256', env.jwtSecret).update(`cue-admin\n${env.adminEmail}\n${env.adminPassword}`).digest()
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function signAdminToken(now = Date.now()): { token: string; expiresAt: string } {
  const exp = now + ADMIN_SESSION_HOURS * 3_600_000
  const body = b64(JSON.stringify({ adm: env.adminEmail, iat: now, exp }))
  const sig = b64(createHmac('sha256', key()).update(body).digest())
  return { token: `${body}.${sig}`, expiresAt: new Date(exp).toISOString() }
}

/** The admin's email when the token is good, null otherwise. */
export function verifyAdminToken(token: string, now = Date.now()): string | null {
  if (adminSetup() !== 'ok') return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  const expected = b64(createHmac('sha256', key()).update(body).digest())
  if (!same(sig, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { adm?: string; exp?: number }
    if (claims.adm !== env.adminEmail || typeof claims.exp !== 'number' || claims.exp <= now) return null
    return claims.adm
  } catch {
    return null
  }
}
