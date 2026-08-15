export const reasoningEffortPresets = {
  off: { label: '关闭' },
  high: { label: '高' },
  max: { label: 'Max' },
} as const

export type ReasoningEffortKey = keyof typeof reasoningEffortPresets

export const defaultReasoningEffort: ReasoningEffortKey = 'high'

const storagePrefix = 'adventure_reasoning_effort:'

export function normalizeReasoningEffort(value: unknown, fallback: ReasoningEffortKey = defaultReasoningEffort): ReasoningEffortKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(reasoningEffortPresets, value)
    ? value as ReasoningEffortKey
    : fallback
}

export function loadReasoningEffort(conversationId: number, fallback: unknown = defaultReasoningEffort): ReasoningEffortKey {
  const normalizedFallback = normalizeReasoningEffort(fallback)
  if (!conversationId || typeof window === 'undefined') return normalizedFallback
  try {
    return normalizeReasoningEffort(window.localStorage.getItem(`${storagePrefix}${conversationId}`), normalizedFallback)
  } catch {
    return normalizedFallback
  }
}

export function saveReasoningEffort(conversationId: number, value: unknown): ReasoningEffortKey {
  const normalized = normalizeReasoningEffort(value)
  if (!conversationId || typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(`${storagePrefix}${conversationId}`, normalized)
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
  return normalized
}
