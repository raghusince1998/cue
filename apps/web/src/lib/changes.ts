import { useEffect, useRef } from 'react'

/**
 * "Something was added or changed — reload what you are showing."
 *
 * Adding no longer happens only on the Add page: the header opens the same
 * one-line capture over whatever page is on screen. Without this, typing
 * "dentist friday 6pm" from Today would save it and leave Today showing the
 * day without it until the next minute's poll, which reads as the save having
 * failed.
 *
 * A window event rather than shared state, because the pages that care each
 * own their data and their own load; they only need to be told when to run it.
 */
const EVENT = 'cue:changed'

export function announceChange(): void {
  window.dispatchEvent(new Event(EVENT))
}

/**
 * Run `reload` whenever something changes elsewhere.
 *
 * Held in a ref so a page passing a fresh function on every render does not
 * unsubscribe and resubscribe each time.
 */
export function useOnChange(reload: () => void): void {
  const latest = useRef(reload)
  latest.current = reload

  useEffect(() => {
    const handler = () => latest.current()
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])
}
