import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { warmWindow } from './warm-window'

vi.hoisted(() => {
  Object.defineProperty(navigator, 'userAgent', {
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    configurable: true,
  })
})

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

vi.mock('../../src/lib/start', () => ({ start: () => () => undefined }))

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

const moved: { keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = []
Element.prototype.animate = function animate(keyframes, options) {
  moved.push({
    keyframes: keyframes as Keyframe[],
    options: (typeof options === 'number' ? { duration: options } : options) ?? {},
  })
  return {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  } as unknown as Animation
}
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = () => undefined
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

const { workspace } = await import('../../src/lib/workspace.svelte')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { viewport } = await import('../../src/lib/viewport.svelte')
const { STARTS_RIGHT } = await import('../../src/lib/workspace/panels')
const App = (await import('../../src/App.svelte')).default
await import('../../src/lib/tab-fill/fill')
await import('../../src/lib/tab-fill/FillBar.svelte')

await warmWindow(
  () => {
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
    workspace.openBlank('Left', '# Left')
    workspace.split('row')
    workspace.openBlank('Right', '# Right')
    const held = document.createElement('div')
    document.body.append(held)
    const drawn = mount(App, { target: held })
    return () => {
      void unmount(drawn, { outro: false })
      held.remove()
      workspace.panes.collapse()
      workspace.tabs = []
    }
  },
  () =>
    document.querySelectorAll('[data-pane]').length === 2 &&
    document.querySelectorAll('[data-pane] .cm-content').length === 2,
)

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.fills = null
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.panel = 'tree'
  workspace.right = [...STARTS_RIGHT]
  workspace.rightPanel = null
  moved.length = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(async () => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  workspace.panes.fills = null
  await vi.dynamicImportSettled()
})

async function press(key: string, held: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...held,
  })
  shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })
  await settle()
  return event
}

const shiftF11 = () => press('F11', { shiftKey: true })

async function settle() {
  for (let turn = 0; turn < 6; turn++) {
    await tick()
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

async function window2() {
  workspace.openBlank('Left', '# Left\n\nWords.')
  workspace.openBlank('Other', '# Other')
  workspace.split('row')
  const [left] = workspace.panes.all
  if (!left) throw new Error('no pane')
  workspace.focusPane(left.id)
  await vi.waitFor(() =>
    expect(workspace.tabs.every((tab) => tab.note.kind !== 'note' || tab.note.path !== null)).toBe(
      true,
    ),
  )
  shown = mount(App, { target })
  await settle()
  return left.id
}

function chrome() {
  return {
    sidebar: target.querySelector('aside')?.outerHTML ?? null,
    strips: [...target.querySelectorAll('[role="tab"], .tab')].map((one) => one.textContent),
    panes: [...target.querySelectorAll('[data-pane]')].map((one) => one.getAttribute('data-pane')),
    heads: [
      ...target.querySelectorAll('[data-pane] > [data-chrome="top"], header [data-top-strip]'),
    ].filter((one) => !one.closest('.bar')).length,
    status: target.querySelector('[data-region="status"]') !== null,
  }
}

test('the key fills the window with the tab being worked in, and gives the window back', async () => {
  const left = await window2()
  const before = chrome()
  const layout = JSON.stringify(workspace.panes.frame)

  expect(before.sidebar).not.toBeNull()
  expect(before.panes).toHaveLength(2)
  expect(before.heads).toBe(2)

  await shiftF11()

  expect(workspace.panes.fills).toBe(left)
  const filled = chrome()
  expect(filled.sidebar, 'the file list is still on screen').toBeNull()
  expect(filled.panes, 'the other pane is still on screen').toEqual([left])
  expect(filled.heads, 'a pane still carries its own strip').toBe(0)
  expect(filled.status).toBe(false)

  const bar = target.querySelector('.bar')
  expect(bar).not.toBeNull()
  expect((bar as HTMLElement | null)?.inert).toBe(true)
  expect(bar?.querySelector('header')).not.toBeNull()

  expect(JSON.stringify(workspace.panes.frame)).toBe(layout)
  expect(workspace.panel).toBe('tree')

  await shiftF11()

  expect(workspace.panes.fills).toBeNull()
  expect(chrome(), 'the window came back different').toEqual(before)
  expect(target.querySelector('.bar')).toBeNull()
})

test('the chrome goes toward its edges and comes back from them, and nothing else moves', async () => {
  await window2()
  moved.length = 0
  await shiftF11()

  const going = moved.splice(0)
  expect(going.length).toBeGreaterThan(0)
  for (const one of going) {
    expect(one.keyframes.at(-1)).toMatchObject({ opacity: 0 })
    expect(one.options.fill).toBe('forwards')
  }

  await shiftF11()
  const coming = moved.splice(0)
  expect(coming.length).toBeGreaterThan(0)
  for (const one of coming) expect(one.keyframes.at(-1)).toMatchObject({ opacity: 1 })
})

test('another tab of the same pane keeps the window filled', async () => {
  const left = await window2()
  workspace.openBlank('Third', '# Third')
  const third = workspace.activeTabId
  await settle()
  await shiftF11()

  const [first] = workspace.tabsIn(left)
  workspace.activate(first?.id ?? '')
  await settle()
  expect(workspace.panes.fills).toBe(left)

  workspace.activate(third ?? '')
  await settle()
  expect(workspace.panes.fills).toBe(left)
})

test('working in the other pane gives the window back', async () => {
  const left = await window2()
  await shiftF11()
  expect(workspace.panes.fills).toBe(left)

  workspace.panes.focusNext()
  await settle()
  expect(workspace.panes.fills).toBeNull()
  expect(chrome().panes).toHaveLength(2)
})

test('a pane with nothing left in front gives the window back', async () => {
  const left = await window2()
  await shiftF11()

  workspace.deselect(left)
  await settle()
  expect(workspace.panes.fills).toBeNull()
})

test('asking for the file list gives the window back with the list as it was', async () => {
  await window2()
  await shiftF11()

  await press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' })
  expect(workspace.panes.fills).toBeNull()
  expect(workspace.panel).toBe('tree')
  expect(target.querySelector('aside')).not.toBeNull()
})

test('the sidebar key shows the list that was under the fill rather than shutting it', async () => {
  await window2()
  await shiftF11()

  await press('L', { ctrlKey: true, shiftKey: true, code: 'KeyL' })
  expect(workspace.panes.fills).toBeNull()
  expect(workspace.panel).toBe('tree')
})

test('Escape leaves only where nothing else has a use for it', async () => {
  await window2()
  await shiftF11()

  const note = target.querySelector<HTMLElement>('[data-pane] .cm-content')
  note?.focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(workspace.panes.fills).not.toBeNull()

  note?.blur()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await settle()
  expect(workspace.panes.fills).toBeNull()
})

test('a phone does not fill: it shows one document already', async () => {
  workspace.openBlank('One', '# One')
  shown = mount(App, { target })
  viewport.device = 'phone'
  await settle()
  await shiftF11()
  expect(workspace.panes.fills).toBeNull()
})
