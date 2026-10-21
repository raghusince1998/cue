import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import type { Lang } from '@cue/shared'
import { db, schema } from './db/index.ts'
import { env, pushConfigured } from './env.ts'
import { pushStats } from './services/health.ts'

if (pushConfigured) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey)
}

/**
 * How every Cue notification is sent.
 *
 * High urgency, because these are reminders: at the default ("normal") Android
 * may hold a web push until the phone next wakes from its battery-saving sleep,
 * which is how a reminder arrives after the meeting it was for. Native apps
 * such as delivery and shopping apps send theirs at high priority, which is
 * part of why theirs turn up on time. The TTL drops a reminder the push
 * service could not deliver within six hours, rather than buzzing about
 * yesterday's call when the phone comes back online.
 */
const SEND_OPTIONS = { urgency: 'high' as const, TTL: 6 * 60 * 60 }

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
  commitmentId?: string
  /** When present the notification shows a Call action. */
  phone?: string
  /**
   * The language the person reads Cue in, so the service worker can label
   * its buttons ("Mark done", "Snooze 15m") to match. Filled in from their
   * account when the caller leaves it out.
   */
  lang?: Lang
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
    .select({
      id: schema.pushSubscriptions.id,
      endpoint: schema.pushSubscriptions.endpoint,
      p256dh: schema.pushSubscriptions.p256dh,
      auth: schema.pushSubscriptions.auth,
      language: schema.users.language,
    })
    .from(schema.pushSubscriptions)
    .leftJoin(schema.users, eq(schema.users.id, schema.pushSubscriptions.userId))
    .where(eq(schema.pushSubscriptions.userId, userId))

  // Read along with the subscriptions, so it costs no extra round trip.
  const lang: Lang = payload.lang ?? (subs[0]?.language === 'hi' ? 'hi' : 'en')
  const message = JSON.stringify({ ...payload, lang })

  let delivered = 0

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          message,
          SEND_OPTIONS,
        )
        delivered += 1
        pushStats.sent += 1
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          pushStats.expired += 1
          await db
            .delete(schema.pushSubscriptions)
            .where(eq(schema.pushSubscriptions.id, sub.id))
        } else {
          pushStats.failed += 1
          console.error('[push] send failed', status, (err as Error).message)
        }
      }
    }),
  )

  return delivered
}
