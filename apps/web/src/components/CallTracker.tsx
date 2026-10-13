import { useEffect, useRef, useState } from 'react'
import { callFromLink, clearCall, onCallStarted, readCall, startCall, type PendingCall } from '../lib/calls.ts'
import { rich, t } from '../lib/i18n.tsx'
import { CallLog } from './CallLog.tsx'
import { Modal } from './Modal.tsx'

/** Away at least this long counts as having been on the call, not a stray tap. */
const AWAY_MS = 3000
/** Opened fresh within this long of dialling: the app was closed during the call. */
const REOPENED_MS = 30 * 60_000

/**
 * Notices calls made from Cue and asks how they went on the way back.
 *
 * Every Call button is a plain `tel:` link, so one listener catches them all.
 * Leaving for the phone app and coming back opens the question; on a desktop,
 * where nothing leaves, a banner offers it instead and stays until answered or
 * waved away.
 */
export function CallTracker() {
  const [pending, setPending] = useState<PendingCall | null>(() => readCall())
  const [logging, setLogging] = useState<PendingCall | null>(() => {
    const call = readCall()
    return call && Date.now() - call.startedAt < REOPENED_MS ? call : null
  })
  const hiddenAt = useRef<number | null>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.('a[href^="tel:"]') as HTMLAnchorElement | null
      if (link) setPending(startCall(callFromLink(link)))
    }
    document.addEventListener('click', onClick, true)
    const stop = onCallStarted(setPending)
    return () => {
      document.removeEventListener('click', onClick, true)
      stop()
    }
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const call = readCall() ?? pending
      const away = hiddenAt.current
      hiddenAt.current = null
      if (call && away && away >= call.startedAt - 1000 && Date.now() - away >= AWAY_MS) setLogging(call)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [pending])

  function finish(saved: boolean) {
    setLogging(null)
    if (saved) {
      clearCall()
      setPending(null)
    }
  }

  return (
    <>
      {pending && !logging && (
        <div className="call-banner" role="status">
          <span>
            {rich('Call with {name}: how did it go?', { name: <strong>{pending.name ?? pending.phone}</strong> })}
          </span>
          <button className="primary small-btn" onClick={() => setLogging(pending)}>
            {t('Log it')}
          </button>
          <button
            className="ghost small-btn"
            aria-label={t('Dismiss')}
            onClick={() => {
              clearCall()
              setPending(null)
            }}
          >
            &times;
          </button>
        </div>
      )}

      {logging && (
        <Modal title={t('How did the call go?')} onClose={() => finish(false)}>
          <CallLog call={logging} onDone={finish} />
        </Modal>
      )}
    </>
  )
}
