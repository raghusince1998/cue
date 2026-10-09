import { useEffect, useState } from 'react'
import type { TargetMetric, TargetProgress } from '@cue/shared'
import { api } from '../lib/api.ts'

export interface WeekTargets {
  week: { from: string; to: string }
  metrics: TargetProgress[]
  tracking: boolean
}

export function statusText(m: TargetProgress): string {
  if (m.status === 'done') return 'Hit'
  if (m.status === 'on') return 'On pace'
  if (m.status === 'behind') return `Behind by ${m.expected - m.done}`
  return ''
}

/** A bar filling towards the target, with a tick where an even pace would be by now. */
export function TargetBar({ m, small = false }: { m: TargetProgress; small?: boolean }) {
  const target = m.target ?? 1
  const fill = Math.min(m.done / target, 1) * 100
  const pace = Math.min(m.expected / target, 1) * 100
  return (
    <span
      className={`target-bar${small ? ' is-small' : ''}`}
      role="img"
      aria-label={`${m.label}: ${m.done} of ${m.target}, ${statusText(m).toLowerCase()}`}
    >
      <span className={`target-fill is-${m.status}`} style={{ width: `${fill}%` }} />
      {m.status !== 'done' && pace > 0 && pace < 100 && <i className="target-pace" style={{ left: `${pace}%` }} />}
    </span>
  )
}

/**
 * Weekly targets: how many calls, visits, meetings and so on to get through
 * this week, against what is already logged. Last week sits beside each as
 * the honest starting point for a number.
 */
export function Targets({ onSaved }: { onSaved?: () => void }) {
  const [data, setData] = useState<WeekTargets | null>(null)
  const [draft, setDraft] = useState<Partial<Record<TargetMetric, string>>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function adopt(w: WeekTargets) {
    setData(w)
    setDraft(Object.fromEntries(w.metrics.map((m) => [m.key, m.target ? String(m.target) : ''])))
  }

  useEffect(() => {
    void api<WeekTargets>('/targets/week').then(adopt)
  }, [])

  const changed = data?.metrics.some((m) => (draft[m.key] ?? '') !== (m.target ? String(m.target) : '')) ?? false

  async function save() {
    if (!data) return
    setBusy(true)
    setError(null)
    try {
      const targets = Object.fromEntries(
        data.metrics.map((m) => {
          const n = Number.parseInt(draft[m.key] ?? '', 10)
          return [m.key, Number.isFinite(n) && n > 0 ? Math.min(n, 1000) : null]
        }),
      )
      adopt(await api<WeekTargets>('/targets', { method: 'PUT', body: { targets } }))
      setSaved(true)
      onSaved?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <p className="muted small">Counting your week…</p>

  return (
    <div className="stack tight targets">
      <p className="muted small">
        Counted from what you log: calls, visits, meetings and what you close. Set a number for
        the ones you want to hit each week; leave the rest empty.
      </p>

      {data.metrics.map((m) => (
        <div className="target-row" key={m.key}>
          <div className="target-head">
            <span>
              <strong>{m.label}</strong>
              <span className="muted small"> · {m.hint}</span>
            </span>
            <label className="target-input">
              <span className="muted small">Weekly</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                value={draft[m.key] ?? ''}
                placeholder="Off"
                onChange={(e) => {
                  setSaved(false)
                  setDraft((d) => ({ ...d, [m.key]: e.target.value }))
                }}
                aria-label={`${m.label} weekly target`}
              />
            </label>
          </div>
          {m.target ? (
            <>
              <TargetBar m={m} />
              <div className="target-meta small">
                <span>
                  {m.done} of {m.target}
                </span>
                <span className={`target-status is-${m.status}`}>{statusText(m)}</span>
                <span className="muted">Last week {m.lastWeek}</span>
              </div>
            </>
          ) : (
            <p className="muted small target-meta">
              {m.done} this week · {m.lastWeek} last week
            </p>
          )}
        </div>
      ))}

      {error && <p className="error small">{error}</p>}
      <div className="row">
        <button className="primary" onClick={() => void save()} disabled={busy || !changed}>
          {busy ? 'Saving…' : 'Save targets'}
        </button>
        {saved && !changed && <span className="muted small">Saved.</span>}
      </div>
    </div>
  )
}
