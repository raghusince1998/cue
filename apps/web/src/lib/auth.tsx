import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setToken } from './api.ts'

export interface Me {
  id: string
  name: string
  email: string
  orgId: string
  orgName: string
  /** What they use Cue for; empty until they say. */
  uses: string[]
  /** A one-tap demo from the website, with sample data, gone after a day. */
  isDemo?: boolean
}

interface AuthValue {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: {
    name: string
    email: string
    password: string
  }) => Promise<void>
  logout: () => void
  /** What they use Cue for, saved and reflected everywhere at once. */
  saveUses: (uses: string[]) => Promise<void>
  /** Into a fresh demo account, filled with a sample week. */
  enterDemo: () => Promise<void>
  /** Deletes the account and everything in it, then signs out. */
  deleteAccount: (password: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      setMe(await api<Me>('/auth/me'))
    } catch {
      setToken(null)
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      setToken(res.token)
      await refresh()
    },
    [refresh],
  )

  const register = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const res = await api<{ token: string }>('/auth/register', {
        method: 'POST',
        body: input,
      })
      setToken(res.token)
      await refresh()
    },
    [refresh],
  )

  const logout = useCallback(() => {
    setToken(null)
    setMe(null)
  }, [])

  const saveUses = useCallback(async (uses: string[]) => {
    const saved = await api<{ uses: string[] }>('/me/preferences', { method: 'PATCH', body: { uses } })
    setMe((m) => (m ? { ...m, uses: saved.uses } : m))
  }, [])

  const enterDemo = useCallback(async () => {
    const res = await api<{ token: string }>('/auth/demo', { method: 'POST', body: {} })
    setToken(res.token)
    await refresh()
  }, [refresh])

  const deleteAccount = useCallback(async (password: string) => {
    await api('/auth/me', { method: 'DELETE', body: { password } })
    setToken(null)
    setMe(null)
  }, [])

  const value = useMemo(
    () => ({ me, loading, login, register, logout, saveUses, enterDemo, deleteAccount }),
    [me, loading, login, register, logout, saveUses, enterDemo, deleteAccount],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
