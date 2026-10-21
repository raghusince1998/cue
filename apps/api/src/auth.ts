import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import fastifyJwt from '@fastify/jwt'
import { eq } from 'drizzle-orm'
import { env } from './env.ts'
import { isAdmin } from './admins.ts'

export interface AuthClaims {
  sub: string
  orgId: string
  email: string
  /** Issued at, in seconds — set by the signer, read to honour "sign out everywhere". */
  iat?: number
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthClaims
    user: AuthClaims
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Signed in, and an admin (ADMIN_EMAILS). Anyone else gets a plain 404. */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

/**
 * Loaded on first use rather than at import: tests set DATABASE_URL to their
 * own schema before the pool is built, and this module is imported early.
 */
const database = () => import('./db/index.ts')

interface AccountState {
  email: string
  disabledAt: Date | null
  sessionsFrom: Date | null
  checkedAt: number
}

/** Each account's standing, re-read at most every half minute. */
const STATE_TTL_MS = 30_000
const states = new Map<string, AccountState>()

export async function accountState(userId: string): Promise<AccountState | null> {
  const cached = states.get(userId)
  if (cached && Date.now() - cached.checkedAt < STATE_TTL_MS) return cached
  const { db, schema } = await database()
  const [row] = await db
    .select({
      email: schema.users.email,
      disabledAt: schema.users.disabledAt,
      sessionsFrom: schema.users.sessionsFrom,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)
  if (!row) {
    states.delete(userId)
    return null
  }
  const state = { ...row, checkedAt: Date.now() }
  states.set(userId, state)
  return state
}

/** An admin changed this account: the next request reads it fresh. */
export function forgetAccountState(userId: string): void {
  states.delete(userId)
}

/** "Last active", to within a few minutes: one small write per person per five. */
const SEEN_EVERY_MS = 5 * 60_000
const seen = new Map<string, number>()

function noteSeen(userId: string): void {
  const now = Date.now()
  if (now - (seen.get(userId) ?? 0) < SEEN_EVERY_MS) return
  seen.set(userId, now)
  void database()
    .then(({ db, schema }) =>
      db.update(schema.users).set({ lastSeenAt: new Date(now) }).where(eq(schema.users.id, userId)),
    )
    .catch(() => undefined)
}

/** Why a valid token is still refused, or null when it is not. */
export function refusal(state: AccountState | null, claims: AuthClaims): 'account_disabled' | 'session_revoked' | null {
  if (!state) return null
  if (state.disabledAt) return 'account_disabled'
  // Compared in whole seconds, as the token carries them: one issued in the
  // same second as the sign-out still stands, which is the sign-in after it.
  if (state.sessionsFrom && (claims.iat ?? 0) < Math.floor(state.sessionsFrom.getTime() / 1000)) {
    return 'session_revoked'
  }
  return null
}

export async function registerAuth(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: env.jwtSecret,
    sign: { expiresIn: '30d' },
  })

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify()
    } catch {
      return reply.code(401).send({ error: 'unauthorized' })
    }
    // A token is good for 30 days; an account turned off, or signed out
    // everywhere, has to stop working before then.
    const state = await accountState(req.user.sub).catch(() => null)
    const refused = refusal(state, req.user)
    if (refused) return reply.code(401).send({ error: refused })
    noteSeen(req.user.sub)
  })

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(req, reply)
    if (reply.sent) return
    const state = await accountState(req.user.sub).catch(() => null)
    // Not "forbidden": to anyone else, there is nothing here.
    if (!state || !isAdmin(state.email)) return reply.code(404).send({ error: 'not_found' })
  })
}

/**
 * Every authenticated handler pulls its tenant from here rather than from any
 * client-supplied field, so a caller can never read across orgs by guessing an
 * id.
 */
export function scope(req: FastifyRequest): AuthClaims {
  return req.user
}
