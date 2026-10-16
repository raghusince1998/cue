import { useEffect } from 'react'

/**
 * A short line at the bottom of the screen, for what just happened where
 * nothing else on screen says it: "Marked done", "Could not reach Cue".
 * Shown by the one <Toasts /> in the app shell; gone after a few seconds.
 */

export type ToastKind = 'ok' | 'error'
export interface ToastMessage {
  id: number
  text: string
  kind: ToastKind
}

const EVENT = 'cue:toast'
let next = 1

/** Say it. Pass text already in the reader's language (t()). */
export function toast(text: string, kind: ToastKind = 'ok'): void {
  window.dispatchEvent(new CustomEvent<ToastMessage>(EVENT, { detail: { id: next++, text, kind } }))
}

/** For the shell: hear each toast as it is said. */
export function useToasts(onToast: (message: ToastMessage) => void): void {
  useEffect(() => {
    const listener = (e: Event) => onToast((e as CustomEvent<ToastMessage>).detail)
    window.addEventListener(EVENT, listener)
    return () => window.removeEventListener(EVENT, listener)
  }, [onToast])
}
