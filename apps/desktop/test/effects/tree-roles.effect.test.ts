import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The file list, as a screen reader hears it (#523).
 *
 *  It was a flat list of buttons, so "Ledger" inside "Field notes" was announced at the
 *  same level as "Field notes" itself. It is a tree now: each row a treeitem with its
 *  level, its place among the notes beside it, whether it is open, and whether it is
 *  picked. The real list on the real workspace, the disk a map; see test/disk.ts. */

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

const FIELD = '/space/Field notes'
const LEDGER = '/space/Field notes/Ledger.md'
const ATLAS = '/space/Field notes/Atlas.md'
const PLAN = '/space/Plan.md'

let list: ReturnType<typeof mount> | null = null

const rowOf = (path: string) => document.querySelector<HTMLElement>(`[data-path="${path}"]`)
const said = (path: string, name: string) => rowOf(path)?.getAttribute(name) ?? null

beforeEach(async () => {
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  one.reset()
  one.files.set(`${FIELD}/Field notes.md`, '# Field notes\n')
  one.files.set(LEDGER, '# Ledger\n')
  one.files.set(ATLAS, '# Atlas\n')
  one.files.set(PLAN, '# Plan\n')
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

test('the list is a tree, and every row in it a treeitem', () => {
  const tree = document.querySelector('[role="tree"]')
  expect(tree?.getAttribute('aria-label')).toBe('Files')
  expect(tree?.getAttribute('aria-multiselectable')).toBe('true')
  expect(said(PLAN, 'role')).toBe('treeitem')
  expect(said(FIELD, 'role')).toBe('treeitem')
  // What holds a row says nothing of its own, so the treeitems are the tree's own.
  for (const holder of document.querySelectorAll('[data-row]')) {
    expect(holder.getAttribute('role')).toBe('none')
  }
})

test('a note inside another is one level deeper, and counted among its own', async () => {
  if (!workspace.isExpanded(FIELD)) workspace.toggleFolder(FIELD)
  flushSync()
  // The rows a twist discloses slide in.
  await vi.waitFor(() => expect(rowOf(LEDGER)).not.toBeNull(), { timeout: 10_000 })

  expect(said(FIELD, 'aria-level')).toBe('1')
  expect(said(FIELD, 'aria-expanded')).toBe('true')
  expect(said(LEDGER, 'aria-level')).toBe('2')
  expect(said(ATLAS, 'aria-level')).toBe('2')

  // Two in the folder, two at the top.
  expect([said(ATLAS, 'aria-posinset'), said(ATLAS, 'aria-setsize')]).toEqual(['1', '2'])
  expect([said(LEDGER, 'aria-posinset'), said(LEDGER, 'aria-setsize')]).toEqual(['2', '2'])
  expect([said(FIELD, 'aria-posinset'), said(FIELD, 'aria-setsize')]).toEqual(['1', '2'])
  expect([said(PLAN, 'aria-posinset'), said(PLAN, 'aria-setsize')]).toEqual(['2', '2'])
})

test('a folder shut says so, and a row picked says it is selected', () => {
  if (workspace.isExpanded(FIELD)) workspace.toggleFolder(FIELD)
  flushSync()
  expect(said(FIELD, 'aria-expanded')).toBe('false')
  expect(said(PLAN, 'aria-expanded')).toBeNull()

  expect(said(PLAN, 'aria-selected')).toBe('false')
  workspace.select(PLAN)
  flushSync()
  expect(said(PLAN, 'aria-selected')).toBe('true')
})
