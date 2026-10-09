import { useEffect, useRef } from 'react'

/**
 * Opening the Add sheet from anywhere.
 *
 * Adding used to be a page, so anything that wanted it navigated to /log and
 * the user lost the screen they were on. It is now one sheet over whatever is
 * showing, owned by the app shell, and this is how the rest of the app asks
 * for it. A window event for the same reason as announceChange: the caller
 * only needs to say "open", not hold the sheet's state.
 */
export interface AddOptions {
  /** Something still to come, or something that already happened. */
  mode?: 'upcoming' | 'past'
  /** Open on the detailed form rather than the one-line box. */
  full?: boolean
  /** The detailed form, with "every week" already chosen. */
  repeat?: boolean
  /** The schedule form: steps at set distances from one date. */
  schedule?: boolean
  /** "Share when I'm free": times to offer someone, as a message. */
  share?: boolean
  /** Who the times are for, when it is known — booked meetings are named after them. */
  shareWith?: string
}

const EVENT = 'cue:add'

export function openAdd(options: AddOptions = {}): void {
  window.dispatchEvent(new CustomEvent<AddOptions>(EVENT, { detail: options }))
}

/** For the shell: run `open` whenever something asks for the sheet. */
export function useOpenAdd(open: (options: AddOptions) => void): void {
  const latest = useRef(open)
  latest.current = open

  useEffect(() => {
    const handler = (e: Event) => latest.current((e as CustomEvent<AddOptions>).detail ?? {})
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])
}
