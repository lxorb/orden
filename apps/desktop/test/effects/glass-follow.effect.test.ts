import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import '../../src/lib/theme-ports'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: (command: string) =>
    Promise.resolve(
      command === 'list_themes' ? [] : command === 'read_custom_css' ? '' : undefined,
    ),
}))

vi.mock('@orden/themes/glass', () => ({
  glassCss: readFileSync(resolve('../../packages/themes/src/glass.css'), 'utf8'),
}))

class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }) as unknown as MediaQueryList

const { workspace } = await import('../../src/lib/workspace.svelte')
const { theme } = await import('../../src/lib/theme/src/theme.svelte')
const { viewport } = await import('../../src/lib/ui-kit/src/viewport.svelte')
const { chrome } = await import('../../src/lib/theme/src/chrome.svelte')
const { grounds } = await import('../../src/lib/theme-looks/src/glass/grounds.svelte')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default

const BLACK = 'https://black.example/'
const WHITE = 'https://white.example/'

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

let tints: string[] = []
let watching: MutationObserver | null = null

async function settle() {
  await vi.dynamicImportSettled()
  for (let turn = 0; turn < 4; turn++) {
    await new Promise((go) => setTimeout(go, 0))
    flushSync()
  }
}

function tint(): string {
  return document.documentElement.style.getPropertyValue('--glass-tint')
}

function pair(): [string, string] | null {
  const root = document.documentElement
  if (!root.hasAttribute('data-paired')) return null
  return [tint(), root.style.getPropertyValue('--glass-tint-2')]
}

beforeEach(async () => {
  localStorage.clear()
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'

  theme.init()
  theme.setScheme('light')
  theme.select('glass')
  await settle()

  target = document.createElement('div')
  document.body.append(target)

  tints = []
  watching = new MutationObserver(() => {
    const now = tint()
    if (tints.at(-1) !== now) tints.push(now)
  })
  watching.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
})

afterEach(() => {
  watching?.disconnect()
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  theme.select('default')
})

test('a switch moves the frame from one tab’s colour to the next in one step', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  const white = workspace.openPage(WHITE) ?? ''
  grounds.said(white, WHITE, '#ffffff')
  workspace.openBlank('Notes', '# Notes')
  const note = workspace.active?.id ?? ''
  shown = mount(Tabs, { target, props: { paneId: workspace.panes.focusedId } })

  workspace.activate(black)
  await settle()
  expect(tint()).toBe('#0f0f0f')
  expect(chrome.theme).toBe('dark')
  const active = () => target.querySelector<HTMLElement>('.tab.active')
  expect(active()?.style.getPropertyValue('--web-ground')).toBe('#0f0f0f')
  expect(active()?.hasAttribute('data-theme')).toBe(false)

  tints = []
  workspace.activate(white)
  await settle()
  expect(tints).toEqual(['#ffffff'])
  expect(chrome.theme).toBeUndefined()

  tints = []
  workspace.activate(note)
  await settle()
  expect(tints).toHaveLength(1)
  expect(tints[0]).toMatch(/^#[0-9a-f]{6}$/)
  expect(chrome.theme).toBeUndefined()
  expect(active()?.style.getPropertyValue('--web-ground')).toBe('')
})

test('a note and an empty pane wear glass’s own pair, a page its own colour', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.openBlank('Notes', '# Notes')
  const note = workspace.active?.id ?? ''
  await settle()
  expect(pair()).toEqual(['#d2e7fc', '#eed7f2'])
  expect(chrome.theme).toBeUndefined()

  workspace.activate(black)
  await settle()
  expect(pair()).toBeNull()
  expect(tint()).toBe('#0f0f0f')

  workspace.activate(workspace.openPage('') ?? note)
  await settle()
  expect(pair()).toEqual(['#d2e7fc', '#eed7f2'])
})

test('the pair is the reader’s to choose, and with the frame not following it is everywhere', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()
  expect(pair()).toBeNull()

  theme.set('follow', false)
  await settle()
  expect(pair()).toEqual(['#d2e7fc', '#eed7f2'])

  theme.set('pair', 'lagoon')
  await settle()
  expect(pair()).toEqual(['#d1f0e7', '#d1dff9'])

  theme.set('pair', '#dfe5ec #e9e4ec')
  await settle()
  expect(pair()).toEqual(['#dfe5ec', '#e9e4ec'])

  theme.setScheme('dark')
  await settle()
  expect(pair()?.every((one) => /^#[0-3][0-9a-f]/.test(one))).toBe(true)
  theme.setScheme('light')
  theme.set('follow', true)
  theme.set('pair', 'dawn')
  await settle()
})

test('a tab on its way to an address never read keeps its colour, then changes once', async () => {
  const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
  const tab = workspace.openPage(BLACK) ?? ''
  grounds.said(tab, BLACK, '#0f0f0f')
  workspace.activate(tab)
  await settle()
  expect(tint()).toBe('#0f0f0f')

  const page = pages.of(tab)
  tints = []
  page.url = 'https://never-seen.example/'
  page.loading = true
  await settle()
  expect(tints).toEqual([])

  page.loading = false
  grounds.said(tab, 'https://never-seen.example/', '#ffffff')
  await settle()
  expect(tints).toEqual(['#ffffff'])
})

test('a note’s tab inside a strip turned dark by a page keeps the paper’s words', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()

  expect(chrome.theme).toBe('dark')
  expect(chrome.tabTheme('some-note')).toBe('light')
  expect(chrome.tabTheme(black)).toBeUndefined()
})

test('the wash is worked out again over whatever the root says the window stands on', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#ffffff')
  workspace.activate(black)
  await settle()
  const opaque = document.documentElement.style.getPropertyValue('--glass-tinted')

  document.documentElement.dataset.translucent = 'acrylic'
  await settle()
  expect(chrome.material).toBe('acrylic')
  expect(document.documentElement.style.getPropertyValue('--glass-tinted')).not.toBe(opaque)
  delete document.documentElement.dataset.translucent
  await settle()
})

test('leaving glass takes every colour and word it put on the window away', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()
  expect(document.documentElement.hasAttribute('data-tinted')).toBe(true)

  theme.select('default')
  await settle()
  expect(document.documentElement.hasAttribute('data-tinted')).toBe(false)
  expect(tint()).toBe('')
  expect(chrome.theme).toBeUndefined()
  expect(localStorage.getItem('orden:glass-chrome')).toBeNull()
})

test('the next launch opens on the colour it was left on, before anything is worked out', async () => {
  const black = workspace.openPage(BLACK) ?? ''
  grounds.said(black, BLACK, '#0f0f0f')
  workspace.activate(black)
  await settle()
  const kept = localStorage.getItem('orden:glass-chrome')
  expect(kept).toContain('#0f0f0f')

  chrome.sleep()
  vi.resetModules()
  localStorage.setItem('orden:glass-chrome', kept ?? '')
  const fresh = (await import('../../src/lib/theme/src/chrome.svelte')).chrome
  fresh.wake('light')
  expect(tint()).toBe('#0f0f0f')
  expect(fresh.theme).toBe('dark')
  expect(fresh.barOf(black)?.colour).toBe('#0f0f0f')
  fresh.sleep()
})

test('the next launch opens on the pair it was left on', async () => {
  workspace.openBlank('Notes', '# Notes')
  await settle()
  const kept = localStorage.getItem('orden:glass-chrome')
  expect(kept).toContain('#eed7f2')

  chrome.sleep()
  expect(pair()).toBeNull()
  vi.resetModules()
  localStorage.setItem('orden:glass-chrome', kept ?? '')
  const fresh = (await import('../../src/lib/theme/src/chrome.svelte')).chrome
  fresh.wake('light')
  expect(pair()).toEqual(['#d2e7fc', '#eed7f2'])
  fresh.sleep()
})

test('the shell, the bar and the open tab ease the colour rather than jump to it', () => {
  const source = (path: string) => readFileSync(resolve(path), 'utf8')
  expect(source('src/App.svelte')).toMatch(
    /background: var\(--shell-ground\);\s*transition: background var\(--dur-/,
  )
  expect(source('src/lib/web-tab/src/WebBar.svelte')).toMatch(/background-color var\(--dur-/)
  expect(source('src/lib/Tabs.svelte')).toMatch(/transition:\s+--tab-ground var\(--dur-/)
  expect(source('../../packages/themes/src/glass.css')).toMatch(/@property --tab-ground/)
})
