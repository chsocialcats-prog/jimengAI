import { api } from '@/lib/api'

export type ApiStatus = 'not_checked' | 'checking' | 'online' | 'unconfigured' | 'offline' | 'unauthenticated'

export type ApiStatusSnapshot = {
  status: ApiStatus
  providerName: string
}

export type ApiStatusUpdatedDetail = ApiStatusSnapshot & {
  userId: number
}

export const API_STATUS_UPDATED_EVENT = 'neko-api-status-updated'

const STORAGE_PREFIX = 'neko.api-status.v1.'

function storageKey(userId: number) {
  return `${STORAGE_PREFIX}${userId}`
}

function providerNameFor(providerId?: string) {
  return providerId === 'deepseek' ? 'DeepSeek' : providerId || 'API'
}

function isCachedSnapshot(value: unknown): value is ApiStatusSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<ApiStatusSnapshot>
  return (
    typeof snapshot.providerName === 'string'
    && ['online', 'unconfigured', 'offline'].includes(snapshot.status || '')
  )
}

function notify(userId: number, snapshot: ApiStatusSnapshot) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<ApiStatusUpdatedDetail>(API_STATUS_UPDATED_EVENT, {
    detail: { userId, ...snapshot },
  }))
}

export function getCachedApiStatus(userId: number): ApiStatusSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(userId)) || 'null')
    return isCachedSnapshot(value) ? value : null
  } catch {
    return null
  }
}

function saveApiStatus(userId: number, snapshot: ApiStatusSnapshot) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(snapshot))
  } catch {
    // A private browsing mode can deny storage without affecting status checks.
  }
}

export async function refreshApiStatus(userId: number): Promise<ApiStatusSnapshot> {
  const cached = getCachedApiStatus(userId)
  notify(userId, { status: 'checking', providerName: cached?.providerName || 'API' })

  let next: ApiStatusSnapshot
  try {
    const settings = await api.getSettings()
    const activeProvider = settings.providers?.find((provider) => provider.is_active)
    const providerName = activeProvider?.display_name || providerNameFor(settings.active_provider_id)
    const apiKeySet = activeProvider?.api_key_set ?? settings.api_key_set
    const apiKeyUnreadable = activeProvider?.api_key_unreadable ?? settings.api_key_unreadable
    if (!apiKeySet) {
      next = { status: 'unconfigured', providerName }
    } else if (apiKeyUnreadable) {
      next = { status: 'offline', providerName }
    } else {
      await api.previewModels(activeProvider ? { provider_id: activeProvider.provider_id } : {})
      next = { status: 'online', providerName }
    }
  } catch {
    next = { status: 'offline', providerName: cached?.providerName || 'API' }
  }

  saveApiStatus(userId, next)
  notify(userId, next)
  return next
}
