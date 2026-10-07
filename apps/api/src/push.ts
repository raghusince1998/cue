import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db, schema } from './db/index.ts'
import { env, pushConfigured } from './env.ts'

if (pushConfigured) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)
}

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
  commitmentId?: string
  /** When present the notification shows a Call action. */
  phone?: string
}

/**
 * Fans a notification out to every device the user has registered. Endpoints
 * that the push service reports as dead (404/410) are pruned as we go — stale
 * subscriptions otherwise pile up forever as people reinstall.
 */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured) {
    console.warn('[push] VAPID keys missing — skipping send. Run: npm run vapid')
    return 0
  }

  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(eq(schema.pushSubscriptions.userId, userId))

  let delivered = 0

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        )
        delivered += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          await db
            .delete(schema.pushSubscriptions)
            .where(eq(schema.pushSubscriptions.id, sub.id))
        } else {
          console.error('[push] send failed', status, (err as Error).message)
        }
      }
    }),
  )

  return delivered
}
