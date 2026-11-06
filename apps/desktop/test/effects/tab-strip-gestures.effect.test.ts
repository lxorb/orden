import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))

const STRIP = 600

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
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')
const { picks } = await import('../../src/lib/tab-strip/drag.svelte')
const { tabMenuTitle } = await import('../../src/lib/tab-strip/menu')
const Tabs = (await import('../../src/lib/Tabs.svelte')).default
await import('../../src/lib/tab-strip/closing.svelte')
await import('../../src/lib/tab-strip/picking.svelte')

const settles = <T>(check: () => T) => vi.waitFor(check, { timeout: 10_000 })

let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null

beforeEach(() => {
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  picks.loaded?.chosen.clear()
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
})

const NAMES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

async function strip() {
  for (const name of NAMES) workspace.openBlank(name, `# ${name}`)
  const paneId = workspace.panes.focusedId
  const tabs = workspace.tabsIn(paneId)
  await settles(() => expect(tabs.every((one) => one.note.path !== null)).toBe(true))
  workspace.activate(tabs[1]?.id ?? '')
  workspace.activate(tabs[0]?.id ?? '')
  shown = mount(Tabs, { target, props: { paneId } })
  await settles(() => {
    flushSync()
    expect(target.querySelector<HTMLElement>('.tab')?.style.width).not.toBe('')
  })

  return { paneId, ids: tabs.map((one) => one.id) }
}

const pick = (id: string) => target.querySelector<HTMLElement>(`.pick[data-tab="${id}"]`)
const box = (id: string) => target.querySelector<HTMLElement>(`[data-box="${id}"]`)
const picked = () =>
  [...target.querySelectorAll<HTMLElement>('.tab.chosen')].map((one) => one.dataset.box)

function press(id: string, held: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
  const node = pick(id)
  if (!node) throw new Error(`no tab ${id}`)
  const at = {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerType: 'mouse',
    detail: 1,
    ...held,
  }
  node.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 }))
  node.dispatchEvent(new PointerEvent('pointerup', at))
  node.dispatchEvent(new MouseEvent('click', at))
  flushSync()
}

test('Ctrl and Shift pick tabs, their menu is about all of them, and Ctrl+W closes them', async () => {
  const { paneId, ids } = await strip()
  const [one, two, three, four] = ids as [string, string, string, string]

  press(two, { ctrlKey: true })
  await settles(() => expect(picks.loaded).not.toBeNull())
  flushSync()
  expect(picked()).toEqual([one, two])
  expect(workspace.activeTabId).toBe(two)

  press(four, { shiftKey: true })
  expect(picked()).toEqual([two, three, four])
  expect(workspace.activeTabId).toBe(four)

  press(three, { ctrlKey: true })
  expect(picked()).toEqual([two, four])

  const front = workspace.tabs.find((tab) => tab.id === four)
  if (!front) throw new Error('nothing in front')
  expect(tabMenuTitle(front, paneId)).toBe('2 tabs')

  const event = new KeyboardEvent('keydown', {
    key: 'w',
    code: 'KeyW',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  })
  expect(shortcuts.handle(event, { palette: () => undefined, fullscreen: () => undefined })).toBe(
    true,
  )
  await settles(() => expect(workspace.tabs.map((tab) => tab.id)).not.toContain(two))
  expect(workspace.tabs.map((tab) => tab.id)).not.toContain(four)
  expect(workspace.tabs).toHaveLength(NAMES.length - 2)
})

test('a plain click on a picked tab picks it alone; a Ctrl click on one keeps the pick', async () => {
  const { ids } = await strip()
  const [one, two, three] = ids as [string, string, string]

  press(two, { ctrlKey: true })
  await settles(() => expect(picks.loaded).not.toBeNull())
  press(three, { ctrlKey: true })
  expect(picked()).toEqual([one, two, three])

  press(three, { ctrlKey: true })
  press(three, { ctrlKey: true })
  expect(picked()).toEqual([one, two, three])

  press(one)
  expect(picked()).toEqual([])
  expect(workspace.activeTabId).toBe(one)
})

test('a tab closed with its cross goes as no longer in front, and the rest hold their widths', async () => {
  const { ids } = await strip()
  const [one, two] = ids as [string, string]
  await settles(() => expect(box(one)?.querySelector('.shut')).not.toBeNull())
  await new Promise((done) => setTimeout(done, 0))

  const before = new Map(ids.map((id) => [id, box(id)?.style.width]))
  const cross = box(one)?.querySelector<HTMLButtonElement>('.shut')
  cross?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))
  await settles(() => expect(workspace.tabs.map((tab) => tab.id)).not.toContain(one))
  flushSync()

  const going = box(one)
  expect(going).not.toBeNull()
  expect(going?.classList.contains('leaving')).toBe(true)
  expect(going?.classList.contains('active')).toBe(false)

  expect(
    [...target.querySelectorAll('.tab.active')].map((node) => (node as HTMLElement).dataset.box),
  ).toEqual([two])

  for (const id of ids.slice(1)) expect(box(id)?.style.width, id).toBe(before.get(id))
})

test('Delete on a tab leaves the keyboard on the tab in front after it, the one used before', async () => {
  const { ids } = await strip()
  const [one, two] = ids as [string, string]

  pick(one)?.focus()
  pick(one)?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }),
  )
  await settles(() => expect(workspace.tabs.map((tab) => tab.id)).not.toContain(one))
  await settles(() => expect(document.activeElement).toBe(pick(two)))
})
