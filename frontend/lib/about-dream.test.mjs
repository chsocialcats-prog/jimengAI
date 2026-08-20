import assert from 'node:assert/strict'
import test from 'node:test'

test('creator profile link opens the official Bilibili page in a safe new tab', async () => {
  const aboutDream = await import('./about-dream.ts')

  assert.deepEqual(aboutDream.creatorProfileLink, {
    href: 'https://space.bilibili.com/94794032',
    target: '_blank',
    rel: 'noreferrer',
  })
})
