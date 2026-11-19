import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
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
const { workspace } = await import('../../src/lib/workspace/src/api')
const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
const Tabs = (await import('../../src/lib/tab-strip/src/Tabs.svelte')).default
const STRIP = { left: 0, right: 1000, top: 0, bottom: 38, x: 0, y: 0, width: 1000, height: 38 }
let target: HTMLElement
beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const box = this.classList.contains('tabs') ? STRIP : { ...STRIP, right: 0, bottom: 0 }
    return { ...box, toJSON: () => box }
  })
})
afterEach(() => {
  target.remove()
  vi.restoreAllMocks()
})
function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    pointerType: 'mouse',
    clientX,
    clientY: 20,
  })
}
test('a web tab pressed on its favicon and carried along moves the tab', async () => {
  workspace.tabs = []
  for (let at = 0; at < 3; at++) workspace.openWebsite()
  const paneId = workspace.panes.focusedId
  const strip = workspace.tabsIn(paneId)
  expect(strip).toHaveLength(3)
  for (const one of strip) pages.of(one.id).icon = 'https://example.com/favicon.ico'
  const first = strip[0]?.id
  const app = mount(Tabs, { target, props: { paneId } })
  flushSync()
  const icon = target.querySelector<HTMLImageElement>(`[data-box="${first}"] img`)
  expect(icon, 'the first tab wears its favicon').not.toBeNull()
  if (!icon) return
  expect(icon.getAttribute('draggable')).toBe('false')
  icon.dispatchEvent(pointer('pointerdown', 28))
  icon.dispatchEvent(pointer('pointermove', 300))
  icon.dispatchEvent(pointer('pointermove', 700))
  flushSync()
  icon.dispatchEvent(pointer('pointerup', 700))
  flushSync()
  expect(
    workspace
      .tabsIn(paneId)
      .map((one) => one.id)
      .indexOf(first ?? ''),
  ).toBe(2)
  await Promise.all([
    import('../../src/lib/tab-strip/src/TabChip.svelte'),
    import('../../src/lib/tab-strip/src/carrying'),
  ])
  void unmount(app, { outro: false })
})
