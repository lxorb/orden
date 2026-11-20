import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { settle } from './settle'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))
vi.mock('../../src/lib/windows/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/windows/src/api')>()),
  hearHere: () => Promise.resolve(() => undefined),
}))
const { workspace } = await import('../../src/lib/workspace/src/api')
const { pages } = await import('../../src/lib/web-tab/src/pages.svelte')
const WebTab = (await import('../../src/lib/web-tab/src/WebTab.svelte')).default
const { startup } = await import('../../src/lib/launch/src/api')
await startup.shown()
await vi.waitFor(() => expect(startup.reached('rooms')).toBe(true), { timeout: 10_000 })

let frames = new Map<number, FrameRequestCallback>()
let nextFrame = 1
const told: ((ratio: number) => void)[] = []
let target: HTMLElement
beforeEach(() => {
  frames = new Map()
  told.length = 0
  vi.stubGlobal('requestAnimationFrame', (call: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, call)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  document.elementFromPoint = () => null
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private readonly heard: IntersectionObserverCallback) {}
      observe(node: Element) {
        told.push((ratio) =>
          this.heard(
            [{ intersectionRatio: ratio, target: node } as unknown as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        )
      }
      disconnect() {
        told.length = 0
      }
    },
  )
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  target.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
function frame() {
  const now = [...frames.values()]
  frames.clear()
  for (const one of now) one(performance.now())
}
test('a web tab whose pane moves without changing size is placed at once, and each frame while it moves', async () => {
  const id = workspace.openPage('https://example.com/')
  const tab = workspace.tabs.find((one) => one.id === id)
  if (!tab) throw new Error('no tab')
  pages.of(tab.id).live = true
  const box = { x: 0, y: 40, width: 800, height: 600 }
  const app = mount(WebTab, { target, props: { tab, focused: true } })
  flushSync()
  const hole = target.querySelector<HTMLElement>('.hole')
  if (!hole) throw new Error('no slot for the page')
  hole.getBoundingClientRect = () => DOMRect.fromRect(box)
  told.length = 0
  window.dispatchEvent(new Event('resize'))
  await settle()
  frame()
  frame()
  const show = vi.spyOn(pages, 'show')
  const placedAt = () => (show.mock.calls.at(-1)?.[2] as { x: number } | undefined)?.x
  try {
    box.x = 120
    expect(told).toHaveLength(1)
    told[0]?.(0.5)
    expect(placedAt()).toBe(120)
    box.x = 180
    frame()
    expect(placedAt()).toBe(180)
    box.x = 240
    frame()
    expect(placedAt()).toBe(240)
    const sent = show.mock.calls.length
    frame()
    frame()
    frame()
    frame()
    expect(show.mock.calls.length).toBe(sent)
    expect(frames.size).toBe(0)
  } finally {
    void unmount(app)
    workspace.close(tab.id)
  }
})
