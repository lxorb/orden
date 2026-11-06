import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk } = await import('../disk')
disk.current = new Disk()

const { workspace } = await import('../../src/lib/workspace.svelte')
const { pane } = await import('../../src/lib/workspace/pane-tree')
const Tree = (await import('../../src/lib/Tree.svelte')).default
const { keyboardStays } = await import('../../src/lib/caret')

const ALPHA = '/space/Alpha.md'
const BETA = '/space/Beta.md'
const GAMMA = '/space/Gamma.md'

let list: ReturnType<typeof mount> | null = null

const rowOf = (path: string) => document.querySelector<HTMLElement>(`[data-path="${path}"]`)
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.path ?? null

beforeEach(async () => {
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  one.reset()
  for (const path of [ALPHA, BETA, GAMMA]) one.files.set(path, '# Note\n')
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  workspace.activeSpaceId = 's'
  workspace.clearSelection()
  await workspace.loadTree()
  list = mount(Tree, {
    target: document.body,
    props: {
      get tree() {
        return workspace.tree!
      },
    },
  })
  flushSync()
})

afterEach(() => {
  if (list) void unmount(list)
  list = null
})

async function deleteRow(path: string) {
  await workspace.remove(path, false)
  flushSync()
  await vi.waitFor(() => expect(rowOf(path)).toBeNull())
  flushSync()
}

test('a row deleted under the keyboard hands it on to the row that comes up into its place', async () => {
  rowOf(BETA)!.focus()
  expect(focused()).toBe(BETA)

  await deleteRow(BETA)

  await vi.waitFor(() => expect(focused()).toBe(GAMMA))
})

test('the row a menu asked for with Shift+F10 deleted is the same, though the menu took the keyboard', async () => {
  rowOf(BETA)!.focus()
  rowOf(BETA)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
  )
  const inMenu = document.body.appendChild(document.createElement('button'))
  inMenu.focus()
  inMenu.remove()

  await deleteRow(BETA)

  await vi.waitFor(() => expect(focused()).toBe(GAMMA))
})

test('and the note that comes to the front does not take the keyboard from the row', async () => {
  rowOf(BETA)!.focus()
  rowOf(BETA)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
  )
  const caret = document.body.appendChild(document.createElement('div'))
  caret.tabIndex = 0
  caret.focus()

  await deleteRow(BETA)

  await vi.waitFor(() => expect(focused()).toBe(GAMMA))
  expect(keyboardStays()).toBe(true)
})

test('a menu long closed, and something done since, leaves the keyboard where it went', async () => {
  rowOf(BETA)!.focus()
  rowOf(BETA)!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }),
  )
  const elsewhere = document.body.appendChild(document.createElement('input'))
  elsewhere.focus()
  elsewhere.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))

  await deleteRow(BETA)
  flushSync()

  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})

test('the only row left, gone, hands it to the list itself rather than to the page', async () => {
  await deleteRow(ALPHA)
  await deleteRow(GAMMA)
  rowOf(BETA)!.focus()

  await deleteRow(BETA)

  await vi.waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('tree'))
})

test('and the last row hands it back to the row that is last now', async () => {
  rowOf(GAMMA)!.focus()

  await deleteRow(GAMMA)

  await vi.waitFor(() => expect(focused()).toBe(BETA))
})

test('a keyboard that has gone somewhere else since stays where it went', async () => {
  rowOf(BETA)!.focus()
  const elsewhere = document.body.appendChild(document.createElement('input'))
  elsewhere.focus()

  await deleteRow(BETA)

  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})
