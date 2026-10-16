import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './lib/auth.tsx'
import { language, msg, t } from './lib/i18n.tsx'
import { startSyncLoop } from './lib/online.ts'
import { SyncStatus } from './components/SyncStatus.tsx'
import { Modal } from './components/Modal.tsx'
import { Settings } from './components/Settings.tsx'
import { Search } from './components/Search.tsx'
import { AddPanel } from './components/AddPanel.tsx'
import { CallTracker } from './components/CallTracker.tsx'
import { Toasts } from './components/Toasts.tsx'
import { api } from './lib/api.ts'
import { useOpenAdd, type AddOptions } from './lib/addSheet.ts'
import { resyncPush } from './lib/push.ts'
import Login from './pages/Login.tsx'
import ResetPassword from './pages/ResetPassword.tsx'
import Today from './pages/Today.tsx'
import Places from './pages/Places.tsx'
import Trips from './pages/Trips.tsx'
import Repeating from './pages/Repeating.tsx'
import History from './pages/History.tsx'
import People from './pages/People.tsx'
import Expenses from './pages/Expenses.tsx'
import Tracker from './pages/Tracker.tsx'
import Home from './pages/Home.tsx'
import { PrivacyPage, TermsPage } from './pages/Legal.tsx'
import Bills from './pages/Bills.tsx'
import Exams from './pages/Exams.tsx'
import NoticeReview from './pages/NoticeReview.tsx'
import ExamsHome from './pages/ExamsHome.tsx'
import { appMode } from './lib/appMode.ts'
import { groupSections, tabsFor, type Section } from '@cue/shared'
import { UsesPicker } from './components/UsesPicker.tsx'

/** Every section that has a page, and where it lives. */
const SECTION_LINKS: Partial<Record<Section, { to: string; label: string }>> = {
  people: { to: '/people', label: msg('People') },
  history: { to: '/history', label: msg('History') },
  trips: { to: '/trips', label: msg('Trips') },
  repeating: { to: '/repeating', label: msg('Repeating') },
  expenses: { to: '/expenses', label: msg('Expenses') },
  jobs: { to: '/jobs', label: msg('Jobs') },
  hiring: { to: '/hiring', label: msg('Hiring') },
  deals: { to: '/deals', label: msg('Deals') },
  bills: { to: '/bills', label: msg('Bills') },
  exams: { to: '/exams', label: msg('Exams') },
}
const AVAILABLE = Object.keys(SECTION_LINKS) as Section[]

/**
 * The rest of the sections, a tap away: what this person uses Cue for decides
 * what is on the bar, and whether Jobs, Hiring and Deals are here at all.
 */
function MoreMenu({ sections, onChangeUses, admin }: { sections: Section[]; onChangeUses: () => void; admin: boolean }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const ref = useRef<HTMLDivElement>(null)
  const here = sections.some((s) => location.pathname.startsWith(SECTION_LINKS[s]!.to))

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  return (
    <div className="tabs-more" ref={ref}>
      <button
        className={`tabs-more-btn${here ? ' active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {t('More')}
      </button>
      {open && (
        <div className="tabs-menu" role="menu">
          {/* Under headings once there is more than one kind of thing in it. */}
          {groupSections(sections).map((g, _, groups) => (
            <div key={g.label} className="tabs-menu-group" role="group" aria-label={t(g.label)}>
              {groups.length > 1 && <span className="tabs-menu-heading">{t(g.label)}</span>}
              {g.sections.map((s) => (
                <NavLink key={s} to={SECTION_LINKS[s]!.to} role="menuitem">
                  {t(SECTION_LINKS[s]!.label)}
                </NavLink>
              ))}
            </div>
          ))}
          {admin && (
            <NavLink to="/admin/notices" role="menuitem" className="tabs-menu-admin">
              {t('Review exam notices')}
            </NavLink>
          )}
          <button
            className="tabs-menu-uses"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onChangeUses()
            }}
          >
            {t('What I use Cue for…')}
          </button>
        </div>
      )}
    </div>
  )
}

function Nav({
  onOpenSettings,
  onOpenSearch,
  onOpenAdd,
}: {
  onOpenSettings: () => void
  onOpenSearch: () => void
  onOpenAdd: () => void
}) {
  const { logout, me } = useAuth()
  const [choosingUses, setChoosingUses] = useState(false)
  const { main, more } = tabsFor(me?.uses ?? [], AVAILABLE, me?.filled ?? [])

  return (
    <>
      <header className="topbar">
        {/* Cue Exams, when that is the door they came in by. */}
        <div className="brand">
          <img className="brand-mark" src={appMode() === 'exams' ? '/brand/cue-exams-mark.svg' : '/brand/cue-mark.svg'} alt="" />
          {/* The longer name gives way to its mark on a small phone. */}
          <span className={`brand-name${appMode() === 'exams' ? ' is-long' : ''}`}>{appMode() === 'exams' ? 'Cue Exams' : 'Cue'}</span>
        </div>
        <div className="topbar-right">
          {/* The one thing this app is for, so the one button that is always
              there, and the only way in. It opens everything adding can do —
              the one line, the detailed form, a visit that already happened —
              over whatever is on screen, rather than leaving it for a page. */}
          <button className="addbtn" onClick={onOpenAdd} title="Add something (N)">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t('Add')}</span>
          </button>
          {/* A bordered control rather than a fourth text link. Search was
              there all along and nobody could find it, because next to
              "Settings" and "Sign out" it read as more chrome. */}
          <button className="searchbtn" onClick={onOpenSearch} title="Search everything (Ctrl K)">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <span>{t('Search')}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="link" onClick={onOpenSettings}>
            {t('Settings')}
          </button>
          <button className="link" onClick={logout}>
            {t('Sign out')}
          </button>
        </div>
      </header>

      <nav className="tabs">
        {/* No Add tab: it went to the same place as the Add button beside
            the logo, so it was one destination taking two slots. */}
        <NavLink to="/" end>
          {t('Today')}
        </NavLink>
        {main.map((s) => (
          <NavLink key={s} to={SECTION_LINKS[s]!.to}>
            {t(SECTION_LINKS[s]!.label)}
          </NavLink>
        ))}
        <MoreMenu sections={more} onChangeUses={() => setChoosingUses(true)} admin={Boolean(me?.isAdmin)} />
      </nav>

      {choosingUses && (
        <Modal title={t('What do you use Cue for?')} onClose={() => setChoosingUses(false)}>
          <UsesPicker onDone={() => setChoosingUses(false)} />
        </Modal>
      )}
    </>
  )
}

export default function App() {
  const { me, loading, logout } = useAuth()

  // Returning from Google's consent screen lands on the root carrying the
  // outcome. Opening Settings straight away is the difference between "it
  // worked" and being dropped back on Today wondering whether it did.
  const [settingsOpen, setSettingsOpen] = useState(
    () => {
      const q = new URLSearchParams(window.location.search)
      return q.has('connected') || q.has('settings')
    },
  )
  const [searchOpen, setSearchOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addOptions, setAddOptions] = useState<AddOptions>({})
  const location = useLocation()
  const navigate = useNavigate()

  // "Found in your email", or anything else that names Settings: open at that section.
  useEffect(() => {
    if (new URLSearchParams(location.search).has('settings')) setSettingsOpen(true)
  }, [location.search])

  // A notification tapped while Cue is open: the service worker hands over
  // the address, and the app goes there without reloading.
  useEffect(() => {
    const worker = navigator.serviceWorker
    if (!worker) return
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; url?: string } | null
      if (data?.type !== 'cue:open' || !data.url?.startsWith('/')) return
      e.ports[0]?.postMessage('ok')
      setSearchOpen(false)
      navigate(data.url)
    }
    worker.addEventListener('message', onMessage)
    return () => worker.removeEventListener('message', onMessage)
  }, [navigate])
  /** Set while turning an old /log link into the sheet, so the redirect that
   *  follows does not close the sheet it just opened. */
  const openedFromLink = useRef(false)

  const showAdd = useCallback((options: AddOptions = {}) => {
    setAddOptions(options)
    setAddOpen(true)
  }, [])

  // History's "Record something", and anything else that wants to add.
  useOpenAdd(showAdd)

  useEffect(() => {
    // Adding used to be a page at /log. Bookmarks, an installed app's saved
    // start URL and old links still point there, so it opens the sheet on Today.
    if (location.pathname === '/log') {
      const query = new URLSearchParams(location.search)
      showAdd({ mode: query.get('mode') === 'past' ? 'past' : 'upcoming', full: query.get('full') === '1' })
      openedFromLink.current = true
      navigate('/', { replace: true })
      return
    }
    if (openedFromLink.current) {
      openedFromLink.current = false
      return
    }
    // Anything inside the sheet that navigates — a saved trip opening Trips —
    // has left the sheet behind, so it closes. Search too: a result's link
    // has taken you somewhere.
    setAddOpen(false)
    setSearchOpen(false)
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        /^(input|textarea|select)$/i.test(e.target.tagName)

      // Ctrl/Cmd+K anywhere, or a bare "/" when not already in a field — the
      // two conventions people already have fingers for.
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault()
        setSearchOpen(true)
      }

      // "n" for new, the same way "/" is search. Only outside a field and with
      // no modifier, so it never eats a letter somebody was typing.
      if (e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        showAdd()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showAdd])

  // Drains anything captured offline as soon as there is a connection again.
  useEffect(() => {
    if (!me) return
    return startSyncLoop()
  }, [me])

  // Make sure the server can still reach this device. See resyncPush.
  useEffect(() => {
    if (!me) return
    void resyncPush()
  }, [me])

  // The evening nudge fires in the user's local time, so tell the server what
  // that is rather than making them pick a timezone from a list.
  useEffect(() => {
    if (!me) return
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!zone) return
    void api('/me/preferences', { method: 'PATCH', body: { timezone: zone } }).catch(
      () => undefined,
    )
  }, [me])

  // The tab says Cue, in any language — not the website's English headline,
  // which index.html carries for link previews. The pages with a title of
  // their own (the website, the policies) set it themselves.
  useEffect(() => {
    const own = ['/privacy', '/terms'].includes(location.pathname) || (!me && ['/', '/exams-app', '/exams'].includes(location.pathname))
    if (!own) document.title = appMode() === 'exams' ? 'Cue Exams' : 'Cue'
  }, [me, location.pathname])

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (!me) {
    // Signed out: the website, its doors in, its policies — and a reset link,
    // which by definition is clicked by somebody who cannot sign in.
    return (
      <Routes>
        <Route path="/" element={appMode() === 'exams' ? <ExamsHome /> : <Home />} />
        <Route path="/exams-app" element={<ExamsHome />} />
        <Route path="/exams" element={<ExamsHome />} />
        <Route path="/login" element={<Login initialMode="login" />} />
        <Route path="/register" element={<Login initialMode="register" />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to={appMode() === 'exams' ? '/exams-app' : '/login'} replace />} />
      </Routes>
    )
  }

  // The policies are pages of the website, signed in or not: full width, their own header.
  if (location.pathname === '/privacy') return <PrivacyPage />
  if (location.pathname === '/terms') return <TermsPage />

  // Keyed on the language, so choosing Hindi in Settings redraws every screen in it.
  return (
    <div className="app" key={language()}>
      {me.isDemo && (
        <div className="demo-banner">
          <span>
            {me.uses.includes('exams')
              ? t('You’re trying Cue Exams with a sample aspirant’s account. It’s deleted after a day.')
              : t('You’re trying Cue with a sample week. It’s deleted after a day.')}
          </span>
          <button
            className="primary small-btn"
            onClick={() => {
              logout()
              navigate('/register')
            }}
          >
            {t('Create your free account')}
          </button>
        </div>
      )}
      <Nav
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenAdd={() => showAdd()}
      />
      <main className="content">
        <SyncStatus />
        <Routes>
          <Route path="/" element={<Today />} />
          {/* Opens the Add sheet and moves to Today; see the effect above. */}
          <Route path="/log" element={null} />
          <Route path="/history" element={<History />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/repeating" element={<Repeating />} />
          <Route path="/people" element={<People />} />
          <Route path="/places" element={<Places />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/jobs" element={<Tracker key="jobs" board="jobs" />} />
          <Route path="/hiring" element={<Tracker key="hiring" board="hiring" />} />
          <Route path="/deals" element={<Tracker key="deals" board="deals" />} />
          <Route path="/bills" element={<Bills />} />
          {/* A reset link opened while signed in still sets the new password. */}
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/exams" element={<Exams />} />
          <Route path="/admin/notices" element={me?.isAdmin ? <NoticeReview /> : <Navigate to="/" replace />} />
          {/* Just signed in or up: Cue Exams opens on the exams. */}
          <Route path="/login" element={<Navigate to={appMode() === 'exams' ? '/exams' : '/'} replace />} />
          <Route path="/register" element={<Navigate to={appMode() === 'exams' ? '/exams' : '/'} replace />} />
          <Route path="/exams-app" element={<Navigate to="/exams" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Asks how a call went when you come back from it. */}
      <CallTracker />

      <Toasts />

      {addOpen && (
        <Modal title={t('Add')} onClose={() => setAddOpen(false)} closeOnBackdrop={false}>
          <AddPanel
            initialMode={addOptions.mode}
            initialFull={addOptions.full || addOptions.repeat}
            initialRepeat={addOptions.repeat}
            initialSchedule={addOptions.schedule}
            initialShare={addOptions.share}
            initialShareWith={addOptions.shareWith}
            initialText={addOptions.text}
            onDone={() => setAddOpen(false)}
          />
        </Modal>
      )}

      {searchOpen && (
        <Modal title={t('Search')} onClose={() => setSearchOpen(false)}>
          <Search onClose={() => setSearchOpen(false)} />
        </Modal>
      )}

      {settingsOpen && (
        <Modal title={t('Settings')} onClose={() => setSettingsOpen(false)}>
          <Settings onClose={() => setSettingsOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
