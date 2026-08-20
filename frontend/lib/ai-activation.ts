import type { Settings } from '@/lib/api'

export function isAiConfigurationReady(settings: Settings) {
  const activeProvider = settings.providers?.find((provider) => provider.is_active)
  const apiKeySet = activeProvider?.api_key_set ?? settings.api_key_set
  const apiKeyUnreadable = activeProvider?.api_key_unreadable ?? settings.api_key_unreadable
  return Boolean(apiKeySet && !apiKeyUnreadable)
}

export function activationHref(returnTo?: string) {
  return returnTo ? `/activate-api?return_to=${encodeURIComponent(returnTo)}` : '/activate-api'
}

export function safeActivationReturnTarget(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  const path = value.split('?')[0]
  return path === '/editor' || path === '/adventure' || path === '/work' ? value : null
}
