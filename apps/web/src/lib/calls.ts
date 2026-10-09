/**
 * A call in progress: who was dialled from Cue, and when.
 *
 * Kept in localStorage because the phone app takes over the screen and an
 * installed app may well be closed by the time the call ends — when it opens
 * again, it still knows whom to ask about. Three hours on, it is not asked.
 */

export interface PendingCall {
  phone: string
  contactId: string | null
  name: string | null
  /** The plan it was dialled from, e.g. a call back, to close or move with it. */
  commitmentId: string | null
  commitmentTitle: string | null
  startedAt: number
}

const KEY = 'cue.call'
const EVENT = 'cue:call'
const STALE_MS = 3 * 60 * 60_000

export function startCall(call: Omit<PendingCall, 'startedAt'>): PendingCall {
  const started = { ...call, startedAt: Date.now() }
  try {
    localStorage.setItem(KEY, JSON.stringify(started))
  } catch {
    // Private mode: the banner still shows for this visit.
  }
  window.dispatchEvent(new CustomEvent<PendingCall>(EVENT, { detail: started }))
  return started
}

export function readCall(): PendingCall | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const call = JSON.parse(raw) as PendingCall
    if (Date.now() - call.startedAt > STALE_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    return call
  } catch {
    return null
  }
}

export function clearCall(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored to clear.
  }
}

export function onCallStarted(fn: (call: PendingCall) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<PendingCall>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}

/**
 * Who a `tel:` link calls. Links say who with data attributes —
 * `data-contact-id`, `data-name`, `data-commitment-id`, `data-commitment-title`
 * — and a bare number is still a call worth logging.
 */
export function callFromLink(a: HTMLAnchorElement): Omit<PendingCall, 'startedAt'> {
  const d = a.dataset
  return {
    phone: decodeURIComponent(a.getAttribute('href')!.slice(4)),
    contactId: d.contactId || null,
    name: d.name || null,
    commitmentId: d.commitmentId || null,
    commitmentTitle: d.commitmentTitle || null,
  }
}
