import { useState } from 'react'
import { ApiError, api } from '../lib/api.ts'
import { announceChange } from '../lib/changes.ts'

const LENGTHS = [25, 50, 90, 120]

function clock(d: Date): string {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function lengthLabel(m: number): string {
  if (m < 60) return `${m} min`
  const h = m / 60
  return h % 1 === 0 ? `${h}h` : `${Math.floor(h)}h ${m % 60}m`
}

/**
 * Starting focus time — now, or for a free stretch later in the day.
 *
 * Asks for a length and, optionally, what the time is for: naming the one
 * thing is most of the point of setting time aside. While the block runs,
 * routine reminders wait until it ends.
 */
export function FocusStart({
  startAt,
  maxMinutes,
  suggestions,
  onDone,
}: {
  /** When a free stretch was picked; omitted, it starts now. */
  startAt?: string | null
  /** The length of that free stretch, so the block fits inside it. */
  maxMinutes?: number | null
  /** Today's tasks, offered as what to work on. */
  suggestions: string[]
  onDone: () => void
}) {
  const begins = startAt && new Date(startAt) > new Date() ? new Date(startAt) : null
  const lengths = maxMinutes
    ? [...new Set([...LENGTHS.filter((m) => m <= maxMinutes), Math.min(maxMinutes, 240)])].sort((a, b) => a - b)
    : LENGTHS
  const [minutes, setMinutes] = useState(() =>
    lengths.includes(50) ? 50 : lengths[lengths.length - 1]!,
  )
  const [what, setWhat] = useState('')
  const [clash, setClash] = useState<{ title: string; dueAt: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = begins ?? new Date()
  const end = new Date(start.getTime() + minutes * 60_000)

  async function go(allowConflict = false) {
    setBusy(true)
    setError(null)
    try {
      await api('/focus', {
        method: 'POST',
        body: {
          minutes,
          startAt: begins ? begins.toISOString() : undefined,
          title: what.trim() || null,
          allowConflict,
        },
      })
      announceChange()
      onDone()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setClash((err.data as { conflicts: { title: string; dueAt: string }[] }).conflicts)
      } else {
        setError((err as Error).message)
      }
      setBusy(false)
    }
  }

  return (
    <div className="stack tight focus-start">
      <span className="label-text">How long?</span>
      <div className="chips">
        {lengths.map((m) => (
          <button
            key={m}
            className={`chip${minutes === m ? ' selected' : ''}`}
            onClick={() => {
              setMinutes(m)
              setClash(null)
            }}
          >
            {lengthLabel(m)}
          </button>
        ))}
      </div>

      <label>
        What will you work on? (optional)
        <input
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="The Q3 deck"
          autoFocus
        />
      </label>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.slice(0, 5).map((s) => (
            <button key={s} className={`chip${what === s ? ' selected' : ''}`} onClick={() => setWhat(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <p className="muted small">
        {begins ? `${clock(start)} – ${clock(end)}` : `Now until ${clock(end)}`}. Reminders wait
        until it ends — anything marked critical, and the note before a meeting, still come
        through.
      </p>

      {clash && (
        <p className="error small">
          That runs into {clash.map((x) => `${x.title} at ${clock(new Date(x.dueAt))}`).join(', ')}.
          Pick a shorter length, or start it anyway.
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <div className="form-actions">
        <button className="primary" onClick={() => void go(Boolean(clash))} disabled={busy}>
          {busy ? 'Starting…' : clash ? 'Start anyway' : begins ? 'Block this time' : 'Start focus'}
        </button>
      </div>
    </div>
  )
}
