import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
]

vi.mock('../../src/lib/platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/platform/src/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return Promise.resolve(SPACES)
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PLAN = '/spaces/Work/Plan.md'
const FOOD = '/spaces/Home/Food.md'

async function run() {
  const { workspace } = await import('../../src/lib/workspace.svelte')
  const onScreen = () =>
    workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))
  return { workspace, onScreen }
}

test('each space comes back with its own tabs', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(PLAN, '# Plan\n')
  disk.current.files.set(FOOD, '# Food\n')
  localStorage.clear()

  let first: unknown
  {
    const { workspace } = await run()
    first = workspace
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/spaces/Work' },
      { id: 'home', name: 'Home', root: '/spaces/Home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    await workspace.openEntry(FOOD)

    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)
    workspace.persist()
  }

  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace, onScreen } = await run()
  expect(workspace).not.toBe(first)
  await workspace.restore()
  flushSync()

  expect(workspace.activeSpaceId).toBe('work')
  expect(onScreen()).toEqual(['Plan.md'])

  const { tabSets } = await import('../../src/lib/workspace/spaces')
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true), { timeout: 15_000 })
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Food.md'), {
    timeout: 15_000,
  })
  expect(onScreen()).toEqual(['Plan.md'])

  await workspace.showSpace('home')
  expect(onScreen()).toEqual(['Food.md'])

  await workspace.showSpace('work')
  expect(onScreen()).toEqual(['Plan.md'])
})
