import { expect, test, vi } from 'vitest'

const imported = vi.hoisted(() => ({ overview: false }))
vi.mock('./Overview.svelte', () => {
  imported.overview = true
  return { default: {} }
})
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
