/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { receiveShare } from './lib/shareTarget.ts'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)

/**
 * Single-page app: every navigation resolves to the precached index.html, so
 * opening the app with no signal still boots it. API calls are deliberately not
 * cached here — stale visits and reminders would be worse than none, and the
 * outbox handles writes.
 */
//
// Except /api/. Some server addresses are reached by navigating, not by fetch:
// Google and Microsoft send the browser back to /api/oauth/…/callback after
// "Allow". Answered from here, that page was the app instead of the server —
// the connection was never saved and the user landed on Today with nothing to
// show for it, every time, in any browser that already had this worker.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }),
)

self.addEventListener('install', () => {
  void self.skipWaiting()
})

// Shared into Cue Exams from another app: see lib/shareTarget.ts.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'POST' || url.pathname !== '/share-file') return
  event.respondWith(receiveShare(event.request, (name) => caches.open(name)))
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
  /** The language the person reads Cue in; the server sends it with every push. */
  lang?: string
}

/**
 * The buttons' words. The worker cannot read the app's language setting (it
 * lives in the page), and pulling the app's translations in here would make
 * this file large, so the server says which language and the three labels
 * live here.
 */
const ACTION_LABELS = {
  en: { call: 'Call', done: 'Mark done', snooze: 'Snooze 15m' },
  hi: { call: 'कॉल करें', done: 'हो गया', snooze: '15 मिनट बाद' },
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

  const words = payload.lang === 'hi' ? ACTION_LABELS.hi : ACTION_LABELS.en
  const options: SwNotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    // Replace the previous buzz for the same commitment rather than stacking
    // four identical notifications as it escalates.
    renotify: Boolean(payload.tag),
    requireInteraction: true,
    icon: '/icon-192.png',
    // A white silhouette: Android paints the badge from its alpha alone.
    badge: '/badge-96.png',
    data: { url: payload.url ?? '/', commitmentId: payload.commitmentId },
    // Three is the most any platform shows, and Call earns its slot whenever
    // there is actually a number to ring.
    // "Mark done" and "Snooze" need a plan to act on. The after-meeting
    // prompt has none of its own, so it is a plain tap that opens the app.
    actions: !payload.commitmentId
      ? []
      : payload.phone
      ? [
          { action: 'call', title: words.call },
          { action: 'done', title: words.done },
          { action: 'snooze', title: words.snooze },
        ]
      : [
          { action: 'done', title: words.done },
          { action: 'snooze', title: words.snooze },
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
