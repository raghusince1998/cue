import { useEffect, useState } from 'react'
import { onOutboxChange, pendingCount, syncOutbox } from './outbox.ts'

/**
 * `navigator.onLine` is honest about "no adapter / airplane mode" and
 * optimistic about everything else — a captive portal or dead uplink still
 * reports true. It is a hint for the UI, never the thing we act on: the outbox
 * decides based on whether a request actually succeeded.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

export function usePendingCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const refresh = () => void pendingCount().then(setCount)
    refresh()
    return onOutboxChange(refresh)
  }, [])

  return count
}

/**
 * Drains the queue on startup and whenever the connection comes back. Also on
 * tab focus, because a phone waking from sleep often does not fire `online`.
 */
export function startSyncLoop(): () => void {
  const attempt = () => void syncOutbox()

  attempt()
  window.addEventListener('online', attempt)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') attempt()
  })

  // Backstop for a connection that returns without any event firing.
  const timer = setInterval(attempt, 60_000)

  return () => {
    window.removeEventListener('online', attempt)
    clearInterval(timer)
  }
}
