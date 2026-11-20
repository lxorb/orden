import { flushSync, mount, unmount } from 'svelte'
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
const { workspace } = await import('../../src/lib/workspace/src/api')
const { pane } = await import('../../src/lib/panes/src/api')
const Tree = (await import('../../src/lib/sidebar/src/Tree.svelte')).default
const ALPHA = '/space/Alpha.md'
const BETA = '/space/Beta.md'
const GAMMA = '/space/Gamma.md'
const BOX = '/space/Box'
let list: ReturnType<typeof mount> | null = null
const rowOf = (path: string) => document.querySelector<HTMLElement>(`[data-path="${path}"]`)
const focused = () => (document.activeElement as HTMLElement | null)?.dataset.path ?? null
beforeEach(async () => {
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  one.reset()
  for (const path of [ALPHA, BETA, GAMMA]) one.files.set(path, '# Note\n')
  one.files.set(`${BOX}/Inside.md`, '# Inside\n')
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
async function keyStillWorks() {
  const from = focused()
  expect(from).not.toBeNull()
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
  )
  flushSync()
  await vi.waitFor(() => expect(focused()).not.toBe(from))
  expect(document.activeElement).not.toBe(document.body)
}
test('a focused row moved into a folder leaves the keyboard on a row in the list, and the arrows go on from there', async () => {
  rowOf(BETA)!.focus()
  expect(focused()).toBe(BETA)
  await workspace.move(BETA, BOX)
  flushSync()
  await vi.waitFor(() => expect(rowOf(BETA)).toBeNull())
  flushSync()
  await vi.waitFor(() => expect(focused()).not.toBeNull())
  await keyStillWorks()
})
test('a focused row cut and pasted into a folder leaves the keyboard on a row in the list', async () => {
  rowOf(GAMMA)!.focus()
  await workspace.moveMany([GAMMA], BOX)
  flushSync()
  await vi.waitFor(() => expect(rowOf(GAMMA)).toBeNull())
  flushSync()
  await vi.waitFor(() => expect(focused()).not.toBeNull())
  await keyStillWorks()
})
test('a focused row renamed keeps the keyboard on that row under its new name', async () => {
  rowOf(BETA)!.focus()
  await workspace.rename(BETA, 'Zeta.md')
  flushSync()
  await vi.waitFor(() => expect(rowOf(BETA)).toBeNull())
  flushSync()
  await vi.waitFor(() => expect(focused()).toBe('/space/Zeta.md'))
  await keyStillWorks()
})
test('a focused row deleted from somewhere else hands the keyboard to the row now in its place', async () => {
  rowOf(BETA)!.focus()
  await workspace.removeMany([BETA])
  flushSync()
  await vi.waitFor(() => expect(rowOf(BETA)).toBeNull())
  flushSync()
  await vi.waitFor(() => expect(focused()).toBe(GAMMA))
  await keyStillWorks()
})
