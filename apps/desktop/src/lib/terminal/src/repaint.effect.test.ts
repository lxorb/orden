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
const added = async (tag: string, text = '') => {
  const node = document.createElement(tag)
  node.textContent = text
  document.head.append(node)
  await frames()
  node.remove()
  await frames()
}
const root = document.documentElement
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
  await added('style', ':root { --bg: #102030 }')
  expect(styles).toHaveBeenCalled()
})
test('opening and closing the overview over an open terminal reads no style, and a change of theme still does (#2279)', async () => {
  sessionOf(workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'k10' }), 'Overview'))
  await frames()
  styles.mockClear()
  root.dataset.overview = 'slide'
  root.style.setProperty('--overview-open', '0.4')
  root.style.setProperty('--glass-tint', '#203040')
  root.style.setProperty('--wallpaper-sharp', 'url("blob:x")')
  root.style.setProperty('--zoom', '1.1')
  root.style.translate = '1px 0'
  await added('style', '[data-covers-held] { clip-path: inset(50%) !important; }')
  root.style.setProperty('--overview-open', '1')
  root.classList.toggle('orden-unselectable', false)
  root.style.setProperty('--overview-open', '0')
  delete root.dataset.overview
  root.style.removeProperty('--overview-open')
  root.style.removeProperty('translate')
  await frames()
  expect(styles).not.toHaveBeenCalled()
  root.style.setProperty('--accent', '#ff8800')
  await frames()
  expect(styles).toHaveBeenCalled()
  styles.mockClear()
  root.dataset.theme = root.dataset.theme === 'light' ? 'dark' : 'light'
  await frames()
  expect(styles).toHaveBeenCalled()
  styles.mockClear()
  const sheet = document.createElement('style')
  document.head.append(sheet)
  await frames()
  expect(styles).not.toHaveBeenCalled()
  sheet.textContent = ':root { --text: #eeeeee }'
  await frames()
  expect(styles).toHaveBeenCalled()
  sheet.remove()
})
