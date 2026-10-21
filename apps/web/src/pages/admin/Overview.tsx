import { useCallback, useEffect, useState } from 'react'
import { USES } from '@cue/shared'
import { api } from '../../lib/api.ts'
import { errorText } from '../../lib/errors.ts'
import { LoadFailed } from '../../components/LoadFailed.tsx'
import type { AdminTab } from './AdminPortal.tsx'
import { DayBars, num, Section, Stat } from './shared.tsx'

interface OverviewData {
  users: Record<string, number>
  content: Record<string, number>
  connections: Record<string, number>
  signIns: Record<string, number>
  days: { day: string; signups: number; sign_ins: number; plans: number }[]
  uses: { use: string; n: number }[]
}

const useLabel = (key: string) => USES.find((u) => u.key === key)?.label ?? key

export function Overview({ go }: { go: (tab: AdminTab, extra?: Record<string, string>) => void }) {
  const [data, setData] = useState<OverviewData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api<OverviewData>('/admin/overview')
      .then(setData)
      .catch((err) => setError(errorText(err)))
  }, [])
  useEffect(load, [load])

  if (!data && error) return <LoadFailed what={error} onRetry={load} />
  if (!data) return <p className="muted small">Loading…</p>

  const { users, content, connections, signIns, days, uses } = data
  const maxUse = Math.max(1, ...uses.map((u) => u.n))

  return (
    <div className="admin-stack">
      <div className="admin-stats">
        <Stat
          label="People"
          value={num(users.real)}
          sub={`+${num(users.new_7d)} this week · +${num(users.new_30d)} in 30 days`}
          onClick={() => go('people', { filter: 'real' })}
        />
        <Stat
          label="Active"
          value={num(users.active_1d)}
          sub={`today · ${num(users.active_7d)} this week · ${num(users.active_30d)} in 30 days`}
          onClick={() => go('people', { filter: 'active' })}
        />
        <Stat label="Demos live" value={num(users.demos)} sub="Deleted after a day" onClick={() => go('people', { filter: 'demo' })} />
        <Stat
          label="Turned off"
          value={num(users.disabled)}
          tone={users.disabled ? 'warn' : undefined}
          onClick={() => go('people', { filter: 'disabled' })}
        />
        <Stat label="Plans" value={num(content.plans)} sub={`+${num(content.plans_1d)} today · ${num(content.done_1d)} done today`} />
        <Stat
          label="Sign-ins, 24 h"
          value={num(signIns.ok)}
          sub={`${num(signIns.failed)} failed · ${num(signIns.blocked)} refused`}
          tone={signIns.blocked > 0 || signIns.failed > 20 ? 'warn' : undefined}
          onClick={() => go('activity', { action: 'auth.login' })}
        />
        <Stat
          label="Connected accounts"
          value={num(connections.google + connections.microsoft)}
          sub={`Google ${num(connections.google)} · Microsoft ${num(connections.microsoft)} · email on ${num(connections.mail_on)}`}
          tone={connections.failing > 0 ? 'warn' : undefined}
        />
        <Stat
          label="Devices for reminders"
          value={num(connections.devices)}
          sub={`${num(connections.device_users)} people`}
        />
      </div>

      <Section title="The last 14 days">
        <div className="admin-charts">
          <DayBars title="New people" days={days} pick={(d) => d.signups} />
          <DayBars title="People signing in" days={days} pick={(d) => d.sign_ins} />
          <DayBars title="Plans made" days={days} pick={(d) => d.plans} />
        </div>
      </Section>

      <div className="admin-columns">
        <Section title="What people use Cue for">
          {uses.length === 0 ? (
            <p className="muted small">Nobody has said yet.</p>
          ) : (
            <ul className="admin-hbars">
              {uses.map((u) => (
                <li key={u.use}>
                  <span className="admin-hbar-label">{useLabel(u.use)}</span>
                  <span className="admin-hbar">
                    <span className="admin-hbar-fill" style={{ width: `${(u.n / maxUse) * 100}%` }} />
                  </span>
                  <strong>{num(u.n)}</strong>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Everything in Cue">
          <dl className="admin-facts">
            <dt>Plans</dt>
            <dd>{num(content.plans)}</dd>
            <dt>Repeating</dt>
            <dd>{num(content.repeating)}</dd>
            <dt>People saved</dt>
            <dd>{num(content.people)}</dd>
            <dt>Trips</dt>
            <dd>{num(content.trips)}</dd>
            <dt>Bills and renewals</dt>
            <dd>{num(content.bills)}</dd>
            <dt>Expenses</dt>
            <dd>{num(content.expenses)}</dd>
            <dt>Voice notes</dt>
            <dd>{num(content.voice_notes)}</dd>
          </dl>
        </Section>
      </div>
    </div>
  )
}
