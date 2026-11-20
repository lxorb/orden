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
const { workspace } = await import('../../workspace/src/api')
const styles = vi.spyOn(window, 'getComputedStyle')
const { sessionOf } = await import('./sessions.svelte')
const frames = async () => {
  await new Promise((done) => requestAnimationFrame(() => done(null)))
  await new Promise((done) => requestAnimationFrame(() => done(null)))
}
const added = async (tag: string) => {
  const node = document.createElement(tag)
  document.head.append(node)
  await frames()
  node.remove()
}
test('the terminal colours are read again only for a change of theme, and only while a terminal is open (#2279)', async () => {
  await frames()
  styles.mockClear()
  await added('link')
  await added('style')
  expect(styles).not.toHaveBeenCalled()
  sessionOf(workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k9' }), 'Build'))
  await frames()
  styles.mockClear()
  await added('link')
  expect(styles).not.toHaveBeenCalled()
  await added('style')
  expect(styles).toHaveBeenCalled()
})
