import { expect, test, vi } from 'vitest'
import { computed, root } from './runes.svelte'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  invoke: () => Promise.resolve(undefined),
}))

const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')

test('a pane can read its page out of a derived the first time it asks', () => {
  let read: (() => unknown) | undefined
  const stop = root(() => {
    read = computed(() => pages.of('a-tab-nothing-has-asked-about'))
  })

  try {
    expect(() => read?.()).not.toThrow()
    expect(read?.()).toBe(read?.())
  } finally {
    stop()
    pages.forget('a-tab-nothing-has-asked-about')
  }
})

test('a page read through a derived is still the one the store hands out', () => {
  let read: (() => unknown) | undefined
  const stop = root(() => {
    read = computed(() => pages.of('another-tab'))
  })

  try {
    expect(read?.()).toBe(pages.of('another-tab'))
  } finally {
    stop()
    pages.forget('another-tab')
  }
})
