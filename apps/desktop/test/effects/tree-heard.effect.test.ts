import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
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
const ZETA = '/space/Zeta.md'

let list: ReturnType<typeof mount> | null = null

const rowOf = (path: string) => document.querySelector<HTMLElement>(`[data-path="${path}"]`)
const picked = () =>
  [...document.querySelectorAll<HTMLElement>('.row.is-picked')].map((row) => row.dataset.path)
const order = () =>
  [...document.querySelectorAll<HTMLElement>('.row[data-path]')].map((row) => row.dataset.path)

async function heardMove(from: string, to: string) {
  await disk.current!.invoke('rename_note', { from, to })
  await workspace.fileMoved(from, to, 'file')
  workspace.heardMove(from, to)
  flushSync()
  await tick()
}

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

test('a row renamed on another device is the same row, with the keyboard and the pick on it', async () => {
  const row = rowOf(BETA)!
  workspace.select(BETA)
  row.focus()
  flushSync()

  await heardMove(BETA, ZETA)

  expect(order()).toEqual([ALPHA, GAMMA, ZETA])
  expect(rowOf(ZETA)).toBe(row)
  expect(document.activeElement).toBe(row)
  expect(picked()).toEqual([ZETA])

  await workspace.loadTree()
  flushSync()
  await tick()
  expect(rowOf(ZETA)).toBe(row)
  expect(document.activeElement).toBe(row)
  expect(picked()).toEqual([ZETA])
})

test('the note being read, renamed elsewhere, stays picked where it went', async () => {
  rowOf(BETA)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await vi.waitFor(() => expect(workspace.active?.path).toBe(BETA))
  flushSync()
  expect(picked()).toEqual([BETA])

  await heardMove(BETA, ZETA)
  await workspace.loadTree()
  flushSync()

  expect(workspace.active?.path).toBe(ZETA)
  expect(picked()).toEqual([ZETA])
  expect(rowOf(ZETA)?.classList.contains('is-on')).toBe(true)
})

test('a row another device deleted leaves the list at once, and the keyboard on its own row', async () => {
  const row = rowOf(GAMMA)!
  row.focus()
  flushSync()

  disk.current!.files.delete(ALPHA)
  await workspace.fileGone(ALPHA, 'file')
  workspace.heardGone(ALPHA)
  flushSync()
  await tick()

  expect(order()).toEqual([BETA, GAMMA])
  expect(document.activeElement).toBe(row)
})
