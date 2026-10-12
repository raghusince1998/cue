import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  changePasswordInput,
  forgotPasswordInput,
  loginInput,
  registerInput,
  resetPasswordInput,
  updateProfileInput,
} from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { takeFirst } from '../db/util.ts'
import { scope } from '../auth.ts'
import { createDemo, demoAllowed } from '../services/demo.ts'
import { revokeAccount } from '../services/oauthConnect.ts'
import { env } from '../env.ts'
import { mailConfigured, MailError, resetEmail, sendMail } from '../services/mail.ts'

/** An hour: long enough to find the mail, short enough not to be a spare key. */
const RESET_TTL_MINUTES = 60

/** Stored hashed, so a copy of the table is not a stack of working resets. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = registerInput.parse(req.body)
    const email = body.email.toLowerCase().trim()

    const existing = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    if (existing.length > 0) {
      return reply.code(409).send({ error: 'email_taken' })
    }

    const passwordHash = await bcrypt.hash(body.password, 10)

    // Registering creates the tenant too. Inviting teammates into an existing
    // org comes later; this keeps the multi-tenant shape correct from day one.
    const { org, user } = await db.transaction(async (tx) => {
      // Registering still creates the tenant — the multi-tenant shape is
      // load-bearing throughout — but nobody setting up a personal planner has
      // a good answer to "what is your organisation called", so it is named
      // after them and can be changed later.
      const org = takeFirst(
        await tx.insert(schema.orgs).values({ name: `${body.name}'s account` }).returning(),
        'org',
      )
      const user = takeFirst(
        await tx
          .insert(schema.users)
          // Registering created the org, so this person owns it.
          .values({ orgId: org.id, name: body.name, email, passwordHash, role: 'owner' })
          .returning(),
        'user',
      )
      return { org, user }
    })

    const token = app.jwt.sign({ sub: user.id, orgId: org.id, email })
    return { token, user: { id: user.id, name: user.name, email }, org: { id: org.id, name: org.name } }
  })

  /**
   * Try Cue without signing up: a fresh account with a sample week in it,
   * signed in straight away, gone after a day. Limited per address, so the
   * open door is not leaned on.
   */
  app.post('/auth/demo', async (req, reply) => {
    // Behind Caddy, the visitor is the last address it appended; earlier ones
    // can be anything the visitor sent.
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const address = forwarded.at(-1) ?? req.ip
    if (!demoAllowed(address)) return reply.code(429).send({ error: 'too_many_demos' })
    const demo = await createDemo()
    const token = app.jwt.sign({ sub: demo.userId, orgId: demo.orgId, email: demo.email })
    return reply.code(201).send({ token })
  })

  /**
   * Delete my account: every plan, person, bill and connection with it.
   * Connected Google and Microsoft accounts are handed back first, so Cue
   * keeps no access. Asks for the password, except on a demo.
   */
  app.delete('/auth/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { sub, orgId } = scope(req)
    const { password } = z.object({ password: z.string().max(200).optional() }).parse(req.body ?? {})
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, sub)).limit(1)
    if (!user) return reply.code(404).send({ error: 'not_found' })
    if (!user.isDemo && !(password && (await bcrypt.compare(password, user.passwordHash)))) {
      return reply.code(403).send({ error: 'wrong_password' })
    }
    const accounts = await db.select().from(schema.oauthAccounts).where(eq(schema.oauthAccounts.userId, sub))
    for (const account of accounts) await revokeAccount(account).catch(() => undefined)

    const [others] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.users)
      .where(and(eq(schema.users.orgId, orgId), ne(schema.users.id, sub)))
    // Alone in the account: all of it goes. Otherwise only what was theirs.
    if ((others?.n ?? 0) === 0) await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId))
    else await db.delete(schema.users).where(eq(schema.users.id, sub))
    return { ok: true }
  })

  app.post('/auth/login', async (req, reply) => {
    const body = loginInput.parse(req.body)
    const email = body.email.toLowerCase().trim()

    const rows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    const user = rows[0]
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }

    const token = app.jwt.sign({ sub: user.id, orgId: user.orgId, email })
    return { token, user: { id: user.id, name: user.name, email } }
  })

  app.get('/auth/me', { onRequest: [app.authenticate] }, async (req) => {
    const { sub } = scope(req)
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        orgId: schema.users.orgId,
        orgName: schema.orgs.name,
        role: schema.users.role,
        uses: schema.users.uses,
        isDemo: schema.users.isDemo,
        /** Null when there is none; otherwise the cache key for the image URL. */
        avatarUpdatedAt: schema.users.avatarUpdatedAt,
      })
      .from(schema.users)
      .innerJoin(schema.orgs, eq(schema.orgs.id, schema.users.orgId))
      .where(eq(schema.users.id, sub))
      .limit(1)

    return takeFirst(rows, 'user')
  })

  /**
   * Ask for a reset link.
   *
   * Always answers the same way, whether or not that address has an account.
   * Replying "no such user" turns this endpoint into a way to find out who has
   * one, which is a gift to anyone working through a list of leaked addresses.
   */
  app.post('/auth/forgot', async (req, reply) => {
    const body = forgotPasswordInput.parse(req.body)
    const email = body.email.toLowerCase().trim()

    // Refusing up front is deliberate. "Check your email" for a message that
    // was never sent is worse than saying the feature is unavailable: the
    // person waits, retries, and concludes their account is broken.
    if (!mailConfigured()) {
      return reply.code(503).send({
        error: 'mail_not_configured',
        message: 'This server cannot send email yet, so password resets are unavailable.',
      })
    }

    const [user] = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    if (user) {
      // Housekeeping, and it means an older link stops working the moment a
      // newer one is asked for.
      await db
        .delete(schema.passwordResets)
        .where(
          and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt)),
        )

      const token = randomBytes(32).toString('base64url')
      await db.insert(schema.passwordResets).values({
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
        requestedIp: req.ip,
      })

      const base = (env.webOrigin || '').replace(/\/$/, '')
      const link = `${base}/reset?token=${encodeURIComponent(token)}`

      try {
        await sendMail({ ...resetEmail(link, RESET_TTL_MINUTES), to: email })
      } catch (err) {
        // Logged, not surfaced. Telling the caller the send failed would again
        // reveal that the address exists.
        if (!(err instanceof MailError)) throw err
        req.log.error({ code: err.code }, 'reset mail failed')
      }
    }

    return { ok: true }
  })

  /** Spend the link. */
  app.post('/auth/reset', async (req, reply) => {
    const body = resetPasswordInput.parse(req.body)

    // Expired rows are cleared on the way past rather than by a timer.
    await db.delete(schema.passwordResets).where(lt(schema.passwordResets.expiresAt, new Date()))

    const [row] = await db
      .select()
      .from(schema.passwordResets)
      .where(eq(schema.passwordResets.tokenHash, hashToken(body.token)))
      .limit(1)

    if (!row) {
      return reply.code(400).send({ error: 'invalid_token' })
    }
    if (row.usedAt) {
      // Distinguished from an unknown token on purpose: "already used" is
      // something the person can act on, and the token was genuine, so saying
      // so reveals nothing they did not already hold.
      return reply.code(400).send({ error: 'token_used' })
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return reply.code(400).send({ error: 'token_expired' })
    }

    const passwordHash = await bcrypt.hash(body.password, 10)
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, row.userId))
      await tx
        .update(schema.passwordResets)
        .set({ usedAt: new Date() })
        .where(eq(schema.passwordResets.id, row.id))
    })

    return { ok: true }
  })

  /** Change it while signed in, which needs the current one as proof. */
  app.post('/auth/change-password', { onRequest: app.authenticate }, async (req, reply) => {
    const { sub: userId } = scope(req)
    const body = changePasswordInput.parse(req.body)

    const [user] = await db
      .select({ passwordHash: schema.users.passwordHash })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1)
    if (!user) return reply.code(404).send({ error: 'not_found' })

    if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
      return reply.code(403).send({ error: 'wrong_password' })
    }

    await db
      .update(schema.users)
      .set({ passwordHash: await bcrypt.hash(body.password, 10) })
      .where(eq(schema.users.id, userId))

    return { ok: true }
  })

  /**
   * The avatar, as a raw body rather than multipart.
   *
   * One blob and no other fields, so multipart would buy a parser and a
   * dependency for nothing — the same call voice notes make.
   *
   * The browser resizes and re-encodes before sending, so this limit is a
   * backstop against something that skipped that, not the normal path.
   */
  const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const MAX_AVATAR_BYTES = 512 * 1024

  app.addContentTypeParser(
    AVATAR_TYPES,
    { parseAs: 'buffer', bodyLimit: MAX_AVATAR_BYTES },
    (_req, body, done) => done(null, body),
  )

  app.post('/auth/avatar', { onRequest: app.authenticate }, async (req, reply) => {
    const { sub: userId } = scope(req)

    const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
    if (!AVATAR_TYPES.includes(mime)) {
      return reply.code(415).send({ error: 'unsupported_image_type', got: mime })
    }

    const image = req.body
    if (!Buffer.isBuffer(image) || image.length === 0) {
      return reply.code(400).send({ error: 'empty_image' })
    }

    const updatedAt = new Date()
    await db
      .update(schema.users)
      .set({ avatar: image, avatarMime: mime, avatarUpdatedAt: updatedAt })
      .where(eq(schema.users.id, userId))

    return { ok: true, avatarUpdatedAt: updatedAt.toISOString() }
  })

  app.delete('/auth/avatar', { onRequest: app.authenticate }, async (req) => {
    const { sub: userId } = scope(req)
    await db
      .update(schema.users)
      .set({ avatar: null, avatarMime: null, avatarUpdatedAt: null })
      .where(eq(schema.users.id, userId))
    return { ok: true }
  })

  /**
   * Serving it.
   *
   * Authenticated like everything else: an avatar is a photograph of somebody,
   * and a URL that hands it to anyone who guesses a user id is a different
   * thing from one that does not. Cached hard because the URL changes whenever
   * the picture does.
   */
  app.get('/auth/avatar/:id', { onRequest: app.authenticate }, async (req, reply) => {
    const { orgId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const [row] = await db
      .select({ avatar: schema.users.avatar, mime: schema.users.avatarMime })
      .from(schema.users)
      // Scoped to the caller's own org, so a guessed id cannot reach across.
      .where(and(eq(schema.users.id, id), eq(schema.users.orgId, orgId)))
      .limit(1)

    if (!row?.avatar || !row.mime) return reply.code(404).send({ error: 'no_avatar' })

    return reply
      .header('content-type', row.mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .send(row.avatar)
  })

  /** Your own name and timezone. */
  app.patch('/auth/profile', { onRequest: app.authenticate }, async (req) => {
    const { sub: userId } = scope(req)
    const body = updateProfileInput.parse(req.body)

    const [row] = await db
      .update(schema.users)
      .set({
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      })
      .where(eq(schema.users.id, userId))
      .returning({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        timezone: schema.users.timezone,
      })

    return takeFirst([row], 'user')
  })
}
