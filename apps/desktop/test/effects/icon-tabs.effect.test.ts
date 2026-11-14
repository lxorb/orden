import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

const STRIP = 1200

class Measured {
  constructor(private readonly told: ResizeObserverCallback) {}

  observe(target: Element) {
    queueMicrotask(() => this.told([{ target } as ResizeObserverEntry], this))
  }

  unobserve() {
    // Nothing is watched for long enough to need it.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = Measured
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: HTMLElement) {
    return this.classList.contains('tabs') ? STRIP : 0
  },
})

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: new Promise(() => undefined),
    currentTime: 0,
    startTime: 0,
    playState: 'running',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.getAnimations = () => []
Element.prototype.scrollIntoView = () => undefined

const { workspace } = await import('../../src/lib/workspace.svelte')
const { iconTabs } = await import('../../src/lib/tab-strip/icon-tabs.svelte')
const { OPENED_LEAST, WIDTH } = await import('../../src/lib/tab-strip/layout')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default
await import('../../src/lib/tab-strip/closing.svelte')

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  iconTabs.set(true)
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
  iconTabs.set(true)
})

async function strip() {
  for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) workspace.openBlank(name, `# ${name}`)
  const paneId = workspace.panes.focusedId
  const tabs = workspace.tabsIn(paneId)
  workspace.activate(tabs[0]?.id ?? '')
  shown = mount(Tabs, { target, props: { paneId } })
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector<HTMLElement>('.tab')?.style.width).not.toBe('')
  })
  return tabs.map((one) => one.id)
}

const box = (id: string) => target.querySelector<HTMLElement>(`[data-box="${id}"]`)
const width = (id: string) => parseFloat(box(id)?.style.width ?? '0')
const along = (id: string) => /translateX\((-?[\d.]+)px\)/.exec(box(id)?.style.transform ?? '')?.[1]

function point(id: string, how: 'pointerenter' | 'pointerleave') {
  const event = new PointerEvent(how, { bubbles: false, pointerType: 'mouse' })
  box(id)?.dispatchEvent(event)
  flushSync()
}

test('every tab but the one in front is its mark alone, the name kept for a screen reader', async () => {
  const [front, ...rest] = await strip()
  expect(box(front ?? '')?.classList.contains('icon')).toBe(false)
  for (const id of rest) {
    expect(box(id)?.classList.contains('icon'), id).toBe(true)
    expect(width(id)).toBe(WIDTH.icon)
    expect(target.querySelector(`.pick[data-tab="${id}"]`)?.getAttribute('aria-label')).toBeTruthy()
  }
})

test('the pointer on one opens it out at once, and those in front of it stay where they were', async () => {
  const [, beta, gamma] = await strip()
  const before = along(beta ?? '')
  point(gamma ?? '', 'pointerenter')
  expect(box(gamma ?? '')?.classList.contains('icon')).toBe(false)
  expect(width(gamma ?? '')).toBeGreaterThanOrEqual(OPENED_LEAST)
  expect(along(beta ?? '')).toBe(before)

  point(gamma ?? '', 'pointerleave')
  expect(width(gamma ?? '')).toBe(WIDTH.icon)
})

test('two that would look the same each wear their first letter', async () => {
  const [, beta, gamma] = await strip()
  expect(box(beta ?? '')?.querySelector('.letter')?.textContent).toBe('B')
  expect(box(gamma ?? '')?.querySelector('.letter')?.textContent).toBe('G')
})

test('turned off, every tab has its name again', async () => {
  const ids = await strip()
  iconTabs.set(false)
  flushSync()
  for (const id of ids) expect(box(id)?.classList.contains('icon'), id).toBe(false)
})
