import { useMemo, useState } from 'react'
import { api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'
import { dueChoices } from './WrapUp.tsx'

/**
 * "Waiting on someone", added directly — not only from a meeting wrap-up.
 * Who, what, and when to check in. It claims no time on the calendar.
 */
export function WaitingForm({ onDone }: { onDone: () => void }) {
  const choices = useMemo(() => dueChoices(), [])
  const [who, setWho] = useState('')
  const [what, setWhat] = useState('')
  const [due, setDue] = useState('friday')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const at = choices.find((c) => c.key === due)?.at
    if (!at) return
    setBusy(true)
    setError(null)
    try {
      await api('/commitments', {
        method: 'POST',
        body: {
          title: `Waiting on ${who.trim()}: ${what.trim()}`,
          kind: 'followup',
          dueAt: at.toISOString(),
          durationMinutes: 15,
          waitingOn: who.trim(),
          allowConflict: true,
        },
      })
      announceChange()
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="card waiting-form">
      <div className="row waiting-form-fields">
        <input value={who} onChange={(e) => setWho(e.target.value)} placeholder="Who? e.g. Priya" aria-label="Who" autoFocus />
        <input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="What? e.g. budget numbers"
          aria-label="What"
        />
      </div>
      <div className="wrapup-due" role="group" aria-label="When to check in">
        <span className="muted small">Check in</span>
        {choices.map((c) => (
          <button key={c.key} className={`chip${due === c.key ? ' selected' : ''}`} onClick={() => setDue(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy || !who.trim() || !what.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </button>
        <button className="ghost small-btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  )
}
