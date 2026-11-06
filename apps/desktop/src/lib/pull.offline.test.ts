import { expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})

vi.mock('./refresh', () => {
  throw new TypeError('Failed to fetch dynamically imported module: /assets/refresh.js')
})
vi.mock('./viewport.svelte', () => ({ viewport: { typing: false } }))

const { pull } = await import('./pull.svelte')

test('a pull whose reload could not even be fetched, offline, says so and can be pulled again', async () => {
  await expect(pull.press()).resolves.toBeUndefined()
  expect(pull.refreshing).toBe(false)
  expect(pull.failed).toBe(true)

  await expect(pull.press()).resolves.toBeUndefined()
  expect(pull.refreshing).toBe(false)
})
