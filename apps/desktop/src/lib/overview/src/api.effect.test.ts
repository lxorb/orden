import { expect, test, vi } from 'vitest'

const imported = vi.hoisted(() => ({ overview: false, read: 0 }))
vi.mock('./Overview.svelte', () => {
  imported.overview = true
  return { default: {} }
})
vi.mock('./faces.svelte', () => ({
  faces: {
    read: () => {
      imported.read++
      return Promise.resolve()
    },
  },
}))
test('once the app is idle after launch the overview is loaded, so its first opening imports nothing', async () => {
  const asked: (() => void)[] = []
  vi.stubGlobal('requestIdleCallback', (work: () => void) => asked.push(work))
  const { wakeFaces } = await import('./api')
  await wakeFaces()
  expect(imported.overview).toBe(false)
  expect(asked).toHaveLength(1)
  asked[0]?.()
  await vi.waitFor(() => expect(imported.overview).toBe(true))
  vi.unstubAllGlobals()
})
test('a lone Alt let go, the start of opening it, reads the overview’s pictures at once', async () => {
  vi.stubGlobal('requestIdleCallback', () => undefined)
  vi.resetModules()
  imported.read = 0
  const { wakeFaces } = await import('./api')
  await wakeFaces()
  dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }))
  expect(imported.read).toBe(0)
  dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))
  await vi.waitFor(() => expect(imported.read).toBeGreaterThan(0))
  vi.unstubAllGlobals()
})
