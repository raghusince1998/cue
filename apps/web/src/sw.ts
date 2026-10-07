/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

/**
 * Single-page app: every navigation resolves to the precached index.html, so
 * opening the app with no signal still boots it. API calls are deliberately not
 * cached here — stale visits and reminders would be worse than none, and the
 * outbox handles writes.
 */
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

interface ReminderPayload {
  title: string
  body: string
  tag?: string
  url?: string
  commitmentId?: string
  phone?: string
}

/**
 * `renotify` and `actions` only exist on notifications shown from a service
 * worker, so the DOM lib's NotificationOptions does not declare them.
 */
interface SwNotificationOptions extends NotificationOptions {
  renotify?: boolean
  actions?: { action: string; title: string; icon?: string }[]
}

/**
 * Fires even when the app is closed — this is the one job a plain web page
 * cannot do and the reason the PWA has to be installed rather than bookmarked.
 */
self.addEventListener('push', (event) => {
  if (!event.data) return

  let payload: ReminderPayload
  try {
    payload = event.data.json() as ReminderPayload
  } catch {
    payload = { title: 'Cue', body: event.data.text() }
  }

  const options: SwNotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    // Replace the previous buzz for the same commitment rather than stacking
    // four identical notifications as it escalates.
    renotify: Boolean(payload.tag),
    requireInteraction: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url ?? '/', commitmentId: payload.commitmentId },
    // Three is the most any platform shows, and Call earns its slot whenever
    // there is actually a number to ring.
    actions: payload.phone
      ? [
          { action: 'call', title: 'Call' },
          { action: 'done', title: 'Mark done' },
          { action: 'snooze', title: 'Snooze 15m' },
        ]
      : [
          { action: 'done', title: 'Mark done' },
          { action: 'snooze', title: 'Snooze 15m' },
        ],
  }

  event.waitUntil(self.registration.showNotification(payload.title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const data = (event.notification.data ?? {}) as { url?: string; commitmentId?: string }
  const target = new URL(data.url ?? '/', self.location.origin)

  // The action buttons deep-link into the app rather than calling the API from
  // here, because the worker has no access to the auth token in localStorage.
  if (event.action === 'done' && data.commitmentId) {
    target.searchParams.set('action', 'done')
    target.searchParams.set('id', data.commitmentId)
  }
  if (event.action === 'snooze' && data.commitmentId) {
    target.searchParams.set('action', 'snooze')
    target.searchParams.set('id', data.commitmentId)
  }
  // A worker cannot dial; it hands the app the intent and the page opens tel:.
  if (event.action === 'call' && data.commitmentId) {
    target.searchParams.set('action', 'call')
    target.searchParams.set('id', data.commitmentId)
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.location.origin))
      if (existing) {
        void existing.focus()
        return existing.navigate(target.toString()).then(() => undefined)
      }
      return self.clients.openWindow(target.toString()).then(() => undefined)
    }),
  )
})
