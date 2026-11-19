import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { EditorView } from '@orden/editor'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
vi.mock('@orden/editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@orden/editor')>()
  return { ...real, createEditor: vi.fn(real.createEditor) }
})
vi.mock('../../surfaces/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surfaces/src/api')>()),
  terminalSurface: () => import('../test/Counted.svelte').then((one) => one.default),
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
Element.prototype.scrollIntoView = () => undefined
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
const { createEditor } = await import('@orden/editor')
const { workspace } = await import('../../workspace/src/api')
const { views } = await import('../../panes/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { counted } = await import('../test/counted')
const Pane = (await import('./Pane.svelte')).default
let target: HTMLElement
let shown: ReturnType<typeof mount> | null = null
beforeEach(() => {
  viewport.device = 'desktop'
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  target = document.createElement('div')
  document.body.append(target)
  vi.mocked(createEditor).mockClear()
  counted.mounts = 0
})
afterEach(() => {
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
  workspace.activate(one)
  return { one, two, shell, paneId: workspace.panes.focusedId }
}
function written(): string {
  return [...target.querySelectorAll<HTMLElement>('.editor')]
    .map((one) => one.querySelector('.cm-content')?.textContent ?? '')
    .join('|')
}
async function drawn(paneId: string): Promise<EditorView> {
  shown = mount(Pane, { target, props: { pane: workspace.panes.focused } })
  await vi.waitFor(() => {
    flushSync()
    expect(views.of(paneId)).toBeDefined()
  })
  return views.of(paneId)!
}
test('a note switched away from and back to keeps its editor, and is shown after one flush', async () => {
  const { one, two, paneId } = opened()
  const first = await drawn(paneId)
  const swapped = vi.spyOn(first, 'setState')
  workspace.activate(two)
  flushSync()
  expect(written()).toBe('The second note.')
  const second = views.of(paneId)
  expect(second).not.toBe(first)
  workspace.activate(one)
  flushSync()
  expect(written()).toBe('The first note.')
  expect(views.of(paneId)).toBe(first)
  expect(swapped).not.toHaveBeenCalled()
  expect(vi.mocked(createEditor)).toHaveBeenCalledTimes(2)
})
test('a note shown again after a terminal is not built again', async () => {
  const { one, shell, paneId } = opened()
  const first = await drawn(paneId)
  workspace.activate(shell)
  flushSync()
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  expect(written()).toBe('')
  expect(views.of(paneId)).toBeUndefined()
  workspace.activate(one)
  flushSync()
  expect(written()).toBe('The first note.')
  expect(views.of(paneId)).toBe(first)
  expect(vi.mocked(createEditor)).toHaveBeenCalledTimes(1)
  expect(target.querySelectorAll('.cm-content')).toHaveLength(1)
})
test('keeps no more than six editors, and a note let go of keeps its undo', async () => {
  const ids: string[] = []
  for (let at = 0; at < 8; at += 1) {
    workspace.openBlank(`Note ${at}`, `Words ${at}.`)
    ids.push(workspace.active?.id ?? '')
  }
  const paneId = workspace.panes.focusedId
  workspace.activate(ids[0] ?? '')
  const first = await drawn(paneId)
  first.dispatch({ changes: { from: 0, insert: 'Typed. ' } })
  for (const id of ids.slice(1)) {
    workspace.activate(id)
    flushSync()
  }
  expect(target.querySelectorAll('.editor, .kept')).toHaveLength(6)
  expect(target.querySelectorAll('.editor')).toHaveLength(1)
  workspace.activate(ids[0] ?? '')
  flushSync()
  expect(written()).toBe('Typed. Words 0.')
  const again = views.of(paneId)!
  expect(again).not.toBe(first)
  const { undoEdit } = await import('@orden/editor')
  expect(undoEdit(again)).toBe(true)
  expect(again.state.doc.toString()).toBe('Words 0.')
})
