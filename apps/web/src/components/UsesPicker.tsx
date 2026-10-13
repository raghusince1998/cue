import { useState } from 'react'
import { USES, USE_GROUPS } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'

/**
 * "What will you use Cue for?" — any number of answers, grouped as life,
 * work, and career and studies. It decides what is in the app at all: each
 * part of Cue is there only for the kinds of day that need it.
 */
export function UsesPicker({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { me, saveUses } = useAuth()
  const [picked, setPicked] = useState<string[]>(me?.uses ?? [])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveUses(picked)
      setSaved(true)
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (key: string) => {
    setSaved(false)
    setPicked((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]))
  }

  return (
    <div className="stack tight uses-picker">
      {!compact && (
        <p className="muted small">
          Pick as many as fit. Cue shows only what these need — Deals and targets for sales, Jobs for a job
          hunt, work hours and reports for work — and you can change it any time under More.
        </p>
      )}
      {USE_GROUPS.map((g) => (
        <div key={g.key} className="uses-group" role="group" aria-label={g.label}>
          <span className="uses-group-label">{g.label}</span>
          <div className="uses-grid">
            {USES.filter((u) => u.group === g.key).map((u) => (
              <button
                key={u.key}
                type="button"
                className={`use-option${picked.includes(u.key) ? ' selected' : ''}`}
                onClick={() => toggle(u.key)}
                aria-pressed={picked.includes(u.key)}
              >
                <strong>{u.label}</strong>
                <span>{u.hint}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="primary small-btn" onClick={() => void save()} disabled={busy || picked.length === 0}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        {onDone && (
          <button className="ghost small-btn" onClick={onDone}>
            Not now
          </button>
        )}
      </div>
      {saved && !onDone && <p className="muted small">Saved. The tabs now show what these need.</p>}
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
