import { api } from './api.ts'

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied'

export function pushState(): PushState {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission as PushState
}

/**
 * On iOS this only works once the user has added the app to their home screen;
 * Safari exposes no PushManager to a plain browser tab.
 */
export function needsHomeScreenInstall(): boolean {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  return isIos && !standalone
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) {
    return {
      ok: false,
      reason: needsHomeScreenInstall()
        ? 'On iPhone, tap Share then "Add to Home Screen" first, then enable notifications from there.'
        : 'This browser does not support push notifications.',
    }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: 'Notification permission was declined.' }
  }

  const { publicKey, configured } = await api<{ publicKey: string; configured: boolean }>(
    '/push/public-key',
  )
  if (!configured) {
    return { ok: false, reason: 'Server has no VAPID keys yet. Run: npm run vapid' }
  }

  const registration = await navigator.serviceWorker.ready

  // Reuse an existing subscription when present; re-subscribing with a
  // different key silently fails in Chrome.
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }))

  const json = subscription.toJSON() as {
    endpoint: string
    keys: { p256dh: string; auth: string }
  }

  await api('/push/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent },
  })

  return { ok: true }
}

export async function sendTestPush(): Promise<number> {
  const res = await api<{ delivered: number }>('/push/test', { method: 'POST' })
  return res.delivered
}
