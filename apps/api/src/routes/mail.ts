import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, schema } from '../db/index.ts'
import { scope } from '../auth.ts'
import { checkMailFor, recentFinds } from '../services/mailReader.ts'

export async function mailRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate)

  /** What Cue has taken from email lately, so nothing it does there is hidden. */
  app.get('/mail/found', async (req) => recentFinds(scope(req).sub))

  /** Look now rather than at the next quarter hour. */
  app.post('/mail/check', async (req) => checkMailFor(scope(req).sub))

  /**
   * Stop reading this account's email. Turning it back on goes through the
   * consent screen again, so it is never switched on without asking.
   */
  app.post('/oauth/accounts/:id/mail-off', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const rows = await db
      .update(schema.oauthAccounts)
      .set({ mailEnabled: false, mailError: null })
      .where(and(eq(schema.oauthAccounts.id, id), eq(schema.oauthAccounts.userId, scope(req).sub)))
      .returning({ id: schema.oauthAccounts.id })
    return rows.length ? { ok: true } : reply.code(404).send({ error: 'not_found' })
  })
}
