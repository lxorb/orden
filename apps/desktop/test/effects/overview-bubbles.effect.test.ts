import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { idle } from './settle'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))
vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces')
      return Promise.resolve([
        { name: 'Work', path: '/spaces/Work' },
        { name: 'Home', path: '/spaces/Home' },
        { name: 'Empty', path: '/spaces/Empty' },
      ])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))
window.matchMedia = ((query: string) => ({
  matches: query.includes('reduce'),
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia
Element.prototype.scrollIntoView = () => undefined
Element.prototype.setPointerCapture = () => undefined
const { Disk } = await import('../disk')
disk.current = new Disk()
const { workspace, tabOverview } = await import('../../src/lib/workspace/src/api')
await import('../../src/lib/workspace-ports')
await import('../../src/lib/workspace/src/sets.svelte')
const { pane } = await import('../../src/lib/panes/src/api')
const { places } = await import('../../src/lib/overview/src/places.svelte')
const { settled } = await import('../../src/lib/overview/src/later')
const { default: Overview } = await import('../../src/lib/overview/src/Overview.svelte')
let close: () => void
beforeEach(async () => {
  disk.current?.reset()
  disk.current?.files.set('/spaces/Work/Plan.md', '# Plan\n')
  disk.current?.files.set('/spaces/Home/Food.md', '# Food\n')
  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'home', name: 'Home', root: '/spaces/Home' },
    { id: 'empty', name: 'Empty', root: '/spaces/Empty' },
  ]
  await workspace.showSpace('empty')
  await workspace.showSpace('work')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  await workspace.loadTree()
  await workspace.openEntry('/spaces/Work/Plan.md')
  await workspace.showSpace('home')
  await workspace.loadTree()
  await workspace.openEntry('/spaces/Home/Food.md')
  await workspace.showSpace('work')
  flushSync()
  const made = mount(Overview, { target: document.body })
  close = () => void unmount(made, { outro: false })
})
afterEach(() => {
  tabOverview.open = false
  flushSync()
  close()
  vi.restoreAllMocks()
})
async function opened() {
  tabOverview.open = true
  flushSync()
  await tick()
  await settled()
  await idle(20)
}
function onScreen(key: string): { x: number; y: number } {
  const [cx, cy, zoom] = (
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
      document.querySelector<HTMLElement>('.under .world')?.style.transform ?? '',
    ) ?? []
  )
    .slice(1)
    .map(Number)
  const index = [...document.querySelectorAll('[data-space-name]')].findIndex(
    (one) => one.getAttribute('data-space-name') === key,
  )
  const d = document.querySelectorAll('.cells .bubble')[index]?.getAttribute('d') ?? ''
  const numbers = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
  const xs = numbers.filter((_, at) => at % 2 === 0)
  const ys = numbers.filter((_, at) => at % 2 === 1)
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  return { x: (cx ?? 0) + middle.x * (zoom ?? 1), y: (cy ?? 0) + middle.y * (zoom ?? 1) }
}
function press(at: { x: number; y: number }, path: readonly { x: number; y: number }[] = []) {
  const floor = document.querySelector<HTMLElement>('.floor')
  const send = (type: string, one: { x: number; y: number }) =>
    floor?.dispatchEvent(
      new PointerEvent(type, { clientX: one.x, clientY: one.y, button: 0, pointerId: 1, bubbles: true }),
    )
  send('pointerdown', at)
  for (const one of path) send('pointermove', one)
  send('pointerup', path.at(-1) ?? at)
  flushSync()
}
test('a click on the bubble of a space with no tab goes into that space, even when the hand moved a little', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  await opened()
  expect(document.querySelector('[data-space-name="empty"]')).not.toBe(null)
  const at = onScreen('empty')
  press(at, [{ x: at.x + 2, y: at.y + 1 }])
  await tick()
  expect(shown).toHaveBeenCalledWith('empty')
  await vi.waitFor(() => expect(tabOverview.open).toBe(false))
})
test('a click on the bare part of a bubble with tabs goes into its space too', async () => {
  await opened()
  expect(document.querySelector('[data-space-name="home"]')).not.toBe(null)
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  const name = document.querySelector<HTMLElement>('[data-space-name="home"]')
  const [x, y] = (name?.style.translate ?? '0px 0px').split(' ').map(parseFloat)
  const [cx, cy, zoom] = (
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
      document.querySelector<HTMLElement>('.under .world')?.style.transform ?? '',
    ) ?? []
  )
    .slice(1)
    .map(Number)
  press({ x: (cx ?? 0) + (x ?? 0) * (zoom ?? 1), y: (cy ?? 0) + ((y ?? 0) - 4) * (zoom ?? 1) })
  await tick()
  expect(shown).toHaveBeenCalledWith('home')
  await vi.waitFor(() => expect(tabOverview.open).toBe(false))
})
test('a bubble dragged by its bare part moves, and its new place is kept the next time the overview opens', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  await opened()
  const before = places.at('empty')
  expect(before).toBeTruthy()
  const from = onScreen('empty')
  press(from, [
    { x: from.x + 10, y: from.y },
    { x: from.x + 60, y: from.y + 40 },
    { x: from.x + 120, y: from.y + 80 },
  ])
  await idle(20)
  const after = places.at('empty')
  expect(shown).not.toHaveBeenCalled()
  expect(tabOverview.open).toBe(true)
  expect((after?.x ?? 0) - (before?.x ?? 0)).toBeGreaterThan(0)
  expect((after?.y ?? 0) - (before?.y ?? 0)).toBeGreaterThan(0)
  tabOverview.open = false
  flushSync()
  await idle(20)
  await opened()
  expect(places.at('empty')).toEqual(after)
})
test('a press on a window still drags that tab, not its bubble', async () => {
  await opened()
  const before = places.at('work')
  const window = document.querySelector<HTMLElement>('.canvas .window')
  const box = { x: 0, y: 0 }
  const send = (type: string, x: number, y: number) =>
    window?.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 2, bubbles: true }))
  send('pointerdown', box.x, box.y)
  send('pointermove', box.x + 60, box.y + 40)
  flushSync()
  expect(window?.classList.contains('is-held')).toBe(true)
  send('pointerup', box.x + 60, box.y + 40)
  flushSync()
  expect(places.at('work')).toEqual(before)
})
test('a bubble with windows placed by hand takes them along when it is dragged', async () => {
  await opened()
  const food = () =>
    [...document.querySelectorAll<HTMLElement>('.canvas .window')].find((one) =>
      one.getAttribute('aria-label')?.startsWith('Food'),
    )
  const at = () =>
    (/translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(food()?.style.transform ?? '') ?? []).slice(1).map(Number)
  const send = (type: string, x: number, y: number) =>
    food()?.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 3, bubbles: true }))
  send('pointerdown', 0, 0)
  send('pointermove', 30, 20)
  send('pointerup', 30, 20)
  flushSync()
  await idle(20)
  const [x0, y0] = at()
  const name = document.querySelector<HTMLElement>('[data-space-name="home"]')
  const [nx, ny] = (name?.style.translate ?? '0px 0px').split(' ').map(parseFloat)
  const [cx, cy, zoom] = (
    /translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(
      document.querySelector<HTMLElement>('.under .world')?.style.transform ?? '',
    ) ?? []
  )
    .slice(1)
    .map(Number)
  const from = { x: (cx ?? 0) + (nx ?? 0) * (zoom ?? 1), y: (cy ?? 0) + ((ny ?? 0) - 4) * (zoom ?? 1) }
  press(from, [
    { x: from.x + 10, y: from.y },
    { x: from.x + 80, y: from.y + 60 },
  ])
  await idle(20)
  const [x1, y1] = at()
  expect((x1 ?? 0) - (x0 ?? 0)).toBeGreaterThan(40)
  expect((y1 ?? 0) - (y0 ?? 0)).toBeGreaterThan(30)
})
