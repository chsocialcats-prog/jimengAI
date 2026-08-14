export const replyLengthPresets = {
  short: { label: '简短', hint: '约 300-500 字' },
  standard: { label: '标准', hint: '约 600-1000 字' },
  detailed: { label: '详细', hint: '约 1000-1800 字' },
  long: { label: '超长', hint: '约 2000-3500 字' },
} as const

export type ReplyLengthKey = keyof typeof replyLengthPresets

export const defaultReplyLength: ReplyLengthKey = 'detailed'

const storagePrefix = 'adventure_reply_length:'

export function normalizeReplyLength(value: unknown): ReplyLengthKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(replyLengthPresets, value)
    ? value as ReplyLengthKey
    : defaultReplyLength
}

export function loadReplyLength(conversationId: number): ReplyLengthKey {
  if (!conversationId || typeof window === 'undefined') return defaultReplyLength
  try {
    return normalizeReplyLength(window.localStorage.getItem(`${storagePrefix}${conversationId}`))
  } catch {
    return defaultReplyLength
  }
}

export function saveReplyLength(conversationId: number, value: unknown): ReplyLengthKey {
  const normalized = normalizeReplyLength(value)
  if (!conversationId || typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(`${storagePrefix}${conversationId}`, normalized)
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
  return normalized
}
