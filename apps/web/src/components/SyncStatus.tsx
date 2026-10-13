import { useEffect, useState } from 'react'
import { useOnline, usePendingCount } from '../lib/online.ts'
import { discardEntry, listOutbox, syncOutbox, type OutboxEntry } from '../lib/outbox.ts'
import { formatDateTime } from '../lib/time.ts'
import { t } from '../lib/i18n.tsx'

export function SyncStatus() {
  const online = useOnline()
  const pending = usePendingCount()
  const [failed, setFailed] = useState<OutboxEntry[]>([])
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    void listOutbox().then((all) => setFailed(all.filter((e) => e.failed)))
  }, [pending])

  async function syncNow() {
    setSyncing(true)
    try {
      await syncOutbox()
      setFailed((await listOutbox()).filter((e) => e.failed))
    } finally {
      setSyncing(false)
    }
  }

  if (online && pending === 0 && failed.length === 0) return null

  return (
    <div className={`banner${online ? '' : ' offline'}`}>
      <div>
        <strong>{online ? t('Waiting to sync') : t('You are offline')}</strong>
        <p className="muted small">
          {!online && pending === 0 && t('Visits you log now are saved on this device and sent later.')}
          {pending > 0 &&
            (online
              ? pending === 1
                ? t('1 visit saved on this device, syncing now.')
                : t('{n} visits saved on this device, syncing now.', { n: pending })
              : pending === 1
                ? t('1 visit saved on this device, will send when you are back online.')
                : t('{n} visits saved on this device, will send when you are back online.', { n: pending }))}
        </p>

        {failed.length > 0 && (
          <>
            <p className="error small">
              {t('{n} could not be sent — the server rejected them.', { n: failed.length })}
            </p>
            <ul className="plain">
              {failed.map((entry) => (
                <li key={entry.id} className="muted small">
                  {formatDateTime(entry.createdAt)} — {entry.lastError ?? t('rejected')}{' '}
                  <button className="link danger-link" onClick={() => void discardEntry(entry.id)}>
                    {t('Discard')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {online && pending > 0 && (
        <button className="primary small-btn" onClick={syncNow} disabled={syncing}>
          {syncing ? t('Syncing…') : t('Sync now')}
        </button>
      )}
    </div>
  )
}
