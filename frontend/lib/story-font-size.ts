export const defaultStoryFontSize = 17
export const minStoryFontSize = 14
export const maxStoryFontSize = 24
export const storyFontSizeStep = 0.5

const storageKey = 'adventure_story_font_size'

export function normalizeStoryFontSize(value: unknown): number {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN

  if (!Number.isFinite(numericValue)) return defaultStoryFontSize

  const clampedValue = Math.min(maxStoryFontSize, Math.max(minStoryFontSize, numericValue))
  const steps = Math.round((clampedValue - minStoryFontSize) / storyFontSizeStep)
  return Number((minStoryFontSize + steps * storyFontSizeStep).toFixed(1))
}

export function loadStoryFontSize(): number {
  if (typeof window === 'undefined') return defaultStoryFontSize
  try {
    return normalizeStoryFontSize(window.localStorage.getItem(storageKey))
  } catch {
    return defaultStoryFontSize
  }
}

export function saveStoryFontSize(value: unknown): number {
  const normalized = normalizeStoryFontSize(value)
  if (typeof window === 'undefined') return normalized
  try {
    window.localStorage.setItem(storageKey, String(normalized))
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
  return normalized
}
