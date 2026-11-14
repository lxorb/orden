import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { warmWindow } from './warm-window'

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

Element.prototype.animate = function animate() {
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
const { viewport } = await import('../../src/lib/viewport.svelte')
const { views } = await import('../../src/lib/views.svelte')
const App = (await import('../../src/App.svelte')).default

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
const thrown: unknown[] = []
const heard = (error: unknown) => thrown.push(error)

beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.fills = null
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  thrown.length = 0
  process.on('uncaughtException', heard)
  process.on('unhandledRejection', heard)
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(async () => {
  process.off('uncaughtException', heard)
  process.off('unhandledRejection', heard)
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  viewport.device = 'desktop'
  await vi.dynamicImportSettled()
})

async function settle() {
  for (let turn = 0; turn < 6; turn++) {
    await tick()
    await new Promise((done) => setTimeout(done, 0))
    flushSync()
  }
}

async function sideBySide(focus: 'left' | 'right') {
  workspace.openBlank('Left', '# Left\n\nWords.')
  workspace.split('row')
  workspace.openBlank('Right', '# Right\n\nMore words.')
  const [left, right] = workspace.panes.all
  if (!left || !right) throw new Error('no second pane')
  workspace.focusPane(focus === 'left' ? left.id : right.id)
  const drafts = workspace.tabs.map((tab) => tab.note)
  await vi.waitFor(() => expect(drafts.map((note) => note.path)).not.toContain(null), {
    timeout: 15_000,
  })
  shown = mount(App, { target })
  await settle()
  expect(target.querySelectorAll('[data-pane]')).toHaveLength(2)
  return { left: left.id, right: right.id }
}

const panesShown = () =>
  [...target.querySelectorAll('[data-pane]')].map((one) => one.getAttribute('data-pane'))

for (const focus of ['left', 'right'] as const) {
  test(`the window narrowing into a phone's keeps the ${focus} pane and throws nothing`, async () => {
    const ids = await sideBySide(focus)

    viewport.device = 'phone'
    await settle()

    expect(thrown).toEqual([])
    expect(panesShown()).toEqual([ids[focus]])
    expect(views.of(ids[focus]), 'the pane that stayed lost its editor').toBeDefined()
  })

  test(`closing the ${focus} pane's last tab leaves the other pane and throws nothing`, async () => {
    const ids = await sideBySide(focus)
    const kept = focus === 'left' ? ids.right : ids.left

    for (const gone of workspace.tabsIn(ids[focus])) workspace.close(gone.id)
    await settle()

    expect(thrown).toEqual([])
    expect(panesShown()).toEqual([kept])
    expect(views.of(kept), 'the pane that stayed lost its editor').toBeDefined()
  })
}

test('a split inside a split losing a pane keeps the other two and throws nothing', async () => {
  const ids = await sideBySide('right')
  workspace.split('column')
  await settle()
  const [, upper, lower] = workspace.panes.all.map((one) => one.id)
  if (!upper || !lower) throw new Error('no third pane')
  expect(panesShown()).toEqual([ids.left, upper, lower])

  for (const gone of workspace.tabsIn(lower)) workspace.close(gone.id)
  await settle()

  expect(thrown).toEqual([])
  expect(panesShown()).toEqual([ids.left, upper])
  expect(views.of(upper), 'the pane that stayed lost its editor').toBeDefined()
})
