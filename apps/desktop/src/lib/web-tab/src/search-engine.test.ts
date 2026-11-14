import { SEARCH } from '@orden/scan/typed'
import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('the choice', () => {
  beforeEach(() => {
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    vi.resetModules()
  })

  test('is Google until somebody chooses', async () => {
    const { searchEngine } = await import('./search-engine.svelte')
    expect(searchEngine.url).toBe(SEARCH)
  })

  test("carries the engine's own page, which is where a new web note lands", async () => {
    const { searchEngine } = await import('./search-engine.svelte')
    expect(searchEngine.home).toBe('https://www.google.com/')
    searchEngine.choose('qwant')
    expect(searchEngine.home).toBe('https://www.qwant.com/')
  })

  test('is kept, and read back', async () => {
    const first = await import('./search-engine.svelte')
    first.searchEngine.choose('duckduckgo')
    vi.resetModules()
    const again = await import('./search-engine.svelte')
    expect(again.searchEngine.url).toBe('https://duckduckgo.com/?q=%s')
  })

  test('a custom address is chosen as it is written, and a bad one changes nothing', async () => {
    const { searchEngine, CUSTOM } = await import('./search-engine.svelte')
    expect(searchEngine.setCustom('not an engine')).toBe(false)
    expect(searchEngine.id).toBe('google')
    searchEngine.choose(CUSTOM)
    expect(searchEngine.id).toBe('google')

    expect(searchEngine.setCustom(' https://kagi.com/search?q=%s ')).toBe(true)
    expect(searchEngine.id).toBe(CUSTOM)
    expect(searchEngine.url).toBe('https://kagi.com/search?q=%s')

    searchEngine.choose('bing')
    searchEngine.choose(CUSTOM)
    expect(searchEngine.url).toBe('https://kagi.com/search?q=%s')
  })
})
