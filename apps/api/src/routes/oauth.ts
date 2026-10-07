import type { FastifyInstance } from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { scope } from '../auth.ts'
import { env } from '../env.ts'
import {
  beginConsent,
  calendarCountsFor,
  completeConsent,
  OAuthError,
  revokeAccount,
  type AccountRow,
} from '../services/oauthConnect.ts'
import { configFor, isProvider, providerConfigured, PROVIDERS, type Provider } from '../services/oauthProviders.ts'
import { GoogleCalendarError, listCalendars } from '../services/googleCalendar.ts'
import { listMicrosoftCalendars, MicrosoftCalendarError } from '../services/microsoftCalendar.ts'
import { FeedError, syncFeed } from '../services/calendarFeed.ts'

/**
 * Connecting Google and Microsoft calendars.
 *
 * One set of routes for both, because the round trip is identical and only the
 * endpoints differ. Everything is authenticated except the callback, which
 * cannot be: it arrives as a plain browser redirect carrying no header of ours.
 * The `state` parameter is what ties it back to whoever started the flow, which
 * is why it is single-use and stored server side rather than signed into a URL.
 */

function accountDTO(row: AccountRow, calendarCount = 0) {
  return {
    id: row.id,
    provider: row.provider,
    email: row.email,
    status: row.status,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    /** How many of its calendars are being read, so the list can say so. */
    calendarCount,
  }
}

/**
 * Back to the app with a one-word outcome.
 *
 * Deliberately a fixed code rather than the error text: this value is read
 * straight out of a URL the user's browser was sent to by a third party, and
 * reflecting arbitrary strings into the page is how that becomes someone
 * else's message on your screen. The app maps the code to its own wording.
 *
 * The root, because Settings is a modal rather than a route — the app reads
 * this parameter on load and opens it.
 */
function back(outcome: string): string {
  const base = (env.webOrigin || '').replace(/\/$/, '')
  return `${base}/?connected=${encodeURIComponent(outcome)}`
}

async function calendarsOf(account: AccountRow) {
  return account.provider === 'microsoft'
    ? listMicrosoftCalendars(account)
    : listCalendars(account)
}

export async function oauthRoutes(app: FastifyInstance) {
  const authed = { onRequest: app.authenticate }

  const providerParam = z.object({
    provider: z.string().refine(isProvider, 'unknown provider'),
  })

  /** Which providers this server can offer, and what is already connected. */
  app.get('/oauth/status', authed, async (req) => {
    const { sub: userId } = scope(req)
    const accounts = await db
      .select()
      .from(schema.oauthAccounts)
      .where(eq(schema.oauthAccounts.userId, userId))
      .orderBy(asc(schema.oauthAccounts.createdAt))

    const countOf = await calendarCountsFor(userId)

    return {
      providers: PROVIDERS.map((p) => ({
        id: p,
        label: configFor(p).label,
        configured: providerConfigured(p),
      })),
      accounts: accounts.map((a) => accountDTO(a, countOf.get(a.id) ?? 0)),
    }
  })

  /** Where to send the browser. The server keeps the matching secret. */
  app.post('/oauth/:provider/connect', authed, async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { provider } = providerParam.parse(req.params) as { provider: Provider }

    if (!providerConfigured(provider)) {
      const config = configFor(provider)
      return reply.code(503).send({
        error: 'not_configured',
        message: `This server has no ${config.label} credentials set.`,
      })
    }
    try {
      return { url: await beginConsent(provider, orgId, userId) }
    } catch (err) {
      if (err instanceof OAuthError) {
        return reply.code(400).send({ error: err.code, message: err.message })
      }
      throw err
    }
  })

  /**
   * The provider sends the browser back here. No auth header, by definition.
   *
   * It always redirects rather than rendering: the person is sitting in a
   * browser tab mid-flow, and an API error object is not an answer to "did my
   * calendar connect?".
   */
  app.get('/oauth/:provider/callback', async (req, reply) => {
    const params = providerParam.safeParse(req.params)
    if (!params.success) return reply.redirect(back('failed'))
    const provider = params.data.provider as Provider

    const query = z
      .object({
        code: z.string().optional(),
        state: z.string().optional(),
        error: z.string().optional(),
      })
      .safeParse(req.query)

    if (!query.success) return reply.redirect(back('failed'))

    // The user pressed Cancel on the consent screen. Not an error worth a
    // scary message — they changed their mind.
    if (query.data.error) {
      return reply.redirect(back(query.data.error === 'access_denied' ? 'cancelled' : 'failed'))
    }
    if (!query.data.code || !query.data.state) return reply.redirect(back('failed'))

    try {
      await completeConsent(provider, query.data.state, query.data.code)
      return reply.redirect(back('connected'))
    } catch (err) {
      if (err instanceof OAuthError) {
        req.log.warn({ provider, code: err.code }, 'consent failed')
        return reply.redirect(back(err.code))
      }
      req.log.error(err, 'oauth callback failed')
      return reply.redirect(back('failed'))
    }
  })

  async function ownAccount(id: string, userId: string): Promise<AccountRow | null> {
    const [row] = await db
      .select()
      .from(schema.oauthAccounts)
      .where(and(eq(schema.oauthAccounts.id, id), eq(schema.oauthAccounts.userId, userId)))
      .limit(1)
    return row ?? null
  }

  function failure(err: unknown) {
    if (
      err instanceof OAuthError ||
      err instanceof GoogleCalendarError ||
      err instanceof MicrosoftCalendarError
    ) {
      return {
        error: err.code,
        message: err.message,
        needsReconnect: err instanceof OAuthError && err.needsReconnect,
      }
    }
    return null
  }

  /** What this account can read, so the user picks rather than guessing. */
  app.get('/oauth/accounts/:id/calendars', authed, async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const account = await ownAccount(id, userId)
    if (!account) return reply.code(404).send({ error: 'not_found' })

    try {
      const calendars = await calendarsOf(account)
      // Which ones are already mirrored, so the UI shows "added" rather than
      // offering to add the same calendar twice.
      const existing = await db
        .select({ calendarId: schema.calendarFeeds.externalCalendarId })
        .from(schema.calendarFeeds)
        .where(eq(schema.calendarFeeds.oauthAccountId, id))
      const taken = new Set(existing.map((r) => r.calendarId))

      return { calendars: calendars.map((c) => ({ ...c, added: taken.has(c.id) })) }
    } catch (err) {
      const known = failure(err)
      if (known) return reply.code(400).send(known)
      throw err
    }
  })

  /** Start mirroring one calendar, and read it immediately so it is not empty. */
  app.post('/oauth/accounts/:id/calendars', authed, async (req, reply) => {
    const { orgId, sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const body = z
      .object({
        calendarId: z.string().min(1).max(500),
        label: z.string().min(1).max(120),
        remind: z.boolean().optional(),
        historyDays: z.number().int().min(0).max(3650).nullable().optional(),
      })
      .parse(req.body)

    const account = await ownAccount(id, userId)
    if (!account) return reply.code(404).send({ error: 'not_found' })

    const [existing] = await db
      .select({ id: schema.calendarFeeds.id })
      .from(schema.calendarFeeds)
      .where(
        and(
          eq(schema.calendarFeeds.oauthAccountId, id),
          eq(schema.calendarFeeds.externalCalendarId, body.calendarId),
        ),
      )
      .limit(1)
    if (existing) {
      return reply
        .code(409)
        .send({ error: 'already_added', message: 'That calendar is already here.' })
    }

    const [feed] = await db
      .insert(schema.calendarFeeds)
      .values({
        orgId,
        userId,
        label: body.label,
        source: account.provider,
        oauthAccountId: id,
        externalCalendarId: body.calendarId,
        calendarName: body.label,
        remind: body.remind ?? false,
        historyDays: body.historyDays === undefined ? 365 : body.historyDays,
      })
      .returning()

    // Syncing now rather than waiting for the timer: a calendar that appears
    // empty for half an hour reads as broken, however correct it is.
    try {
      const report = await syncFeed(feed!)
      await db
        .update(schema.calendarFeeds)
        .set({
          lastSyncedAt: new Date(),
          lastError: null,
          lastEventCount: report.imported + report.updated + report.repeating,
          lastSkippedCount: report.skipped,
        })
        .where(eq(schema.calendarFeeds.id, feed!.id))
      return { ok: true, feedId: feed!.id, report }
    } catch (err) {
      const known = failure(err)
      const message =
        known?.message ?? (err instanceof FeedError ? err.message : 'Could not read that calendar.')
      await db
        .update(schema.calendarFeeds)
        .set({ lastSyncedAt: new Date(), lastError: message })
        .where(eq(schema.calendarFeeds.id, feed!.id))
      // The feed is kept with its error showing rather than rolled back, so
      // "Read now" can retry it instead of making the user add it again.
      return reply.code(502).send({ error: 'sync_failed', message, feedId: feed!.id })
    }
  })

  /**
   * Disconnect: hand the grant back where the provider allows it, then drop
   * everything it fed.
   *
   * The cascade reaches the calendars and, through them, the mirrored events.
   * Leaving stale copies of a calendar nobody can refresh would be worse than
   * removing them — they would never again match the calendar they came from.
   */
  app.delete('/oauth/accounts/:id', authed, async (req, reply) => {
    const { sub: userId } = scope(req)
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)

    const account = await ownAccount(id, userId)
    if (!account) return reply.code(404).send({ error: 'not_found' })

    await revokeAccount(account)
    await db.delete(schema.oauthAccounts).where(eq(schema.oauthAccounts.id, id))

    const config = configFor(account.provider as Provider)
    return {
      ok: true,
      // Microsoft publishes no revocation endpoint, so the person has to finish
      // the job themselves. Saying nothing would imply Cue had been removed at
      // their end too, which would not be true.
      alsoRemoveAt: config.revokeEndpoint ? null : config.permissionsUrl,
    }
  })
}
