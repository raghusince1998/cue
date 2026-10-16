import { useEffect, useRef } from 'react'

/**
 * Opening a plan, a person, a trip or an account from anywhere, over whatever
 * is showing.
 *
 * Every screen that named one of these used to keep its own sheet state and
 * render its own copy of the sheet — and the screens that did not bother left
 * the name as plain text, a dead end. The shell now owns one stack of them
 * (<Opener />), and this is how the rest of the app asks: a window event for
 * the same reason as openAdd and announceChange, so the caller only says
 * "open this", never holds the sheet.
 */
export type Opening =
  | { kind: 'plan'; id: string }
  | { kind: 'person'; id: string }
  | { kind: 'trip'; id: string }
  | { kind: 'account'; name: string }

const EVENT = 'cue:open-item'

function open(opening: Opening): void {
  window.dispatchEvent(new CustomEvent<Opening>(EVENT, { detail: opening }))
}

export const openPlan = (id: string): void => open({ kind: 'plan', id })
export const openPerson = (id: string): void => open({ kind: 'person', id })
export const openTrip = (id: string): void => open({ kind: 'trip', id })
export const openAccount = (name: string): void => open({ kind: 'account', name })

/** For the shell: hear each request to open something. */
export function useOpenings(onOpen: (opening: Opening) => void): void {
  const latest = useRef(onOpen)
  latest.current = onOpen

  useEffect(() => {
    const handler = (e: Event) => latest.current((e as CustomEvent<Opening>).detail)
    window.addEventListener(EVENT, handler)
    return () => window.removeEventListener(EVENT, handler)
  }, [])
}
