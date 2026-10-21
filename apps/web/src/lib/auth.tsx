import { language, setLanguage } from './i18n.tsx'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { FILLABLE, sectionsFor } from '@cue/shared'
import { ApiError, api, getToken, setToken } from './api.ts'
import { useOnChange } from './changes.ts'
import { stopPushHere } from './push.ts'
import { setAdminSession, type AdminSession } from '../admin/api.ts'

const ME_KEY = 'cue.me'

function lastKnownMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY)
    return raw ? (JSON.parse(raw) as Me) : null
  } catch {
    return null
  }
}

export interface Me {
  id: string
  name: string
  email: string
  orgId: string
  orgName: string
  /** What they use Cue for; empty until they say. */
  uses: string[]
  /** Sections with something in them ('bills', 'jobs'…): their tabs show whatever was picked. */
  filled?: string[]
  /** A one-tap demo from the website, with sample data, gone after a day. */
  isDemo?: boolean
  /** Reviews official exam notices before they go out (ADMIN_EMAILS on the server). */
  isAdmin?: boolean
  /** The language Cue speaks in, on every screen and in its reminders. */
  language?: 'en' | 'hi'
}

interface AuthValue {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (
    input: {
      name: string
      email: string
      password: string
    },
    /** What the account starts with: Cue Exams starts with exams, in the language picked. */
    start?: { uses?: string[]; language?: 'en' | 'hi' },
  ) => Promise<void>
  logout: () => void
  /** What they use Cue for, saved and reflected everywhere at once. */
  saveUses: (uses: string[]) => Promise<void>
  /** English or Hindi, saved and reflected at once. */
  saveLanguage: (language: 'en' | 'hi') => Promise<void>
  /** Into a fresh demo account: a sample week, or (exams) an aspirant's account. */
  enterDemo: (kind?: 'everyday' | 'exams') => Promise<void>
  /** Deletes the account and everything in it, then signs out. */
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  // Before anything below draws: every screen reads the language from i18n.
  if (me) setLanguage(me.language === 'hi' ? 'hi' : 'en')

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      setMe(await api<Me>('/auth/me'))
    } catch (err) {
      // No signal, or the server restarting: the last known profile, so the
      // app opens on what it has rather than on the sign-in page.
      const known = err instanceof ApiError && err.status === 401 ? null : lastKnownMe()
      if (!known) setToken(null)
      setMe(known)
    } finally {
      setLoading(false)
    }
  }, [])

  // Kept for the next start without signal.
  useEffect(() => {
    try {
      if (me) localStorage.setItem(ME_KEY, JSON.stringify(me))
      else localStorage.removeItem(ME_KEY)
    } catch {
      // Private mode: the next start just needs the network.
    }
  }, [me])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token?: string; admin?: AdminSession }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      // The admin's details: the admin portal, in a session of its own.
      if (res.admin) {
        setAdminSession(res.admin)
        window.location.assign('/admin')
        return
      }
      setToken(res.token!)
      await refresh()
    },
    [refresh],
  )

  const register = useCallback(
    async (input: { name: string; email: string; password: string }, start?: { uses?: string[]; language?: 'en' | 'hi' }) => {
      const res = await api<{ token: string }>('/auth/register', {
        method: 'POST',
        body: input,
      })
      setToken(res.token)
      // Set before the first screen, so it opens as what it is for — and in
      // the language the website was read in.
      const first = { ...start, language: start?.language ?? (language() === 'hi' ? 'hi' : undefined) }
      if (first.uses || first.language) {
        await api('/me/preferences', { method: 'PATCH', body: first }).catch(() => undefined)
      }
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(() => {
    // Told while still signed in, so the request carries the token; never
    // waited on for more than a moment.
    void Promise.race([stopPushHere(), new Promise((r) => setTimeout(r, 1500))]).finally(() => {
      setToken(null)
      setMe(null)
    })
  }, [])

  const saveUses = useCallback(async (uses: string[]) => {
    const saved = await api<{ uses: string[] }>('/me/preferences', { method: 'PATCH', body: { uses } })
    setMe((m) => (m ? { ...m, uses: saved.uses } : m))
  }, [])

  // Something added may be the first in a section this person does not have
  // ("applied to Infosys" with no job hunt picked): ask, and show it. Only
  // while some section is hidden, so most saves ask nothing.
  useOnChange(() => {
    if (!me) return
    const shown = sectionsFor(me.uses, FILLABLE, me.filled ?? [])
    if (FILLABLE.every((s) => shown.includes(s))) return
    void api<{ filled: string[] }>('/me/filled')
      .then(({ filled }) => {
        setMe((m) => (m && filled.some((s) => !(m.filled ?? []).includes(s)) ? { ...m, filled } : m))
      })
      .catch(() => undefined)
  })

  const saveLanguage = useCallback(async (language: 'en' | 'hi') => {
    const saved = await api<{ language: 'en' | 'hi' }>('/me/preferences', { method: 'PATCH', body: { language } })
    setMe((m) => (m ? { ...m, language: saved.language } : m))
  }, [])

  const enterDemo = useCallback(
    async (kind: 'everyday' | 'exams' = 'everyday') => {
      // A demo opened from the Hindi website is a demo in Hindi — made in
      // Hindi from the start, so its plans' titles are too.
      const res = await api<{ token: string }>('/auth/demo', { method: 'POST', body: { kind, language: language() } })
      setToken(res.token)
      await refresh()
    },
    [refresh],
  )

  const deleteAccount = useCallback(async (password: string) => {
    await api('/auth/me', { method: 'DELETE', body: { password } })
    setToken(null)
    setMe(null)
  }, [])

  const value = useMemo(
    () => ({ me, loading, login, register, logout, saveUses, saveLanguage, enterDemo, deleteAccount }),
    [me, loading, login, register, logout, saveUses, saveLanguage, enterDemo, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
