import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The grey a click leaves on a row of the file list, and when it goes (#420).
 *
 *  A plain click picks the row and opens its note. A note opened any other way - a
 *  tab, a link, the palette - left that row grey beside the one now open, so the list
 *  said two notes were chosen when one was. The real list on the real workspace, the
 *  disk a map; see test/disk.ts. */

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

const PLAN = '/space/Plan.md'
const IDEAS = '/space/Ideas.md'

let list: ReturnType<typeof mount> | null = null

const rowOf = (path: string) => document.querySelector(`[data-path="${path}"]`)!

/** The rows wearing the grey, by path. */
const picked = () =>
  [...document.querySelectorAll<HTMLElement>('.row.is-picked')].map((row) => row.dataset.path)

/** A plain click on a row, and the note it opens open. */
async function click(path: string, held: MouseEventInit = {}) {
  rowOf(path).dispatchEvent(new MouseEvent('click', { bubbles: true, ...held }))
  if (!held.shiftKey) await vi.waitFor(() => expect(workspace.active?.path).toBe(path))
  flushSync()
}

beforeEach(async () => {
  // A note opened is scrolled to, and jsdom lays nothing out to scroll.
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  one.reset()
  one.files.set(PLAN, '# Plan\n')
  one.files.set(IDEAS, '# Ideas\n')
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  workspace.activeSpaceId = 's'
  workspace.clearSelection()
  await workspace.loadTree()
  list = mount(Tree, { target: document.body, props: { tree: workspace.tree! } })
  flushSync()
})

afterEach(() => {
  if (list) void unmount(list)
  list = null
})

test('a row clicked open is picked, and another note opened leaves only that one lit', async () => {
  await click(PLAN)
  expect(picked()).toEqual([PLAN])

  await workspace.openEntry(IDEAS)
  flushSync()

  expect(picked()).toEqual([])
  expect(rowOf(IDEAS).classList.contains('is-on')).toBe(true)
})

test('and a selection that holds the note opened stays as it was', async () => {
  await click(PLAN)
  await click(IDEAS, { shiftKey: true })
  expect(picked()).toEqual([IDEAS, PLAN])

  await workspace.openEntry(IDEAS)
  flushSync()

  expect(picked()).toEqual([IDEAS, PLAN])
})
