export const REPLY_LENGTH_PRESETS = {
  short: { label: "简短", maxTokens: 1024, hint: "约 300-500 字" },
  standard: { label: "标准", maxTokens: 2048, hint: "约 600-1000 字" },
  detailed: { label: "详细", maxTokens: 4096, hint: "约 1000-1800 字" },
  long: { label: "很长", maxTokens: 8192, hint: "约 2000-3500 字" },
};

export const DEFAULT_REPLY_LENGTH = "detailed";
const REPLY_LENGTH_STORAGE_PREFIX = "adventure_reply_length:";

export function normalizeReplyLength(value) {
  return Object.prototype.hasOwnProperty.call(REPLY_LENGTH_PRESETS, value)
    ? value
    : DEFAULT_REPLY_LENGTH;
}

export function replyLengthStorageKey(conversationId) {
  return `${REPLY_LENGTH_STORAGE_PREFIX}${conversationId}`;
}

export function loadReplyLength(conversationId, storage = localStorage) {
  if (!conversationId || !storage) return DEFAULT_REPLY_LENGTH;
  try {
    return normalizeReplyLength(storage.getItem(replyLengthStorageKey(conversationId)));
  } catch {
    return DEFAULT_REPLY_LENGTH;
  }
}

export function saveReplyLength(conversationId, value, storage = localStorage) {
  const normalized = normalizeReplyLength(value);
  if (!conversationId || !storage) return normalized;
  try {
    storage.setItem(replyLengthStorageKey(conversationId), normalized);
  } catch {}
  return normalized;
}
