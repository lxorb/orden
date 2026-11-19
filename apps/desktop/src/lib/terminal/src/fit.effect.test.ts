import { expect, test, vi } from 'vitest'

type Seen = { contentRect: { width: number; height: number } }[]
const watchers: ((seen: Seen) => void)[] = []
const none = () => undefined
window.matchMedia = () =>
  ({
    matches: false,
    addListener: none,
    removeListener: none,
    addEventListener: none,
    removeEventListener: none,
  }) as unknown as MediaQueryList
globalThis.ResizeObserver = class {
  observe = none
  unobserve = none
  disconnect = none
  constructor(heard: (seen: Seen) => void) {
    watchers.push(heard)
  }
} as unknown as typeof ResizeObserver
Object.defineProperty(document, 'fonts', { value: { load: () => Promise.resolve([]) } })
vi.mock('../../platform/src/tauri', async (original) => ({
  ...(await original<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
}))
const { FitAddon } = await import('@xterm/addon-fit')
const fits = vi.spyOn(FitAddon.prototype, 'fit').mockImplementation(() => undefined)
const { workspace } = await import('../../workspace/src/api')
const { sessionOf } = await import('./sessions.svelte')
const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)))
test('a terminal brought back fits in a later frame, and only when its size changed (#2290)', async () => {
  const tab = workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k1' }), 'Build')
  const before = watchers.length
  const session = sessionOf(tab)
  const sized = watchers.slice(before).at(-1)
  if (!sized) throw new Error('the terminal watches no size')
  const place = document.createElement('div')
  document.body.append(place)
  await session.attach(place, false)
  sized([{ contentRect: { width: 800, height: 600 } }])
  await frame()
  const xterm = (session as unknown as { term: object }).term
  fits.mockClear()
  session.detach()
  await session.attach(place, true)
  expect(fits).not.toHaveBeenCalled()
  sized([{ contentRect: { width: 0, height: 0 } }])
  sized([{ contentRect: { width: 800, height: 600 } }])
  session.show(false, false)
  session.show(true, true)
  await frame()
  expect(fits).not.toHaveBeenCalled()
  expect((session as unknown as { term: object }).term).toBe(xterm)
  sized([{ contentRect: { width: 900, height: 600 } }])
  await frame()
  expect(fits).toHaveBeenCalledTimes(1)
})
