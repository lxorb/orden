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

const PLAN = '/space/Plan'
const PLAN_NOTE = '/space/Plan/Plan.md'
const STEP = '/space/Plan/Step.md'
const IDEAS = '/space/Ideas.md'

let list: ReturnType<typeof mount> | null = null

const rowOf = (path: string) => document.querySelector(`[data-path="${path}"]`)

async function click(path: string, opens: string) {
  await vi.waitFor(
    () => {
      flushSync()
      expect(rowOf(path)).not.toBeNull()
    },
    { timeout: 10_000 },
  )
  rowOf(path)!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await vi.waitFor(() => expect(workspace.active?.path).toBe(opens))
  flushSync()
}

beforeEach(async () => {
  HTMLElement.prototype.scrollIntoView = () => undefined
  const one = disk.current!
  one.reset()
  one.files.set(PLAN_NOTE, '# Plan\n')
  one.files.set(STEP, '# Step\n')
  one.files.set(IDEAS, '# Ideas\n')
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  const first = pane('first')
  workspace.panes.restore(first, first.id)
  workspace.activeSpaceId = 's'
  workspace.clearSelection()
  workspace.device.foldUnder('/space')
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

test('a note with subnotes clicked open shows its subnotes under it (#2078)', async () => {
  expect(rowOf(STEP)).toBeNull()

  await click(PLAN, PLAN_NOTE)

  expect(workspace.isExpanded(PLAN)).toBe(true)
  await vi.waitFor(
    () => {
      flushSync()
      expect(rowOf(STEP)).not.toBeNull()
    },
    { timeout: 10_000 },
  )
})

test('and clicked again it keeps them showing', async () => {
  await click(PLAN, PLAN_NOTE)
  await click(IDEAS, IDEAS)
  await click(PLAN, PLAN_NOTE)

  expect(workspace.isExpanded(PLAN)).toBe(true)
  await vi.waitFor(
    () => {
      flushSync()
      expect(rowOf(STEP)).not.toBeNull()
    },
    { timeout: 10_000 },
  )
})
