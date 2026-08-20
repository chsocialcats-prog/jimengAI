'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { activationHref, isAiConfigurationReady } from '@/lib/ai-activation'
import { api } from '@/lib/api'
import { useSession } from '@/components/session-provider'

type GuardStatus = 'idle' | 'checking' | 'ready' | 'redirecting'

export function useAiActivationGuard() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { session, loading: sessionLoading } = useSession()
  const [status, setStatus] = useState<GuardStatus>('idle')
  const query = searchParams.toString()
  const returnTo = useMemo(() => {
    return `${pathname}${query ? `?${query}` : ''}`
  }, [pathname, query])

  useEffect(() => {
    if (sessionLoading) return
    if (!session.authenticated) {
      setStatus('idle')
      return
    }

    let cancelled = false
    setStatus('checking')
    void api.getSettings()
      .then((settings) => {
        if (cancelled) return
        if (isAiConfigurationReady(settings)) {
          setStatus('ready')
          return
        }
        setStatus('redirecting')
        router.replace(activationHref(returnTo))
      })
      .catch(() => {
        if (!cancelled) setStatus('ready')
      })

    return () => { cancelled = true }
  }, [returnTo, router, session.authenticated, sessionLoading])

  return {
    checking: sessionLoading || status === 'checking',
    redirecting: status === 'redirecting',
  }
}
