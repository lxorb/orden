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
const { views } = await import('../../panes/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { failing, failingRoot } = await import('../test/failing.svelte')
const PaneTree = (await import('./PaneTree.svelte')).default
const Beside = (await import('../test/Beside.svelte')).default
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
let stop: (() => void) | null = null
const said: unknown[] = []
const turn = () => new Promise((go) => setTimeout(go, 0))
const told = () => said.map((one) => (one instanceof Error ? (one.message.split('\n')[0] ?? '') : String(one)))
beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
  failing.before = false
  failing.after = false
  said.length = 0
  vi.stubGlobal('reportError', (error: unknown) => said.push(error))
})
afterEach(() => {
  vi.unstubAllGlobals()
  stop?.()
  stop = null
  if (shown) void unmount(shown, { outro: false })
  shown = null
  target.remove()
  workspace.tabs = []
})
function opened(): { one: string; two: string; shell: string; paneId: string } {
  workspace.openBlank('One', 'The first note.')
  const one = workspace.active?.id ?? ''
  workspace.openBlank('Two', 'The second note.')
  const two = workspace.active?.id ?? ''
  workspace.openUnsaved('terminal', JSON.stringify({ shell: 'bash', folder: null, key: 'kept' }), 'Shell', null, false)
  const shell = workspace.tabs.find((tab) => tab.kind === 'terminal')?.id ?? ''
  workspace.activate(shell)
  return { one, two, shell, paneId: workspace.panes.focusedId }
}
function seen(): string {
  const card = target.querySelector('.card')
  const kept = [...(card?.children ?? [])].filter(
    (one) => one.matches('.front, .editor') && !(one as HTMLElement).hidden,
  )
  return kept
    .map((one) => one.querySelector('.cm-content')?.textContent ?? one.querySelector('.counted')?.textContent ?? '')
    .join('|')
}
async function drawn(shell: string, beside = false) {
  shown = beside ? mount(Beside, { target }) : mount(PaneTree, { target, props: { frame: workspace.panes.frame } })
  await vi.waitFor(() => {
    flushSync()
    expect(seen()).toBe(shell)
  })
}
test('a store that fails before the pane is drawn leaves the pane showing each tab switched to', async () => {
  const { one, two, shell, paneId } = opened()
  stop = failingRoot()
  await drawn(shell)
  failing.before = true
  workspace.activate(one)
  await turn()
  await turn()
  expect(seen()).toBe('The first note.')
  expect(views.of(paneId)).toBeDefined()
  expect(told()).toEqual(['a store failed before the pane was drawn'])
  failing.before = false
  workspace.activate(two)
  await turn()
  expect(seen()).toBe('The second note.')
  workspace.activate(shell)
  await turn()
  expect(seen()).toBe(shell)
})
test('what fails beside the pane, drawn before it, leaves the pane showing each tab switched to', async () => {
  const { one, two, shell } = opened()
  await drawn(shell, true)
  failing.before = true
  workspace.activate(one)
  await turn()
  await turn()
  expect(seen()).toBe('The first note.')
  expect(told()).toEqual(['what is drawn before the pane failed'])
  failing.before = false
  workspace.activate(two)
  await turn()
  expect(seen()).toBe('The second note.')
  expect(target.querySelector('.before')?.textContent).toBe(two)
})
test('a store that fails after the pane is drawn stops no other effect of that turn', async () => {
  const { one, shell, paneId } = opened()
  stop = failingRoot()
  await drawn(shell)
  expect(views.of(paneId)).toBeUndefined()
  failing.after = true
  workspace.activate(one)
  await turn()
  await turn()
  expect(seen()).toBe('The first note.')
  expect(views.of(paneId)).toBeDefined()
  expect(told()).toEqual(['a store failed after the pane was drawn'])
})
