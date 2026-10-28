import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The keyboard after a row of the file list is deleted from it (#523).
 *
 *  Shift+F10 on a row, Delete, Enter: the row went, and the keyboard with it, to the
 *  page's body - the engine does not say so when the element that had it goes - so the
 *  next key landed nowhere. A file list hands it on to the row that comes up into the
 *  deleted one's place. The real list on the real workspace, the disk a map; see
 *  test/disk.ts. */

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
  // Read through a getter, so the list follows the tree as a delete changes it.
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

/** The row with the keyboard deleted, as its menu's Delete does it. */
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
