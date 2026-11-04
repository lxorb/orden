import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Every tab as a window on a canvas (issue #331), opened by Alt Alt, the top bar's button
 *  or the palette's row: one window per tab of every pane, the arrows walk them, Enter
 *  or a press opens one, Escape and the key again send them home. In the jsdom project
 *  because the windows are mounted; asked for less movement, so every window is where it
 *  goes at once and nothing waits on a frame. How it moves is overview/spring.ts's test. */

window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined

const { default: Overview } = await import('../../src/lib/overview/Overview.svelte')
const { tabOverview } = await import('../../src/lib/surfaces.svelte')
const { appCommands } = await import('../../src/lib/commands')
const { overlays } = await import('../../src/lib/overlays')
const { runTap } = await import('../../src/lib/tapped')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')

let close: () => void

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  for (const name of ['One', 'Two', 'Three']) workspace.openBlank(name, `# ${name}`)
  // A second pane, whose tab is a window too.
  workspace.split('row')
  const made = mount(Overview, { target: document.body })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  tabOverview.open = false
  flushSync()
  close()
  vi.restoreAllMocks()
})

const windows = () => [...document.querySelectorAll<HTMLButtonElement>('.window')]
const layer = () => document.querySelector('.canvas')

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  document.activeElement?.dispatchEvent(event)
  flushSync()
  return event
}

async function opened() {
  appCommands()
    .find((one) => one.id === 'tab-overview')
    ?.run()
  flushSync()
  await tick()
}

test('the palette’s row shows one window per tab, the strip leaves them out, the keyboard on the one in front', async () => {
  await opened()
  expect(windows().map((one) => one.getAttribute('aria-label'))).toEqual([
    'One',
    'Two',
    'Three',
    'Three',
  ])
  expect(tabOverview.out).toHaveLength(4)
  expect(document.activeElement).toBe(document.querySelector('.window[aria-current="page"]'))
})

test('a press on a window opens its tab, and every window goes home', async () => {
  await opened()
  windows()[0]?.click()
  flushSync()
  await tick()
  expect(workspace.activeTabId).toBe(workspace.tabs[0]?.id)
  expect(tabOverview.open).toBe(false)
  expect(layer()).toBe(null)
  expect(tabOverview.out).toEqual([])
  expect(overlays.depth).toBe(0)
})

test('the arrows walk to another window, which opens as a press on it does', async () => {
  await opened()
  windows()[0]?.focus()
  press('ArrowRight')
  const walked = document.activeElement as HTMLButtonElement | null
  expect(walked).not.toBe(windows()[0])
  expect(windows()).toContain(walked)
  // Enter on a button is its click, in a browser; jsdom has no default actions.
  const id = workspace.tabs.find((one) => one.shown === walked?.getAttribute('aria-label'))?.id
  walked?.click()
  flushSync()
  expect(workspace.active?.shown).toBe(walked?.getAttribute('aria-label'))
  expect(id).toBeTruthy()
})

test('Escape sends them home and goes nowhere', async () => {
  await opened()
  const before = workspace.activeTabId
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  expect(tabOverview.open).toBe(false)
  expect(layer()).toBe(null)
  expect(workspace.activeTabId).toBe(before)
})

test('Alt tapped twice opens it, and again puts it away', async () => {
  const context = { palette: () => undefined, fullscreen: () => undefined }
  expect(runTap('Alt', context)).toBe(true)
  flushSync()
  await tick()
  expect(windows()).toHaveLength(4)

  expect(runTap('Alt', context)).toBe(true)
  flushSync()
  await tick()
  expect(layer()).toBe(null)
})

test('a web tab’s window shows its page as it was left, a tab nowhere in the file list is dashed', async () => {
  const page = workspace.openPage('https://example.com/') ?? ''
  pages.of(page).shot = 'data:image/png;base64,AA=='
  await opened()
  const web = windows().find((one) => one.querySelector('img'))
  expect(web?.querySelector('img')?.getAttribute('src')).toBe(pages.of(page).shot)
  // Every tab here is a draft or a page nobody kept.
  expect(windows().every((one) => one.classList.contains('unsaved'))).toBe(true)
})

test('nothing in it is chosen as text, and a drag is never the browser’s own', async () => {
  await opened()
  for (const at of [layer(), windows()[0], document.querySelector('.caption')]) {
    for (const kind of ['selectstart', 'dragstart']) {
      const event = new Event(kind, { bubbles: true, cancelable: true })
      at?.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
    }
  }
})

test('it comes back where the camera was left', async () => {
  await opened()
  const world = () => document.querySelector<HTMLElement>('.world')?.style.transform
  const canvas = layer()
  canvas?.dispatchEvent(
    new WheelEvent('wheel', { deltaX: 120, deltaY: 40, bubbles: true, cancelable: true }),
  )
  flushSync()
  const moved = world()
  expect(overlays.escape()).toBe(true)
  flushSync()
  await tick()
  await opened()
  expect(world()).toBe(moved)
})

test('Tidy up puts every window back where its panes put it', async () => {
  const { places } = await import('../../src/lib/overview/places.svelte')
  const id = workspace.tabs[0]?.id ?? ''
  places.keepWindows({ [id]: { x: 4000, y: 4000, w: 300, h: 200 } }, workspace.tabs)
  await opened()
  expect(places.windows[id]).toEqual({ x: 4000, y: 4000, w: 300, h: 200 })
  document.querySelector<HTMLButtonElement>('.tidy')?.click()
  flushSync()
  await tick()
  expect(places.windows).toEqual({})
})

test('a window put by hand is found again by the next run, whose tabs have new ids', async () => {
  const { places } = await import('../../src/lib/overview/places.svelte')
  const [first] = workspace.tabs
  places.keepWindows({ [first?.id ?? '']: { x: 3000, y: 10, w: 300, h: 200 } }, workspace.tabs)
  // The next run: the same tabs, every id new.
  const again = workspace.tabs.map((one) => ({
    id: `${one.id}-again`,
    kind: one.kind,
    path: one.path,
    shown: one.shown,
  }))
  places.recall(again)
  expect(places.windows[`${first?.id}-again`]).toEqual({ x: 3000, y: 10, w: 300, h: 200 })
})

test('a window’s cross closes its tab the strip’s way, which asks where that asks, and the view stays', async () => {
  await opened()
  const closing = vi.spyOn(workspace, 'closeAsking')
  const [first] = windows()
  const id = workspace.tabs.find((one) => one.shown === first?.getAttribute('aria-label'))?.id
  const cross = first?.nextElementSibling as HTMLButtonElement | null
  expect(cross?.classList.contains('closer')).toBe(true)
  expect(cross?.getAttribute('aria-label')).toBe('Close')
  cross?.click()
  flushSync()
  await tick()
  expect(closing).toHaveBeenCalledWith(id)
  // The press was the cross's: the window was not opened and the view is still up.
  expect(tabOverview.open).toBe(true)
  expect(layer()).not.toBe(null)
})
