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

test('a set comes back on the tab it was left on when one before it has gone', async () => {
  const IDEAS = '/spaces/Work/Ideas.md'
  const NOTES = '/spaces/Work/Notes.md'
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  for (const path of [PLAN, IDEAS, NOTES, FOOD]) disk.current.files.set(path, '# Words\n')
  localStorage.clear()

  {
    const { workspace } = await run()
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/spaces/Work' },
      { id: 'home', name: 'Home', root: '/spaces/Home' },
    ]
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    await workspace.showSpace('work')
    for (const path of [PLAN, IDEAS, NOTES]) await workspace.openEntry(path)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.persist()
  }

  disk.current.files.delete(IDEAS)
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace, onScreen } = await run()
  await workspace.restore()
  const { tabSets } = await import('../../src/lib/workspace/spaces')
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true), { timeout: 15_000 })
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Notes.md'), {
    timeout: 15_000,
  })

  await workspace.showSpace('work')
  expect(onScreen()).toEqual(['Plan.md', 'Notes.md'])
  expect(workspace.active?.path).toBe(NOTES)
})
