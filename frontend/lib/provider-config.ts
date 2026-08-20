import type { ModelProvider, ProviderCatalogItem, ProviderDraft } from '@/lib/api'

export type ProviderForm = {
  provider_id: string
  display_name: string
  base_url: string
  protocol: 'openai-completions'
  model: string
  models: string[]
  timeout_seconds: number
  api_key: string
}

export type ProviderEditor =
  | { kind: 'preset'; draft: ProviderForm }
  | { kind: 'custom'; draft: ProviderForm }
  | { kind: 'edit'; providerId: string; draft: ProviderForm }

export function providerForm(provider: ModelProvider | ProviderCatalogItem): ProviderForm {
  return {
    provider_id: provider.provider_id,
    display_name: provider.display_name,
    base_url: provider.base_url,
    protocol: 'openai-completions',
    model: provider.model,
    models: 'models' in provider ? provider.models : [],
    timeout_seconds: 'timeout_seconds' in provider ? provider.timeout_seconds : 60,
    api_key: '',
  }
}

export function emptyProviderForm(): ProviderForm {
  return {
    provider_id: '',
    display_name: '',
    base_url: '',
    protocol: 'openai-completions',
    model: '',
    models: [],
    timeout_seconds: 60,
    api_key: '',
  }
}

export function discoveredModelIds(result: { models?: string[]; items?: Array<string | { id?: string }> }) {
  if (Array.isArray(result.models)) return result.models.filter(Boolean)
  return Array.isArray(result.items)
    ? result.items.map((item) => typeof item === 'string' ? item : item.id || '').filter(Boolean)
    : []
}

export function mergeDiscoveredModels(existing: string[], discovered: string[]) {
  return [...new Set([...existing, ...discovered])]
}

export function isValidProviderId(value: string) {
  return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.trim())
}

export function toProviderDraft(draft: ProviderForm): ProviderDraft {
  return {
    provider_id: draft.provider_id.trim(),
    display_name: draft.display_name.trim(),
    base_url: draft.base_url.trim(),
    protocol: 'openai-completions',
    model: draft.model.trim(),
    models: draft.models,
    timeout_seconds: draft.timeout_seconds,
    ...(draft.api_key.trim() ? { api_key: draft.api_key.trim() } : {}),
  }
}
