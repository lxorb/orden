import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('../../surfaces/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surfaces/src/api')>()),
  terminalSurface: () => import('../test/Counted.svelte').then((one) => one.default),
}))
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
Element.prototype.scrollIntoView = () => undefined
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { recentLog } = await import('../../platform/src/api')
const { LONG, lookAtFronts, strayIn } = await import('./front-watch')
const PaneTree = (await import('./PaneTree.svelte')).default
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
let now = 0
beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
  now += 100_000
})
afterEach(() => {
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  workspace.tabs = []
})
const SAID = 'pane shows another tab than the one in front'
const lines = () => recentLog().filter((line) => line.includes(SAID))
function kept(id: string): HTMLElement {
  const found = target.querySelector<HTMLElement>(`.card > [data-kept="${id}"]`)
  if (!found) throw new Error(`no surface kept for ${id}`)
  return found
}
function unhidden(): string[] {
  return [...target.querySelectorAll<HTMLElement>('.card > [data-kept]')]
    .filter((one) => !one.hidden)
    .map((one) => one.dataset.kept ?? '')
}
async function opened(): Promise<{ one: string; shell: string; paneId: string }> {
  workspace.openBlank('One', 'The first note.')
  const one = workspace.active?.id ?? ''
  workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'kept' }), 'Shell', null, false)
  const shell = workspace.tabs.find((tab) => tab.kind === 'terminal')?.id ?? ''
  workspace.activate(shell)
  shown = mount(PaneTree, { target, props: { frame: workspace.panes.frame } })
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  workspace.activate(one)
  flushSync()
  expect(unhidden()).toEqual([one])
  return { one, shell, paneId: workspace.panes.focusedId }
}
test('a pane switched between its tabs is never told of', async () => {
  const { one, shell, paneId } = await opened()
  const before = lines().length
  for (const id of [shell, one, shell, one]) {
    workspace.activate(id)
    flushSync()
    lookAtFronts((now += LONG + 1))
    lookAtFronts((now += LONG + 1))
    expect(strayIn(paneId)).toBeNull()
  }
  expect(lines()).toHaveLength(before)
})
test('a pane left showing the tab it was switched from is told of with both tabs and drawn again from the one in front', async () => {
  const { one, shell, paneId } = await opened()
  const before = lines().length
  kept(shell).hidden = false
  kept(one).hidden = true
  lookAtFronts(now)
  lookAtFronts((now += LONG - 100))
  expect(lines()).toHaveLength(before)
  lookAtFronts((now += 200))
  const said = lines().slice(before)
  expect(said).toHaveLength(1)
  expect(said[0]).toContain(' warn ')
  expect(said[0]).toContain('so the pane is drawn again')
  expect(said[0]).toContain(`"pane":"${paneId}"`)
  expect(said[0]).toContain(`"front":{"id":"${one}","kind":"note"}`)
  expect(said[0]).toContain(`"shown":[{"id":"${shell}","kind":"terminal"}]`)
  expect(said[0]).toContain('"frontHidden":true')
  flushSync()
  expect(unhidden()).toEqual([one])
  expect(target.querySelector('.cm-content')?.textContent).toBe('The first note.')
  lookAtFronts((now += LONG + 1))
  lookAtFronts((now += LONG + 1))
  expect(lines()).toHaveLength(before + 1)
})
test('a pane still wrong after it was drawn again is told of once more, and not drawn over and over', async () => {
  const { one, shell } = await opened()
  const before = lines().length
  const spoil = () => {
    kept(shell).hidden = false
  }
  spoil()
  lookAtFronts(now)
  lookAtFronts((now += LONG + 1))
  flushSync()
  await vi.waitFor(() => {
    flushSync()
    expect(unhidden()).toEqual([one])
  })
  workspace.activate(shell)
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  workspace.activate(one)
  flushSync()
  const drawn = target.querySelector('[data-pane]')
  spoil()
  lookAtFronts((now += 1))
  lookAtFronts((now += LONG + 1))
  flushSync()
  const said = lines().slice(before)
  expect(said).toHaveLength(2)
  expect(said[1]).toContain('still so after the pane was drawn again')
  expect(target.querySelector('[data-pane]')).toBe(drawn)
})
