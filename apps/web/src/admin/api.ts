import { ApiError, BASE } from '../lib/api.ts'

/**
 * The admin portal's own requests and session — kept apart from the app's.
 * Its token is stored under its own key and sent only to /api/admin; a
 * user's sign-in is never sent from here, and this one never from the app.
 */

const KEY = 'cue.admin.session'
const SIGNED_OUT = 'cue:admin-signed-out'

export interface AdminSession {
  token: string
  email: string
  expiresAt: string
}

export function adminSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as AdminSession
    return new Date(s.expiresAt).getTime() > Date.now() ? s : null
  } catch {
    return null
  }
}

export function setAdminSession(session: AdminSession | null): void {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session))
    else localStorage.removeItem(KEY)
  } catch {
    // Private mode: the session lasts as long as the page.
  }
}

/** The portal hears when its session ended (expired, or the password changed). */
export function onAdminSignedOut(handler: () => void): () => void {
  window.addEventListener(SIGNED_OUT, handler)
  return () => window.removeEventListener(SIGNED_OUT, handler)
}

async function body(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function adminApi<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  for (const [k, v] of Object.entries(options.query ?? {})) url.searchParams.set(k, v)
  const token = adminSession()?.token
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await body(res)
  if (!res.ok) {
    if (res.status === 401 && path !== '/admin/login') {
      setAdminSession(null)
      window.dispatchEvent(new Event(SIGNED_OUT))
    }
    throw new ApiError(res.status, data?.error ?? (res.status >= 500 ? 'internal_error' : 'request_failed'), data)
  }
  return data as T
}
