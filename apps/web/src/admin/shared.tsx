import type { ReactNode } from 'react'

/**
 * Pieces the admin portal's pages share: how a time, a size, a device and an
 * account event are said, and the small charts.
 *
 * The portal is for whoever runs Cue, so it is in English, like the notice
 * review page — not part of the app people use.
 */

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'in ' + span(-ms)
  if (ms < 45_000) return 'just now'
  return span(ms) + ' ago'
}

/** "3 min", "5 h", "12 days". */
export function span(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${Math.max(1, min)} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} days`
}

export function when(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function day(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function bytes(n: number | string | null | undefined): string {
  const v = Number(n ?? 0)
  if (v < 1024) return `${v} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let x = v / 1024
  let i = 0
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024
    i++
  }
  return `${x < 10 ? x.toFixed(1) : Math.round(x)} ${units[i]}`
}

export function uptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export const num = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString()

/** "Chrome on Android", from a browser's user-agent line. */
export function device(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? 'Safari'
              : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? os ?? ua.slice(0, 40)
}

export interface AuditEvent {
  id: number | string
  at: string
  action: string
  outcome: 'ok' | 'failed' | 'blocked'
  ip: string | null
  user_agent: string | null
  detail: Record<string, unknown> | null
  user_id?: string | null
  email?: string | null
  actor_email?: string | null
}

const REASONS: Record<string, string> = {
  wrong_password: 'wrong password',
  no_account: 'no such account',
  too_many_attempts: 'too many attempts',
  too_many_requests: 'asked too often',
  account_disabled: 'account is turned off',
  invalid_token: 'link not valid',
  wrong_credentials: 'wrong email or password',
}

const PROVIDERS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' }

/** An account event, said plainly. */
export function describe(e: AuditEvent): string {
  const d = e.detail ?? {}
  const reason = d.reason ? REASONS[String(d.reason)] ?? String(d.reason) : null
  const provider = d.provider ? PROVIDERS[String(d.provider)] ?? String(d.provider) : ''
  const with_ = (s: string) => (reason ? `${s} — ${reason}` : s)
  switch (e.action) {
    case 'auth.register':
      return 'Signed up'
    case 'auth.demo':
      return d.kind === 'exams' ? 'Opened an exams demo' : 'Opened a demo'
    case 'auth.login':
      return e.outcome === 'ok' ? 'Signed in' : e.outcome === 'blocked' ? with_('Sign-in refused') : with_('Sign-in failed')
    case 'auth.password_changed':
      return e.outcome === 'ok' ? 'Changed password' : with_('Password change failed')
    case 'auth.reset_requested':
      return e.outcome === 'blocked'
        ? with_('Reset link not sent')
        : d.account === false
          ? 'Reset link asked for an address with no account'
          : 'Asked for a password reset link'
    case 'auth.reset':
      return e.outcome === 'ok' ? 'Reset password (other devices signed out)' : with_('Password reset failed')
    case 'auth.account_deleted':
      return e.outcome === 'ok' ? (d.demo ? 'Demo account deleted' : 'Deleted their account') : with_('Account deletion refused')
    case 'oauth.connected':
      return `Connected ${provider}${d.purpose === 'all' ? ' (calendar + email)' : d.purpose ? ` (${d.purpose})` : ''}`
    case 'oauth.disconnected':
      return `Disconnected ${provider}`
    case 'mail.off':
      return 'Stopped email reading'
    case 'device.added':
      return 'Added a device for reminders'
    case 'device.removed':
      return 'Removed a device'
    case 'admin.login':
      return e.outcome === 'ok' ? 'Admin signed in' : e.outcome === 'blocked' ? with_('Admin sign-in refused') : with_('Admin sign-in failed')
    case 'admin.logout':
      return 'Admin signed out'
    case 'admin.user_viewed':
      return 'Account opened in the admin portal'
    case 'admin.user_disabled':
      return d.reason ? `Turned off by an admin — “${String(d.reason)}”` : 'Turned off by an admin'
    case 'admin.user_enabled':
      return 'Turned back on by an admin'
    case 'admin.sessions_revoked':
      return 'Signed out everywhere by an admin'
    default:
      return e.action
  }
}

export function Outcome({ outcome }: { outcome: AuditEvent['outcome'] }) {
  if (outcome === 'ok') return null
  return <span className={`admin-pill is-${outcome}`}>{outcome}</span>
}

export function Stat({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'good' | 'warn' | 'bad'
  onClick?: () => void
}) {
  const body = (
    <>
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value}</strong>
      {sub && <span className="admin-stat-sub">{sub}</span>}
    </>
  )
  const className = `admin-stat${tone ? ` is-${tone}` : ''}`
  return onClick ? (
    <button type="button" className={`${className} is-link`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

/** A row of bars, one per day, with the total and the busiest day said. */
export function DayBars({
  title,
  days,
  pick,
}: {
  title: string
  days: { day: string }[]
  pick: (d: any) => number
}) {
  const values = days.map(pick)
  const max = Math.max(1, ...values)
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <div className="admin-bars">
      <div className="admin-bars-head">
        <span>{title}</span>
        <strong>{num(total)}</strong>
      </div>
      <div className="admin-bars-row" role="img" aria-label={`${title}: ${total} over ${days.length} days`}>
        {days.map((d, i) => (
          <span
            key={d.day}
            className="admin-bar"
            title={`${new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${values[i]}`}
          >
            <span className="admin-bar-fill" style={{ height: `${values[i]! > 0 ? Math.max(6, (values[i]! / max) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
      <div className="admin-bars-axis">
        <span>{new Date(days[0]!.day + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
        <span>today</span>
      </div>
    </div>
  )
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-section">
      <div className="admin-section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted small admin-empty">{children}</p>
}
