import { useState } from 'react'
import { USES } from '@cue/shared'
import { useAuth } from '../lib/auth.tsx'

/**
 * "What will you use Cue for?" — any number of answers. It decides what the
 * tabs, examples and reminders lead with, and whether Jobs, Hiring and Deals
 * are there at all: they are only for those who pick them.
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
          Pick as many as fit. Cue shows what each one needs: Jobs, Hiring and Deals appear only if you pick
          them. You can change this any time under More.
        </p>
      )}
      <div className="uses-grid" role="group" aria-label="What you use Cue for">
        {USES.map((u) => (
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
