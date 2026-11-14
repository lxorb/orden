import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
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

const { workspace } = await import('../../src/lib/workspace.svelte')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { viewport } = await import('../../src/lib/ui-kit/src/viewport.svelte')
const { cycleTab } = await import('../../src/lib/tab-cycle.svelte')
const { run } = await import('../../src/lib/canvas/src/actions')
const { CanvasStore } = await import('../../src/lib/canvas/src/store.svelte')
const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
const { panesOf } = await import('../../src/lib/workspace/session')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default
const Pane = (await import('../../src/lib/Pane.svelte')).default
await import('../../src/lib/NewHere.svelte')

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
let was: typeof viewport.device

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  viewport.device = was
})

function ctrlD(): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'd',
    code: 'KeyD',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })

  return shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })
}

function three() {
  for (const name of ['One', 'Two', 'Three']) workspace.openBlank(name, `# ${name}`)
  const paneId = workspace.panes.focusedId
  const strip = workspace.tabsIn(paneId)
  expect(strip).toHaveLength(3)
  workspace.activate(strip[1]?.id ?? '')

  return { paneId, strip }
}

test('puts the tab in front down and closes nothing', () => {
  const { paneId, strip } = three()

  expect(ctrlD()).toBe(true)

  expect(workspace.activeTabId).toBeNull()
  expect(workspace.showing(paneId)).toBeNull()
  expect(workspace.tabsIn(paneId).map((one) => one.id)).toEqual(strip.map((one) => one.id))
})

test('leaves the strip with no tab drawn in front, and a press brings one back', () => {
  const { paneId, strip } = three()
  shown = mount(Tabs, { target, props: { paneId } })
  flushSync()
  expect(target.querySelectorAll('.tab.active')).toHaveLength(1)

  ctrlD()
  flushSync()

  expect(target.querySelectorAll('.tab')).toHaveLength(3)
  expect(target.querySelectorAll('.tab.active')).toHaveLength(0)

  const third = strip[2]?.id ?? ''
  target.querySelector<HTMLButtonElement>(`[data-tab="${third}"]`)?.click()
  flushSync()

  expect(workspace.activeTabId).toBe(third)
  expect(target.querySelector('.tab.active')?.getAttribute('data-box')).toBe(third)
})

test('shows what a pane with nothing open shows', async () => {
  const { paneId } = three()
  ctrlD()

  shown = mount(Pane, { target, props: { pane: workspace.panes.focused } })
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector(`[data-new-here="${paneId}"]`)).not.toBeNull()
  })
  expect(target.querySelector('[data-region="editor"]')).toBeNull()
})

test('acts on the pane being worked in, and only that one', () => {
  const { paneId: left, strip } = three()
  workspace.split('row')
  const right = workspace.panes.focusedId
  expect(right).not.toBe(left)
  const showing = workspace.showing(right)?.id
  expect(showing).toBeDefined()

  ctrlD()

  expect(workspace.showing(right)).toBeNull()
  expect(workspace.tabsIn(right).map((one) => one.id)).toEqual([showing])
  expect(workspace.showing(left)?.id).toBe(strip[1]?.id)
})

test('comes back to the tab it put down on Ctrl+Tab, either way round', () => {
  const { strip } = three()

  for (const direction of [1, -1]) {
    ctrlD()
    cycleTab(direction)
    expect(workspace.activeTabId, String(direction)).toBe(strip[1]?.id)
  }
})

test('is written down as the tab it put down', () => {
  three()
  ctrlD()

  const [pane] = panesOf(workspace.layout().frame)
  expect(pane?.active).toBe(1)
})

test('is a plane’s Duplicate while something on it is picked, and the tab’s otherwise', () => {
  const text = JSON.stringify({
    nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a' }],
    edges: [],
  })
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )
  const store = new CanvasStore(new Tab(note, 'pane'))
  const view = {
    width: 800,
    height: 600,
    path: null,
    name: 'Board',
    palette: {},
    onfind: () => undefined,
  }
  const press = () =>
    new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, cancelable: true })

  expect(run.keys(store, press(), view)).toBe(false)
  expect(store.canvas.nodes).toHaveLength(1)

  store.pick('a')
  expect(run.keys(store, press(), view)).toBe(true)
  expect(store.canvas.nodes).toHaveLength(2)
})

function ctrlShiftD(): boolean {
  const event = new KeyboardEvent('keydown', {
    key: 'D',
    code: 'KeyD',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })

  return shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })
}

test('Ctrl+Shift+D puts every pane down, and again brings each one’s tab back', () => {
  const { paneId: left, strip } = three()
  workspace.split('row')
  const right = workspace.panes.focusedId
  const showing = workspace.showing(right)?.id
  shown = mount(Tabs, { target, props: { paneId: left } })
  flushSync()

  expect(ctrlShiftD()).toBe(true)
  flushSync()
  expect(workspace.showing(left)).toBeNull()
  expect(workspace.showing(right)).toBeNull()
  expect(target.querySelectorAll('.tab.active')).toHaveLength(0)
  expect(workspace.tabsIn(left)).toHaveLength(3)
  expect(workspace.panes.focusedId).toBe(right)

  expect(ctrlShiftD()).toBe(true)
  flushSync()
  expect(workspace.showing(left)?.id).toBe(strip[1]?.id)
  expect(workspace.showing(right)?.id).toBe(showing)
  expect(target.querySelector('.tab.active')?.getAttribute('data-box')).toBe(strip[1]?.id)
  expect(workspace.panes.focusedId).toBe(right)
})

test('Ctrl+Shift+D puts them all down while any one pane still shows a tab', () => {
  const { paneId: left } = three()
  workspace.split('row')
  const right = workspace.panes.focusedId

  ctrlD()
  expect(workspace.showing(right)).toBeNull()
  expect(workspace.showing(left)).not.toBeNull()

  ctrlShiftD()
  expect(workspace.showing(left)).toBeNull()
  expect(workspace.showing(right)).toBeNull()
})
