import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api.ts'
import { errorText } from '../../lib/errors.ts'
import { LoadFailed } from '../../components/LoadFailed.tsx'
import { ago, describe, Empty, num, Outcome, Section, Stat, when, type AuditEvent } from './shared.tsx'

interface SecurityData {
  signIns: Record<string, number>
  byIp: { ip: string; failures: number; accounts: number; last_at: string }[]
  byAccount: { email: string; has_account: boolean; failures: number; addresses: number; last_at: string }[]
  held: { rule: string; subject: string; tries: number; until: string }[]
  rules: Record<string, { limit: number; windowMs: number }>
  resets: (AuditEvent & { email: string | null })[]
  adminActions: (AuditEvent & { email: string | null })[]
  disabled: { id: string; email: string; disabled_at: string; disabled_reason: string | null }[]
  admins: { email: string; hasAccount: boolean; lastSeenAt: string | null }[]
  checks: { key: string; label: string; ok: boolean; note: string }[]
  manual: string[]
}

const RULE_LABELS: Record<string, string> = {
  loginIp: 'Sign-ins from this address',
  loginEmail: 'Sign-ins to this account',
  resetEmail: 'Reset links for this account',
  resetIp: 'Reset links from this address',
}

export function Security({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const [data, setData] = useState<SecurityData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api<SecurityData>('/admin/security')
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [])
  useEffect(load, [load])

  if (!data && error) return <LoadFailed what={error} onRetry={load} />
  if (!data) return <p className="muted small">Loading…</p>

  const s = data.signIns
  const failing = data.checks.filter((c) => !c.ok).length
  const minutes = (ms: number) => Math.round(ms / 60_000)

  return (
    <div className="admin-stack">
      <div className="admin-stats">
        <Stat label="Sign-ins, 24 h" value={num(s.ok_1d)} sub={`${num(s.ok_7d)} in 7 days`} />
        <Stat
          label="Failed, 24 h"
          value={num(s.failed_1d)}
          sub={`${num(s.failed_7d)} in 7 days`}
          tone={s.failed_1d > 20 ? 'warn' : undefined}
        />
        <Stat
          label="Refused, 24 h"
          value={num(s.blocked_1d)}
          sub={`${num(s.blocked_7d)} in 7 days`}
          tone={s.blocked_1d > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Settings to fix"
          value={failing}
          sub={`of ${data.checks.length} checked`}
          tone={failing ? 'bad' : 'good'}
        />
      </div>

      <div className="admin-columns">
        <Section title="Server settings">
          <ul className="admin-checks">
            {data.checks.map((c) => (
              <li key={c.key} className={c.ok ? 'is-ok' : 'is-bad'}>
                <span className="admin-check-mark" aria-hidden>
                  {c.ok ? '✓' : '!'}
                </span>
                <span>
                  <strong>{c.label}</strong>
                  {!c.ok && <span className="muted small"> — {c.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Check by hand">
          <p className="muted small">The server cannot see these itself. Worth confirming now and then:</p>
          <ul className="admin-checks">
            {data.manual.map((m) => (
              <li key={m} className="is-manual">
                <span className="admin-check-mark" aria-hidden>
                  ?
                </span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title="Held back right now">
        {data.held.length === 0 ? (
          <Empty>Nobody — no address or account has hit a limit.</Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Limit</th>
                  <th>Who</th>
                  <th className="num">Tries</th>
                  <th>Until</th>
                </tr>
              </thead>
              <tbody>
                {data.held.map((x) => (
                  <tr key={x.rule + x.subject}>
                    <td>{RULE_LABELS[x.rule] ?? x.rule}</td>
                    <td>{x.subject}</td>
                    <td className="num">{x.tries}</td>
                    <td title={when(x.until)}>{ago(x.until)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Limits: {data.rules.loginEmail?.limit} wrong passwords for one account, or {data.rules.loginIp?.limit} from one
          address, in {minutes(data.rules.loginEmail?.windowMs ?? 0)} minutes; {data.rules.resetEmail?.limit} reset links
          for one account an hour.
        </p>
      </Section>

      <div className="admin-columns">
        <Section title="Failed sign-ins by address, 24 h">
          {data.byIp.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Address</th>
                  <th className="num">Failed</th>
                  <th className="num">Accounts</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {data.byIp.map((r) => (
                  <tr key={r.ip} className={r.accounts > 3 ? 'is-blocked' : ''}>
                    <td>{r.ip}</td>
                    <td className="num">{r.failures}</td>
                    <td className="num">{r.accounts}</td>
                    <td title={when(r.last_at)}>{ago(r.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">One address trying many accounts is someone working through a list.</p>
        </Section>

        <Section title="Failed sign-ins by account, 7 days">
          {data.byAccount.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Failed</th>
                  <th className="num">Addresses</th>
                  <th>Last</th>
                </tr>
              </thead>
              <tbody>
                {data.byAccount.map((r) => (
                  <tr key={r.email}>
                    <td>
                      {r.email}
                      {!r.has_account && <span className="muted small"> · no such account</span>}
                    </td>
                    <td className="num">{r.failures}</td>
                    <td className="num">{r.addresses}</td>
                    <td title={when(r.last_at)}>{ago(r.last_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <div className="admin-columns">
        <Section title="Admins">
          <ul className="admin-list">
            {data.admins.length === 0 && <Empty>None set — ADMIN_EMAILS is empty.</Empty>}
            {data.admins.map((a) => (
              <li key={a.email}>
                <strong>{a.email}</strong>{' '}
                <span className="muted small">
                  {a.hasAccount ? `· last active ${ago(a.lastSeenAt)}` : '· no account with this email yet'}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Turned off">
          {data.disabled.length === 0 ? (
            <Empty>No accounts are turned off.</Empty>
          ) : (
            <ul className="admin-list">
              {data.disabled.map((d) => (
                <li key={d.id}>
                  <button className="plan-link" onClick={() => onOpenPerson(d.id)}>
                    {d.email}
                  </button>{' '}
                  <span className="muted small">
                    · {ago(d.disabled_at)}
                    {d.disabled_reason ? ` — “${d.disabled_reason}”` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="admin-columns">
        <Section title="Passwords">
          {data.resets.length === 0 ? (
            <Empty>No password changes or resets yet.</Empty>
          ) : (
            <ul className="admin-events">
              {data.resets.map((e) => (
                <li key={e.id}>
                  <span className="admin-event-when" title={when(e.at)}>
                    {ago(e.at)}
                  </span>
                  <span>
                    {describe(e)} <Outcome outcome={e.outcome} />
                    <span className="muted small">
                      {e.email ? ` · ${e.email}` : ''}
                      {e.ip ? ` · ${e.ip}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Admin actions">
          {data.adminActions.length === 0 ? (
            <Empty>No admin has changed an account yet.</Empty>
          ) : (
            <ul className="admin-events">
              {data.adminActions.map((e) => (
                <li key={e.id}>
                  <span className="admin-event-when" title={when(e.at)}>
                    {ago(e.at)}
                  </span>
                  <span>
                    {describe(e)}
                    <span className="muted small">
                      {e.email ? ` · ${e.email}` : ''}
                      {e.actor_email ? ` · by ${e.actor_email}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  )
}
