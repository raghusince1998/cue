import { useEffect, useState } from 'react'
import { useOnline, usePendingCount } from '../lib/online.ts'
import { discardEntry, listOutbox, syncOutbox, type OutboxEntry } from '../lib/outbox.ts'
import { formatDateTime } from '../lib/time.ts'

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
        <strong>{online ? 'Waiting to sync' : 'You are offline'}</strong>
        <p className="muted small">
          {!online && pending === 0 && 'Visits you log now are saved on this device and sent later.'}
          {pending > 0 &&
            `${pending} visit${pending === 1 ? '' : 's'} saved on this device${
              online ? ', syncing now.' : ', will send when you are back online.'
            }`}
        </p>

        {failed.length > 0 && (
          <>
            <p className="error small">
              {failed.length} could not be sent — the server rejected them.
            </p>
            <ul className="plain">
              {failed.map((entry) => (
                <li key={entry.id} className="muted small">
                  {formatDateTime(entry.createdAt)} — {entry.lastError ?? 'rejected'}{' '}
                  <button className="link danger-link" onClick={() => void discardEntry(entry.id)}>
                    Discard
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {online && pending > 0 && (
        <button className="primary small-btn" onClick={syncNow} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      )}
    </div>
  )
}
