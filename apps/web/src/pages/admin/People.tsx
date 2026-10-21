import { useCallback, useEffect, useState } from 'react'
import { USES } from '@cue/shared'
import { api } from '../../lib/api.ts'
import { errorText } from '../../lib/errors.ts'
import { toast } from '../../lib/toast.ts'
import { LoadFailed } from '../../components/LoadFailed.tsx'
import { Modal } from '../../components/Modal.tsx'
import { ago, day, describe, device, Empty, num, Outcome, Section, when, type AuditEvent, DayBars } from './shared.tsx'

interface Row {
  id: string
  name: string
  email: string
  created_at: string
  last_seen_at: string | null
  is_demo: boolean
  disabled_at: string | null
  uses: string[]
  language: string
  plans: number
  people: number
  connections: number
  devices: number
  isAdmin: boolean
}

const FILTERS = [
  { key: 'real', label: 'Everyone' },
  { key: 'active', label: 'Active this week' },
  { key: 'inactive', label: 'Quiet 30+ days' },
  { key: 'demo', label: 'Demos' },
  { key: 'disabled', label: 'Turned off' },
  { key: 'all', label: 'All, with demos' },
] as const

const useLabel = (key: string) => USES.find((u) => u.key === key)?.label ?? key

function Badges({ u }: { u: { isAdmin?: boolean; is_demo?: boolean; disabled_at?: string | null } }) {
  return (
    <>
      {u.isAdmin && <span className="admin-pill is-admin">admin</span>}
      {u.is_demo && <span className="admin-pill">demo</span>}
      {u.disabled_at && <span className="admin-pill is-blocked">off</span>}
    </>
  )
}

export function People({ onOpen, initialFilter }: { onOpen: (id: string) => void; initialFilter: string | null }) {
  const [filter, setFilter] = useState<string>(FILTERS.some((f) => f.key === initialFilter) ? initialFilter! : 'real')
  const [sort, setSort] = useState<'active' | 'joined'>('active')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [data, setData] = useState<{ total: number; pageSize: number; users: Row[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api<{ total: number; pageSize: number; users: Row[] }>('/admin/users', {
      query: { filter, sort, page: String(page), ...(q.trim() ? { q: q.trim() } : {}) },
    })
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [filter, sort, page, q])

  // Typing waits for a pause; the rest asks at once.
  useEffect(() => {
    const handle = setTimeout(load, q ? 250 : 0)
    return () => clearTimeout(handle)
  }, [load, q])

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <input
          className="admin-search"
          type="search"
          placeholder="Search by name or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(0)
          }}
        />
        <div className="chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`chip${filter === f.key ? ' selected' : ''}`}
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key)
                setPage(0)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="admin-sort">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as 'active' | 'joined')}>
            <option value="active">Last active</option>
            <option value="joined">Newest</option>
          </select>
        </label>
      </div>

      {!data && error && <LoadFailed what={error} onRetry={load} />}
      {!data && !error && <p className="muted small">Loading…</p>}

      {data && (
        <>
          <p className="muted small">
            {num(data.total)} {data.total === 1 ? 'account' : 'accounts'}
          </p>
          {data.users.length === 0 ? (
            <Empty>Nobody matches.</Empty>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Joined</th>
                    <th>Last active</th>
                    <th>Uses Cue for</th>
                    <th className="num">Plans</th>
                    <th className="num">People</th>
                    <th className="num">Connected</th>
                    <th className="num">Devices</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id} className="is-link" tabIndex={0} onClick={() => onOpen(u.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(u.id)}>
                      <td>
                        <span className="admin-who">
                          <strong>{u.name}</strong> <Badges u={u} />
                        </span>
                        <span className="muted small">{u.email}</span>
                      </td>
                      <td title={when(u.created_at)}>{day(u.created_at)}</td>
                      <td title={when(u.last_seen_at)}>{u.last_seen_at ? ago(u.last_seen_at) : <span className="muted">never</span>}</td>
                      <td className="small">{u.uses.length ? u.uses.map(useLabel).join(', ') : <span className="muted">not said</span>}</td>
                      <td className="num">{num(u.plans)}</td>
                      <td className="num">{num(u.people)}</td>
                      <td className="num">{num(u.connections)}</td>
                      <td className="num">{num(u.devices)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="row admin-pager">
              <button className="ghost small-btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                ← Newer
              </button>
              <span className="muted small">
                Page {page + 1} of {pages}
              </span>
              <button className="ghost small-btn" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Older →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface Detail {
  user: Record<string, any>
  counts: Record<string, number>
  connections: Record<string, any>[]
  devices: { id: string; user_agent: string | null; created_at: string }[]
  activity: { day: string; plans: number; done: number }[]
  events: AuditEvent[]
}

const COUNTS: [string, string][] = [
  ['plans_open', 'Open plans'],
  ['plans_done', 'Done'],
  ['repeating', 'Repeating'],
  ['people', 'People'],
  ['places', 'Places'],
  ['trips', 'Trips'],
  ['bills', 'Bills'],
  ['expenses', 'Expenses'],
  ['tracked', 'Tracked items'],
  ['voice_notes', 'Voice notes'],
]

const NOTIFICATIONS: [string, string][] = [
  ['morning_brief_enabled', 'Morning brief'],
  ['daily_nudge_enabled', 'Evening nudge'],
  ['weekly_review_enabled', 'Weekly review'],
  ['report_enabled', 'Daily report'],
  ['followup_prompts', 'Follow-up questions'],
  ['prep_prompts', 'Meeting prep'],
]

/** One person: their account, how they use Cue, their connections and trail — and what an admin can do about it. */
export function PersonDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setError(null)
    api<Detail>(`/admin/users/${id}`)
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [id])
  useEffect(load, [load])

  async function act(path: string, done: string, body?: Record<string, unknown>) {
    setBusy(true)
    try {
      await api(`/admin/users/${id}/${path}`, { method: 'POST', body: body ?? {} })
      toast(done)
      load()
    } catch (err) {
      const code = (err as { code?: string }).code
      toast(code === 'protected_account' ? 'Admins cannot be changed from here.' : errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const u = data?.user
  return (
    <Modal title={u ? u.name : 'Person'} onClose={onClose}>
      {!data && error && <LoadFailed what={error} onRetry={load} />}
      {!data && !error && <p className="muted small">Loading…</p>}
      {data && u && (
        <div className="admin-stack admin-person">
          <div className="admin-person-head">
            <div>
              <p className="admin-who">
                <strong>{u.email}</strong> <Badges u={u} />
              </p>
              <p className="muted small">
                Joined {day(u.created_at)} · last active {u.last_seen_at ? ago(u.last_seen_at) : 'never'} ·{' '}
                {u.language === 'hi' ? 'Hindi' : 'English'} · {u.timezone}
              </p>
              {u.disabled_at && (
                <p className="error small">
                  Turned off {ago(u.disabled_at)}
                  {u.disabled_reason ? ` — “${u.disabled_reason}”` : ''}. They cannot sign in, and their devices are
                  signed out.
                </p>
              )}
            </div>
            {!u.isAdmin && (
              <div className="row admin-actions">
                <button
                  className="ghost small-btn"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Sign ${u.email} out on every device? They can sign in again.`)) {
                      void act('sign-out', 'Signed out everywhere.')
                    }
                  }}
                >
                  Sign out everywhere
                </button>
                {u.disabled_at ? (
                  <button className="ghost small-btn" disabled={busy} onClick={() => void act('enable', 'Turned back on.')}>
                    Turn back on
                  </button>
                ) : (
                  <button
                    className="ghost small-btn danger-text"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        `Turn off ${u.email}? They will be signed out and cannot sign in until it is turned back on. Nothing is deleted.\n\nReason (kept in the activity log):`,
                      )
                      if (reason !== null) void act('disable', 'Turned off.', { reason })
                    }}
                  >
                    Turn off
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="muted small">
            Uses Cue for: {u.uses?.length ? u.uses.map(useLabel).join(', ') : 'not said yet'}
          </p>

          <div className="admin-counts">
            {COUNTS.map(([key, label]) => (
              <div key={key}>
                <strong>{num(data.counts[key])}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>

          <div className="admin-charts">
            <DayBars title="Plans made, 30 days" days={data.activity} pick={(d) => d.plans} />
            <DayBars title="Plans done, 30 days" days={data.activity} pick={(d) => d.done} />
          </div>

          <Section title="Notifications">
            <ul className="admin-tags">
              {NOTIFICATIONS.map(([key, label]) => (
                <li key={key} className={u[key] ? 'is-on' : ''}>
                  {label}: {u[key] ? 'on' : 'off'}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Connected accounts">
            {data.connections.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ul className="admin-list">
                {data.connections.map((c) => (
                  <li key={c.id}>
                    <div>
                      <strong>{c.provider === 'google' ? 'Google' : c.provider === 'microsoft' ? 'Microsoft' : c.provider}</strong>{' '}
                      · {c.email} {c.status !== 'active' && <span className="admin-pill is-failed">{c.status}</span>}
                    </div>
                    <div className="muted small">
                      Since {day(c.created_at)} · {num(c.calendars)} {c.calendars === 1 ? 'calendar' : 'calendars'} · email{' '}
                      {c.mail_enabled ? `on, checked ${ago(c.mail_checked_at)}` : 'off'}
                    </div>
                    {(c.last_error || c.mail_error) && <div className="error small">{c.last_error ?? c.mail_error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Devices for reminders">
            {data.devices.length === 0 ? (
              <Empty>None — reminders cannot reach them.</Empty>
            ) : (
              <ul className="admin-list">
                {data.devices.map((d) => (
                  <li key={d.id}>
                    <strong>{device(d.user_agent)}</strong> <span className="muted small">· added {day(d.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Account activity">
            {data.events.length === 0 ? (
              <Empty>Nothing recorded yet.</Empty>
            ) : (
              <ul className="admin-events">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <span className="admin-event-when" title={when(e.at)}>
                      {ago(e.at)}
                    </span>
                    <span>
                      {describe(e)} <Outcome outcome={e.outcome} />
                      <span className="muted small">
                        {e.actor_email ? ` · by ${e.actor_email}` : ''}
                        {e.ip ? ` · ${e.ip}` : ''}
                        {e.user_agent ? ` · ${device(e.user_agent)}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </Modal>
  )
}
