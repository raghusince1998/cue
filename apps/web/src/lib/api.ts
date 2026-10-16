/**
 * Empty in production: the API serves the built app from the same origin, so a
 * relative "/api" needs no host, no CORS and no configuration. In development
 * VITE_API_URL points at the separate API port.
 */
export const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`

/**
 * `new URL()` needs somewhere to resolve against.
 *
 * In production BASE is the relative "/api", and `new URL("/api/auth/login")`
 * does not return a relative URL — it throws. Every call then failed before
 * reaching the network, and because the thrown value was not an ApiError the
 * login screen reported "Could not reach the server", which was the one
 * explanation that was not true: the server was answering fine.
 *
 * Invisible in development, where VITE_API_URL makes BASE absolute and the
 * constructor is happy. It only appeared in the single-origin arrangement that
 * production is supposed to use.
 */
function apiUrl(path: string): URL {
  return new URL(BASE + path, window.location.origin)
}
const TOKEN_KEY = 'cue.token'

/**
 * Carries anything stored under the old name across.
 *
 * The app was called Recall and its keys said so. Simply renaming them would
 * sign out every existing install and lose their chosen view — a rename is a
 * decision about the product, and nobody should be logged out by it.
 */
function migrateLegacyStorage() {
  for (const [was, now] of [
    ['recall.token', 'cue.token'],
    ['recall.view', 'cue.view'],
  ]) {
    try {
      const value = localStorage.getItem(was)
      if (value !== null && localStorage.getItem(now) === null) localStorage.setItem(now, value)
      if (value !== null) localStorage.removeItem(was)
    } catch {
      // Private browsing refuses to store. Nothing to carry across.
    }
  }
}

migrateLegacyStorage()

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    /** Full response body — a 409 carries the clashing commitments in here. */
    public data: unknown = null,
    message?: string,
  ) {
    super(message ?? code)
  }
}

/**
 * The answer's JSON. A gateway's HTML error page (a 502 while the server
 * restarts) is not JSON, and must not surface as a parse error in the UI.
 */
async function readBody(res: Response): Promise<any> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    if (res.ok) throw new ApiError(res.status, 'bad_response')
    return null
  }
}

const failedCode = (status: number) => (status >= 500 ? 'internal_error' : 'request_failed')

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = apiUrl(path)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value)
  }

  const token = getToken()
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (res.status === 204) return undefined as T

  const data = await readBody(res)

  if (!res.ok) {
    // A dead token should log you out rather than leaving the UI stuck on a
    // spinner it can never resolve.
    if (res.status === 401) setToken(null)
    throw new ApiError(res.status, data?.error ?? failedCode(res.status), data, data?.error)
  }

  return data as T
}

/** Sends a file as the raw body — an admit card's PDF — and reads the answer as api() does. */
export async function apiSendFile<T>(path: string, file: Blob): Promise<T> {
  const token = getToken()
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: file,
  })
  const data = await readBody(res)
  if (!res.ok) {
    if (res.status === 401) setToken(null)
    throw new ApiError(res.status, data?.error ?? 'upload_failed', data, data?.problem ?? data?.error)
  }
  return data as T
}

/** Uploads a recorded clip as a raw body — one blob, no other fields. */
export async function apiUploadAudio(
  path: string,
  blob: Blob,
  query: Record<string, string> = {},
): Promise<{ id: string; mimeType: string; durationMs: number | null; sizeBytes: number }> {
  const url = apiUrl(path)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

  const token = getToken()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': blob.type,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  })

  const data = await readBody(res)
  if (!res.ok) {
    if (res.status === 401) setToken(null)
    throw new ApiError(res.status, data?.error ?? 'upload_failed', data)
  }
  return data
}

/**
 * An <audio src> cannot send an Authorization header, so the bytes are fetched
 * here and handed to the element as a blob URL instead.
 */
export async function apiFetchBlobUrl(path: string): Promise<string> {
  const token = getToken()
  const res = await fetch(BASE + path, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError(res.status, 'fetch_failed')
  return URL.createObjectURL(await res.blob())
}
