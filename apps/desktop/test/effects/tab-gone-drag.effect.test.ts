import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

class NoLayout {
  observe() {
    // Nothing ever moves in jsdom, so nothing is ever reported.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

document.elementFromPoint = () => null
document.elementsFromPoint = () => []

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

const { workspace } = await import('../../src/lib/workspace.svelte')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default

const STRIP = { left: 0, right: 1000, top: 0, bottom: 38, x: 0, y: 0, width: 1000, height: 38 }

let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const box = this.classList.contains('tabs') ? STRIP : { ...STRIP, right: 0, bottom: 0 }
    return { ...box, toJSON: () => box }
  })
})

afterEach(() => {
  target.remove()
  vi.restoreAllMocks()
})

function pointer(type: string, clientX: number, clientY = 20, buttons = 1): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
    clientY,
    buttons,
  })
}

async function carriedOut() {
  await import('../../src/lib/tab-strip/carrying')
  workspace.tabs = []
  for (let at = 0; at < 3; at++) workspace.openWebsite()
  const paneId = workspace.panes.focusedId
  const strip = workspace.tabsIn(paneId).map((one) => one.id)
  const app = mount(Tabs, { target, props: { paneId } })
  flushSync()
  await Promise.resolve()
  const first = strip[0] ?? ''
  const tab = target.querySelector<HTMLElement>(`[data-box="${first}"] .pick`)
  expect(tab, 'the first tab is drawn').not.toBeNull()
  tab?.dispatchEvent(pointer('pointerdown', 28))
  await new Promise((go) => setTimeout(go, 0))
  tab?.dispatchEvent(pointer('pointermove', 300, 400))
  flushSync()
  expect(workspace.panes.dragging).toEqual({ tabId: first })
  workspace.close(first, false)
  flushSync()
  return { app, paneId, strip }
}

test('a tab closed while carried over the panes ends the drag on the next release anywhere', async () => {
  const { app, paneId, strip } = await carriedOut()

  document.body.dispatchEvent(pointer('pointerup', 300, 400, 0))
  flushSync()

  expect(workspace.panes.dragging).toBeNull()
  expect(workspace.panes.landing).toBeNull()
  expect(workspace.tabsIn(paneId).map((one) => one.id)).toEqual(strip.slice(1))
  void unmount(app, { outro: false })
})

test('a tab closed while carried, let go outside the window, ends on the next bare move', async () => {
  const { app } = await carriedOut()

  document.body.dispatchEvent(pointer('pointermove', 320, 420, 0))
  flushSync()

  expect(workspace.panes.dragging).toBeNull()
  void unmount(app, { outro: false })
})
