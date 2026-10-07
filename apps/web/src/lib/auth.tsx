import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, getToken, setToken } from './api.ts'

export interface Me {
  id: string
  name: string
  email: string
  orgId: string
  orgName: string
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

  const value = useMemo(
    () => ({ me, loading, login, register, logout }),
    [me, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
