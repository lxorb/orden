import { afterEach, describe, expect, test, vi } from 'vitest'
import { aloneHere, forgetWindow, holdThisWindow, keptBudget } from './budget'

afterEach(() => {
  vi.unstubAllGlobals()
  forgetWindow()
})

function locks(others: number) {
  const held: { name: string; mode: string }[] = Array.from({ length: others }, () => ({
    name: 'nib:window',
    mode: 'shared',
  }))
  return {
    request: (name: string, options: { mode: string }, then: () => Promise<void>) => {
      held.push({ name, mode: options.mode })
      return then()
    },
    query: () => Promise.resolve({ held, pending: [] }),
  }
}

describe('letting words go', () => {
  test('only while this is the only window, and never where the browser cannot say', async () => {
    vi.stubGlobal('navigator', { locks: locks(0) })
    expect(await aloneHere()).toBe(true)

    forgetWindow()
    vi.stubGlobal('navigator', { locks: locks(1) })
    expect(await aloneHere()).toBe(false)

    forgetWindow()
    vi.stubGlobal('navigator', {})
    expect(await aloneHere()).toBe(false)
  })

  test('a window without the engine is counted the moment it opens', async () => {
    const shared = locks(0)
    vi.stubGlobal('navigator', { locks: shared })
    holdThisWindow()
    forgetWindow()
    expect(await aloneHere()).toBe(false)
  })

  test('within a share of what the site may keep, halved while the storage is nearly full', async () => {
    const estimate = (usage: number, quota: number) =>
      vi.stubGlobal('navigator', { storage: { estimate: () => Promise.resolve({ usage, quota }) } })
    estimate(0, 600_000_000)
    expect(await keptBudget()).toBe(20_000_000)
    estimate(590_000_000, 600_000_000)
    expect(await keptBudget()).toBe(10_000_000)
    estimate(0, 6_000_000_000)
    expect(await keptBudget()).toBe(48_000_000)
    vi.stubGlobal('navigator', {})
    expect(await keptBudget()).toBe(4_000_000)
  })
})
