import { beforeEach, describe, expect, test, vi } from 'vitest'

const store = new Map<string, string>()

vi.stubGlobal('localStorage', {
  get length() {
    return store.size
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
} satisfies Storage)

const launch = async () => {
  vi.resetModules()
  return (await import('./icon-recent.svelte')).iconRecent
}

beforeEach(() => store.clear())

describe('what the picker remembers', () => {
  test('is the icons last chosen, newest first, after a launch', async () => {
    const recent = await launch()
    recent.add('rocket')
    recent.add('🚀')
    recent.add('rocket')
    expect((await launch()).list).toEqual(['rocket', '🚀'])
  })

  test('and not the tab it was left on, whose key goes at the first launch', async () => {
    store.set('orden:icon-set', 'emoji')
    await launch()
    expect(store.has('orden:icon-set')).toBe(false)
  })
})
