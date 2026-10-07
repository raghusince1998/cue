import { useEffect, useState } from 'react'
import { api } from '../lib/api.ts'

/**
 * Somewhere this could actually go.
 *
 * The overdue card offered Done, three snoozes and Edit. Snoozing by fifteen
 * minutes is precisely what has already failed — four times over, in the case
 * that prompted this — and Edit means filling in a form to answer a question
 * the app can answer itself.
 *
 * So: three times that are genuinely free, one tap each. The slots come from
 * the same finder the triage panel and tomorrow's plan use, so "free" means
 * one thing across the app.
 */

interface Slots {
  slots: string[]
  durationMinutes: number
  preferredWindow: string | null
  outsideWindow: boolean
}

function label(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  )
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`
}

export function MoveIt({
  commitmentId,
  onMoved,
  onCancel,
  onEdit,
}: {
  commitmentId: string
  onMoved: () => void
  onCancel: () => void
  onEdit: () => void
}) {
  const [data, setData] = useState<Slots | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Slots>(`/commitments/${commitmentId}/slots`)
      .then(setData)
      .catch((err) => setError((err as Error).message))
  }, [commitmentId])

  async function moveTo(iso: string) {
    setBusy(true)
    setError(null)
    try {
      await api(`/commitments/${commitmentId}/reschedule`, { method: 'POST', body: { dueAt: iso } })
      onMoved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="error small">{error}</p>
  if (!data) return <p className="muted small">Finding a gap…</p>

  return (
    <div className="moveit">
      {data.slots.length === 0 ? (
        <p className="muted small">
          Nothing free for the next fortnight. Pick a time yourself, or shorten it.
        </p>
      ) : (
        <>
          <span className="muted small">
            {data.outsideWindow
              ? `No ${data.preferredWindow} gap free — these are the next openings`
              : `Next ${data.durationMinutes} minutes you are free`}
          </span>
          <div className="chips">
            {data.slots.map((iso) => (
              <button key={iso} className="chip" disabled={busy} onClick={() => void moveTo(iso)}>
                {label(iso)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="row">
        <button className="ghost small-btn" onClick={onEdit} disabled={busy}>
          Pick another time
        </button>
        <button className="ghost small-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
