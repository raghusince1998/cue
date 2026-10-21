import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Overview } from './Overview.tsx'
import { People, PersonDetail } from './People.tsx'
import { Activity } from './Activity.tsx'
import { Security } from './Security.tsx'
import { System } from './System.tsx'

/**
 * The admin portal: who uses Cue and how, what happened to accounts, how
 * secure it is, and how the running system is doing — for the accounts in
 * ADMIN_EMAILS. The server answers 404 to anyone else, whatever this page does.
 *
 * It shows how people use Cue, never what they wrote: counts, dates,
 * settings, connections and the account trail.
 */

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People' },
  { key: 'activity', label: 'Activity' },
  { key: 'security', label: 'Security' },
  { key: 'system', label: 'System' },
] as const

export type AdminTab = (typeof TABS)[number]['key']

export default function AdminPortal() {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as AdminTab
  const [person, setPerson] = useState<string | null>(null)

  const go = (next: AdminTab, extra: Record<string, string> = {}) => setParams({ tab: next, ...extra }, { replace: true })

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="muted small">
            People, account activity, security and the running system. Counts and settings only — what people write stays
            private.
          </p>
        </div>
      </header>

      <nav className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'is-on' : ''}
            onClick={() => go(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="admin-body" role="tabpanel">
        {tab === 'overview' && <Overview go={go} />}
        {tab === 'people' && <People onOpen={setPerson} initialFilter={params.get('filter')} />}
        {tab === 'activity' && <Activity onOpenPerson={setPerson} initialAction={params.get('action')} initialOutcome={params.get('outcome')} />}
        {tab === 'security' && <Security onOpenPerson={setPerson} />}
        {tab === 'system' && <System />}
      </div>

      {person && <PersonDetail id={person} onClose={() => setPerson(null)} />}
    </div>
  )
}
