import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { EditorView } from '@orden/editor'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: false,
  isNative: false,
  invoke: () => Promise.resolve(undefined),
}))
const guest = vi.hoisted(() => ({ viewOnly: false }))
vi.mock('../../sharing/src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../sharing/src/api')>()
  return {
    ...real,
    canWriteIn: (...said: Parameters<typeof real.canWriteIn>) => !guest.viewOnly && real.canWriteIn(...said),
  }
})
vi.mock('@orden/editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@orden/editor')>()
  return { ...real, createEditor: vi.fn(real.createEditor) }
})
vi.mock('../../surfaces/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../surfaces/src/api')>()),
  terminalSurface: () => import('../test/Counted.svelte').then((one) => one.default),
  webSurface: () => import('../test/Counted.svelte').then((one) => one.default),
  timeSurface: () => import('../test/Counted.svelte').then((one) => one.default),
  passSurface: () => import('../test/Counted.svelte').then((one) => one.default),
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
  counted.shown = {}
  counted.throws = false
  counted.ticks = 0
  guest.viewOnly = false
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
test('a terminal shown again after a note is not mounted again, and only the shown tab takes keys', async () => {
  const { one, shell, paneId } = opened()
  await drawn(paneId)
  workspace.activate(shell)
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  expect(counted.shown[shell]).toBe(true)
  workspace.activate(one)
  flushSync()
  expect(written()).toBe('The first note.')
  expect(counted.shown[shell]).toBe(false)
  const shellBox = target.querySelector('.counted')?.parentElement
  expect(shellBox?.inert).toBe(true)
  expect(shellBox?.hidden).toBe(true)
  expect(target.querySelector<HTMLElement>('.editor')?.inert).toBeFalsy()
  workspace.activate(shell)
  flushSync()
  expect(counted.shown[shell]).toBe(true)
  expect(shellBox?.inert).toBe(false)
  expect(shellBox?.hidden).toBe(false)
  expect(counted.mounts).toBe(1)
})
test('a web tab shown again after a note is not mounted again, and is told when it is behind', async () => {
  const { one, paneId } = opened()
  await drawn(paneId)
  workspace.openPage('https://example.com/')
  const page = workspace.active?.id ?? ''
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  expect(counted.shown[page]).toBe(true)
  workspace.activate(one)
  flushSync()
  expect(written()).toBe('The first note.')
  expect(counted.shown[page]).toBe(false)
  const pageBox = target.querySelector('.counted')?.parentElement
  expect(pageBox?.inert).toBe(true)
  expect(pageBox?.hidden).toBe(true)
  workspace.activate(page)
  flushSync()
  expect(counted.shown[page]).toBe(true)
  expect(pageBox?.inert).toBe(false)
  expect(written()).toBe('')
  expect(counted.mounts).toBe(1)
})
test('a note switched to takes the keyboard from the note it hides, in the same turn', async () => {
  const { one, two, paneId } = opened()
  const first = await drawn(paneId)
  first.focus()
  expect(first.hasFocus).toBe(true)
  workspace.activate(two)
  flushSync()
  const second = views.of(paneId)!
  expect(second).not.toBe(first)
  expect(second.hasFocus).toBe(true)
  expect(document.activeElement).toBe(second.contentDOM)
  workspace.activate(one)
  flushSync()
  expect(first.hasFocus).toBe(true)
})
test('words being composed in a note stay in it when another note is switched to, and the next keys go there', async () => {
  const { two, paneId } = opened()
  const first = await drawn(paneId)
  first.focus()
  let ended = false
  first.contentDOM.addEventListener('blur', () => (ended = true))
  first.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { data: '' }))
  first.dispatch({ changes: { from: 0, insert: 'wor' } })
  workspace.activate(two)
  flushSync()
  const second = views.of(paneId)!
  expect(ended).toBe(true)
  expect(second.hasFocus).toBe(true)
  second.dispatch(second.state.replaceSelection('d'))
  expect(first.state.doc.toString()).toBe('worThe first note.')
  expect(second.state.doc.toString()).toBe('dThe second note.')
})
test('a note shown when the hidden one did not have the keyboard does not take it', async () => {
  const { two, paneId } = opened()
  await drawn(paneId)
  const outside = document.createElement('button')
  document.body.append(outside)
  outside.focus()
  workspace.activate(two)
  flushSync()
  expect(document.activeElement).toBe(outside)
  outside.remove()
})
test('a surface that fails as it is put behind still leaves the pane showing the tab in front', async () => {
  const { one, shell, paneId } = opened()
  await drawn(paneId)
  workspace.activate(shell)
  await vi.waitFor(() => {
    flushSync()
    expect(target.querySelector('.counted')).not.toBeNull()
  })
  const shellBox = target.querySelector('.counted')?.parentElement
  counted.throws = true
  workspace.activate(one)
  try {
    flushSync()
  } catch {
    flushSync()
  }
  expect(shellBox?.hidden).toBe(true)
  expect(written()).toBe('The first note.')
})
test('every kind of tab switched away from and back to keeps its surface, and the least recent past six goes', async () => {
  const { one, paneId } = opened()
  await drawn(paneId)
  const time = workspace.openUnsaved('time', '{}', 'Time tracker').id
  await vi.waitFor(() => {
    flushSync()
    expect(counted.shown[time]).toBe(true)
  })
  const box = target.querySelector('.counted')?.parentElement
  workspace.activate(one)
  flushSync()
  expect(counted.shown[time]).toBe(false)
  expect(box?.hidden).toBe(true)
  workspace.activate(time)
  flushSync()
  expect(counted.shown[time]).toBe(true)
  expect(target.querySelector('.counted')?.parentElement).toBe(box)
  expect(counted.mounts).toBe(1)
  for (let at = 0; at < 6; at += 1) {
    workspace.openBlank(`Other ${at}`, `Words ${at}.`)
    flushSync()
  }
  expect(target.querySelector('.counted')).toBeNull()
  workspace.activate(time)
  await vi.waitFor(() => {
    flushSync()
    expect(counted.shown[time]).toBe(true)
  })
  expect(counted.mounts).toBe(2)
})
test('a tab put behind stops its clock, and shown again ticks at once and on', async () => {
  const { one, shell, paneId } = opened()
  await drawn(paneId)
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  try {
    const before = vi.getTimerCount()
    workspace.activate(shell)
    await vi.waitFor(() => {
      flushSync()
      expect(target.querySelector('.counted')).not.toBeNull()
    })
    expect(vi.getTimerCount()).toBe(before + 1)
    workspace.activate(one)
    flushSync()
    const ticked = counted.ticks
    vi.advanceTimersByTime(5000)
    expect(counted.ticks).toBe(ticked)
    expect(vi.getTimerCount()).toBe(before)
    workspace.activate(shell)
    flushSync()
    vi.advanceTimersByTime(0)
    expect(counted.ticks).toBe(ticked + 1)
    vi.advanceTimersByTime(2000)
    expect(counted.ticks).toBe(ticked + 3)
  } finally {
    vi.useRealTimers()
  }
})
test('a note shown keeps its editor while settings it was dressed with change and the file list is read again', async () => {
  const { paneId } = opened()
  const first = await drawn(paneId)
  const { modes } = await import('../../modes/src/api')
  const was = modes.width
  modes.width = was + 4
  flushSync()
  await workspace.loadTree()
  flushSync()
  modes.width = was
  flushSync()
  expect(views.of(paneId)).toBe(first)
  expect(first.dom.isConnected).toBe(true)
  expect(vi.mocked(createEditor)).toHaveBeenCalledTimes(1)
})
test("a note the reader may only view is read-only from the editor's first frame, built or swapped in", async () => {
  guest.viewOnly = true
  const { two, paneId } = opened()
  await drawn(paneId)
  expect(vi.mocked(createEditor).mock.calls[0]?.[0]).toMatchObject({ readOnly: true })
  workspace.activate(two)
  flushSync()
  expect(vi.mocked(createEditor).mock.calls[1]?.[0]).toMatchObject({ readOnly: true })
})
