import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Toasts } from '../components/Toasts.tsx'
import { adminApi, adminSession, onAdminSignedOut, setAdminSession, type AdminSession } from './api.ts'
import { Overview } from './Overview.tsx'
import { People, PersonDetail } from './People.tsx'
import { Activity } from './Activity.tsx'
import { Security } from './Security.tsx'
import { System } from './System.tsx'

/**
 * The admin portal (/admin): a separate view from the app people use, with
 * its own session and layout. Signing in is the same page as everyone's: the
 * admin's email and password (ADMIN_EMAIL / ADMIN_PASSWORD on the server)
 * bring you here. A user's session is never used.
 *
 * It shows how people use Cue, never what they wrote: counts, dates,
 * settings, connections and the account trail.
 */

const TABS = [
  { key: 'overview', label: 'Overview', hint: 'People, activity and growth at a glance' },
  { key: 'people', label: 'People', hint: 'Every account: how it is used, its connections and trail' },
  { key: 'activity', label: 'Activity', hint: 'Sign-ins, password changes, connections, devices and admin actions' },
  { key: 'security', label: 'Security', hint: 'Failed sign-ins, who is held back, and settings to fix' },
  { key: 'system', label: 'System', hint: 'The running server, background jobs, queues and the database' },
] as const

export type AdminTab = (typeof TABS)[number]['key']

export default function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(() => adminSession())
  const [checked, setChecked] = useState(false)
  const [ended, setEnded] = useState(false)

  useEffect(() => {
    document.title = 'Cue Admin'
  }, [])

  // A stored session might have ended on the server (password changed):
  // ask once on opening, and go back to sign-in whenever a request is refused.
  useEffect(() => {
    if (!session) {
      setChecked(true)
      return
    }
    adminApi<{ email: string }>('/admin/session')
      .catch(() => undefined)
      .finally(() => setChecked(true))
  }, [])

  useEffect(
    () =>
      onAdminSignedOut(() => {
        setSession(null)
        setEnded(true)
      }),
    [],
  )

  // No admin session: the one sign-in page everyone uses, which brings the
  // admin back here.
  useEffect(() => {
    if (checked && !session) window.location.replace(ended ? '/login?admin=ended' : '/login?admin')
  }, [checked, session, ended])

  if (!checked || !session) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  return (
    <>
      <Portal
        email={session.email}
        onSignOut={() => {
          void adminApi('/admin/logout', { method: 'POST' })
            .catch(() => undefined)
            .finally(() => {
              setAdminSession(null)
              window.location.assign('/login')
            })
        }}
      />
      <Toasts />
    </>
  )
}

function Portal({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as AdminTab
  const current = TABS.find((t) => t.key === tab)!
  const [person, setPerson] = useState<string | null>(null)

  const go = (next: AdminTab, extra: Record<string, string> = {}) => {
    setParams({ tab: next, ...extra })
    window.scrollTo(0, 0)
  }

  return (
    <div className="admin-app">
      <aside className="admin-side">
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden>
            C
          </span>
          <span>
            Cue <strong>Admin</strong>
          </span>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          {TABS.map((t) => (
            <button key={t.key} className={tab === t.key ? 'is-on' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="admin-side-foot">
          <span className="admin-side-who" title={email}>
            {email}
          </span>
          <button className="admin-signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-page-head">
          <h1>{current.label}</h1>
          <p>{current.hint}</p>
        </header>
        <div className="admin">
          {tab === 'overview' && <Overview go={go} />}
          {tab === 'people' && <People onOpen={setPerson} initialFilter={params.get('filter')} />}
          {tab === 'activity' && (
            <Activity onOpenPerson={setPerson} initialAction={params.get('action')} initialOutcome={params.get('outcome')} />
          )}
          {tab === 'security' && <Security onOpenPerson={setPerson} />}
          {tab === 'system' && <System />}
        </div>
        <p className="admin-privacy">Counts, dates, settings and account events only — what people write stays private.</p>
      </main>

      {person && <PersonDetail id={person} onClose={() => setPerson(null)} />}
    </div>
  )
}
