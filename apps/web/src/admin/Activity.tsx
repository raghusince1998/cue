import { useCallback, useEffect, useState } from 'react'
import { adminApi as api } from './api.ts'
import { errorText } from '../lib/errors.ts'
import { LoadFailed } from '../components/LoadFailed.tsx'
import { ago, describe, device, Empty, Outcome, when, type AuditEvent } from './shared.tsx'

const GROUPS = [
  { key: '', label: 'Everything' },
  { key: 'auth.login', label: 'Sign-ins' },
  { key: 'auth', label: 'Accounts and passwords' },
  { key: 'oauth', label: 'Connected accounts' },
  { key: 'device', label: 'Devices' },
  { key: 'admin', label: 'Admin portal' },
] as const

const OUTCOMES = [
  { key: '', label: 'Any result' },
  { key: 'failed', label: 'Failed' },
  { key: 'blocked', label: 'Refused' },
  { key: 'ok', label: 'Went through' },
] as const

interface Page {
  events: AuditEvent[]
  next: number | null
  keepDays: number
}

/** The account trail, newest first: who, what, from where, and how it went. */
export function Activity({
  onOpenPerson,
  initialAction,
  initialOutcome,
}: {
  onOpenPerson: (id: string) => void
  initialAction: string | null
  initialOutcome: string | null
}) {
  const [action, setAction] = useState(GROUPS.some((g) => g.key === initialAction) ? initialAction! : '')
  const [outcome, setOutcome] = useState(OUTCOMES.some((o) => o.key === initialOutcome) ? initialOutcome! : '')
  const [q, setQ] = useState('')
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [next, setNext] = useState<number | null>(null)
  const [keepDays, setKeepDays] = useState(90)
  const [error, setError] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  const query = useCallback(
    (before?: number) => ({
      ...(action ? { action } : {}),
      ...(outcome ? { outcome } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(before ? { before: String(before) } : {}),
    }),
    [action, outcome, q],
  )

  const load = useCallback(() => {
    setError(null)
    api<Page>('/admin/audit', { query: query() })
      .then((p) => {
        setEvents(p.events)
        setNext(p.next)
        setKeepDays(p.keepDays)
      })
      .catch((err) => setError(errorText(err)))
  }, [query])

  useEffect(() => {
    const handle = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(handle)
  }, [load, q])

  async function older() {
    if (!next) return
    setMore(true)
    try {
      const p = await api<Page>('/admin/audit', { query: query(next) })
      setEvents((list) => [...(list ?? []), ...p.events])
      setNext(p.next)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setMore(false)
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="search"
          placeholder="Email or IP address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="admin-sort">
          Show
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <div className="chips">
          {OUTCOMES.map((o) => (
            <button
              key={o.key}
              className={`chip${outcome === o.key ? ' selected' : ''}`}
              aria-pressed={outcome === o.key}
              onClick={() => setOutcome(o.key)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button className="ghost small-btn" onClick={load}>
          Refresh
        </button>
      </div>

      {!events && error && <LoadFailed what={error} onRetry={load} />}
      {!events && !error && <p className="muted small">Loading…</p>}

      {events &&
        (events.length === 0 ? (
          <Empty>Nothing recorded that matches.</Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>What happened</th>
                  <th>Account</th>
                  <th>From</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className={e.outcome !== 'ok' ? `is-${e.outcome}` : ''}>
                    <td className="nowrap" title={when(e.at)}>
                      {ago(e.at)}
                    </td>
                    <td>
                      {describe(e)} <Outcome outcome={e.outcome} />
                      {e.actor_email && <span className="muted small"> · by {e.actor_email}</span>}
                    </td>
                    <td>
                      {e.user_id ? (
                        <button className="plan-link" onClick={() => onOpenPerson(e.user_id!)}>
                          {e.email ?? 'deleted account'}
                        </button>
                      ) : (
                        <span className="muted">{e.email ?? '—'}</span>
                      )}
                    </td>
                    <td className="small">
                      {e.ip ?? '—'}
                      {e.user_agent && <span className="muted"> · {device(e.user_agent)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {next && (
        <button className="ghost small-btn fit-btn" onClick={() => void older()} disabled={more}>
          {more ? 'Loading…' : 'Older'}
        </button>
      )}
      <p className="muted small">
        Sign-ins, password changes and resets, connected accounts, devices and every admin action are kept for{' '}
        {keepDays} days, then deleted. What people write is never recorded here.
      </p>
    </div>
  )
}
