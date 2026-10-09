/**
 * Things shared into Cue from other apps.
 *
 * The installed app is a share target: in WhatsApp, Gmail or Messages, Share
 * then Cue opens /share?title=&text=&url=. That is turned into one line for
 * the box on Today before anything renders, and kept in sessionStorage rather
 * than the URL so a sign-in screen in between does not lose it.
 */

import { composeShared, type Shared } from '@cue/shared'

export type { Shared }

const KEY = 'cue.shared'
/** A share is acted on now or not at all. */
const FRESH_MS = 15 * 60_000

/** Runs before the app renders: an arrival at /share becomes Today with the text waiting. */
export function catchShare(): void {
  if (window.location.pathname !== '/share') return
  const q = new URLSearchParams(window.location.search)
  const shared = composeShared(q.get('title'), q.get('text'), q.get('url'))
  try {
    if (shared) sessionStorage.setItem(KEY, JSON.stringify({ ...shared, at: Date.now() }))
  } catch {
    // Storage blocked: the app still opens, just without the text.
  }
  window.history.replaceState(null, '', shared ? '/?capture=shared' : '/')
}

export function readShared(): Shared | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Shared & { at: number }
    if (Date.now() - s.at > FRESH_MS) {
      sessionStorage.removeItem(KEY)
      return null
    }
    return { text: s.text, original: s.original }
  } catch {
    return null
  }
}

export function clearShared(): void {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // Nothing to clear.
  }
}
