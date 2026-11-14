import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
  isDesktop: true,
  invoke: () => Promise.resolve(true),
}))

const { grants } = await import('./permissions.svelte')
const { bound, rest } = await import('./sleeping')
type Page = import('./pages.svelte').Page
type Held = import('./sleeping').Held

function held(count: number): Held {
  const now = Date.now()
  const pages = new Map<string, Page>()
  for (let one = 0; one < count; one++) {
    pages.set(`tab-${one}`, {
      url: `https://site-${one}.example/`,
      live: true,
      onScreen: false,
      frozen: false,
      looked: now,
      loading: false,
      playing: false,
      heard: 0,
      lent: false,
      edited: false,
      inPrivate: false,
      resting: undefined,
      lulling: Promise.resolve(),
      shooting: null,
    } as unknown as Page)
  }
  return {
    each: () => [...pages.entries()],
    peek: (tabId) => pages.get(tabId),
    park: () => Promise.resolve(),
  }
}

beforeEach(() => vi.useFakeTimers())

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('resting every hidden tab asks about each tab once, not about every tab for each', () => {
  const asked = vi.spyOn(grants, 'said')
  const pages = held(40)

  for (const [id] of pages.each()) rest(pages, id)

  expect(asked.mock.calls.length).toBe(40 * 3)
})

test('a tab that is not held is left alone and nothing is asked', () => {
  const asked = vi.spyOn(grants, 'said')

  rest(held(5), 'gone')

  expect(asked).not.toHaveBeenCalled()
})

test('bounding the live tabs still looks at every tab once', () => {
  const asked = vi.spyOn(grants, 'said')

  bound(held(12))

  expect(asked.mock.calls.length).toBe(12 * 3)
})
