import type { FastifyInstance } from 'fastify'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { pushSubscribeInput } from '@cue/shared'
import { db, schema } from '../db/index.ts'
import { env, pushConfigured } from '../env.ts'
import { scope } from '../auth.ts'
import { sendToUser } from '../push.ts'

export async function pushRoutes(app: FastifyInstance) {
  // The public key is not a secret — the browser needs it before login too.
  app.get('/push/public-key', async () => ({
    publicKey: env.vapidPublicKey,
    configured: pushConfigured,
  }))

  app.post('/push/subscribe', { onRequest: [app.authenticate] }, async (req) => {
    const { orgId, sub: userId } = scope(req)
    const body = pushSubscribeInput.parse(req.body)

    // Endpoints are stable per browser install, so re-subscribing moves the row
    // to the current user instead of piling up duplicates.
    await db
      .insert(schema.pushSubscriptions)
      .values({
        orgId,
        userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent: body.userAgent ?? null,
      })
      .onConflictDoUpdate({
        target: schema.pushSubscriptions.endpoint,
        set: { orgId, userId, p256dh: body.keys.p256dh, auth: body.keys.auth },
      })

    return { ok: true }
  })

  app.post('/push/unsubscribe', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: userId } = scope(req)
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body)
    await db
      .delete(schema.pushSubscriptions)
      .where(
        and(
          eq(schema.pushSubscriptions.endpoint, endpoint),
          eq(schema.pushSubscriptions.userId, userId),
        ),
      )
    return { ok: true }
  })

  /** Proves the whole delivery path works without waiting for a real due date. */
  app.post('/push/test', { onRequest: [app.authenticate] }, async (req) => {
    const { sub: userId } = scope(req)
    const delivered = await sendToUser(userId, {
      title: 'Cue is wired up',
      body: 'Reminders will arrive here even when the app is closed.',
      tag: 'test',
      url: '/',
    })
    return { delivered }
  })
}
