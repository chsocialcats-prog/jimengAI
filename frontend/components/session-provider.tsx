'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, type AuthSession, type ApiUser } from '@/lib/api'

type SessionContextValue = {
  session: AuthSession
  loading: boolean
  refresh: () => Promise<AuthSession>
  setSession: (session: AuthSession) => void
  user: ApiUser | null
}

const anonymousSession: AuthSession = { authenticated: false, user: null }
const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession>(anonymousSession)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const next = await api.getSession()
      setSession(next)
      return next
    } catch {
      setSession(anonymousSession)
      return anonymousSession
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const value = useMemo<SessionContextValue>(() => ({
    session,
    loading,
    refresh,
    setSession,
    user: session.user,
  }), [session, loading, refresh])

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession 必须在 SessionProvider 内使用')
  return context
}
