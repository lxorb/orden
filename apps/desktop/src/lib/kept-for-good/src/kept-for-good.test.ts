import { afterEach, beforeEach, expect, test, vi } from 'vitest'

let kept: Map<string, string>
let answer: boolean
let asked: number
beforeEach(() => {
  vi.resetModules()
  kept = new Map()
  answer = false
  asked = 0
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => kept.set(key, value),
    removeItem: (key: string) => kept.delete(key),
  })
  vi.stubGlobal('navigator', {
    storage: {
      persist: () => {
        asked += 1
        return Promise.resolve(answer)
      },
      persisted: () => Promise.resolve(false),
      estimate: () => Promise.resolve({ quota: 0, usage: 0 }),
    },
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
})
test('asks the browser to keep what is here once, and not again after it said no', async () => {
  const { keptForGood } = await import('./kept-for-good.svelte')
  await keptForGood.ask()
  await keptForGood.ask()
  expect(asked).toBe(1)
  expect(keptForGood.held).toBe(false)
  vi.resetModules()
  const later = await import('./kept-for-good.svelte')
  await later.keptForGood.ask()
  expect(asked).toBe(1)
  answer = true
  await later.keptForGood.again()
  expect(asked).toBe(2)
  expect(later.keptForGood.held).toBe(true)
})
