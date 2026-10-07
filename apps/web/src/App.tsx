import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './lib/auth.tsx'
import { startSyncLoop } from './lib/online.ts'
import { SyncStatus } from './components/SyncStatus.tsx'
import { Modal } from './components/Modal.tsx'
import { Settings } from './components/Settings.tsx'
import { Search } from './components/Search.tsx'
import { api } from './lib/api.ts'
import Login from './pages/Login.tsx'
import Today from './pages/Today.tsx'
import LogVisit from './pages/LogVisit.tsx'
import Places from './pages/Places.tsx'
import Trips from './pages/Trips.tsx'
import Repeating from './pages/Repeating.tsx'
import History from './pages/History.tsx'
import People from './pages/People.tsx'

function Nav({
  onOpenSettings,
  onOpenSearch,
}: {
  onOpenSettings: () => void
  onOpenSearch: () => void
}) {
  const { me, logout } = useAuth()

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          Cue
        </div>
        <div className="topbar-right">
          {/* A bordered control rather than a fourth text link. Search was
              there all along and nobody could find it, because next to
              "Settings" and "Sign out" it read as more chrome. */}
          <button className="searchbtn" onClick={onOpenSearch} title="Search everything (Ctrl K)">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <span>Search</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="org">{me?.orgName}</span>
          <button className="link" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="link" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs">
        <NavLink to="/" end>
          Today
        </NavLink>
        <NavLink to="/log" className="tab-primary">
          Add
        </NavLink>
        <NavLink to="/history">History</NavLink>
        <NavLink to="/trips">Trips</NavLink>
        <NavLink to="/repeating">Repeating</NavLink>
        <NavLink to="/people">People</NavLink>
      </nav>
    </>
  )
}

export default function App() {
  const { me, loading } = useAuth()

  // Returning from Google's consent screen lands on the root carrying the
  // outcome. Opening Settings straight away is the difference between "it
  // worked" and being dropped back on Today wondering whether it did.
  const [settingsOpen, setSettingsOpen] = useState(
    () => new URLSearchParams(window.location.search).has('connected'),
  )
  const [searchOpen, setSearchOpen] = useState(false)

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
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drains anything captured offline as soon as there is a connection again.
  useEffect(() => {
    if (!me) return
    return startSyncLoop()
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

  if (loading) {
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    )
  }

  if (!me) return <Login />

  return (
    <div className="app">
      <Nav
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <main className="content">
        <SyncStatus />
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/log" element={<LogVisit />} />
          <Route path="/history" element={<History />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/repeating" element={<Repeating />} />
          <Route path="/people" element={<People />} />
          <Route path="/places" element={<Places />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {searchOpen && (
        <Modal title="Search" onClose={() => setSearchOpen(false)}>
          <Search onClose={() => setSearchOpen(false)} />
        </Modal>
      )}

      {settingsOpen && (
        <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
          <Settings onClose={() => setSettingsOpen(false)} />
        </Modal>
      )}
    </div>
  )
}
