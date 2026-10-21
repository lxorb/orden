import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** The set every Global space shared, on screen in a window an older build wrote, becomes
 *  the space on screen's own (#674). A file of its own, as space-tabs-shared.effect.test.ts
 *  says why. */

vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0))
vi.stubGlobal('requestIdleCallback', (run: () => void) => setTimeout(run, 0))

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

const SPACES = [
  { name: 'Work', path: '/spaces/Work' },
  { name: 'Home', path: '/spaces/Home' },
]

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
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

/** One run of the app's stores, freshly imported. */
async function run() {
  const { workspace } = await import('../../src/lib/workspace.svelte')
  const onScreen = () =>
    workspace.panes.all.flatMap((one) => workspace.tabsIn(one.id).map((tab) => tab.name))
  return { workspace, onScreen }
}

/** And where the shared set was the one on screen: it is the space's on screen now. */
test('the shared set on screen becomes the space on screen’s own', async () => {
  const { Disk } = await import('../disk')
  disk.current = new Disk()
  disk.current.files.set(PLAN, '# Plan\n')
  disk.current.files.set(FOOD, '# Food\n')
  localStorage.clear()

  {
    const { workspace } = await run()
    workspace.spaces = [
      { id: 'work', name: 'Work', root: '/spaces/Work' },
      { id: 'home', name: 'Home', root: '/spaces/Home' },
    ]
    workspace.activeSpaceId = 'work'
    await workspace.loadTree()
    await workspace.openEntry(PLAN)
    await workspace.showSpace('home')
    await workspace.openEntry(FOOD)
    workspace.persist()
  }

  const session = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
    sets: { on: string }
  }
  session.sets.on = 'global'
  localStorage.setItem('nib:workspace', JSON.stringify(session))
  localStorage.setItem('nib:space-tabs', JSON.stringify({ work: 'space' }))

  // What the first run fetched lazily - the sets' store, and what it fetches in turn - is
  // all in before the modules are dropped, or it lands in the second run's half-built ones.
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace, onScreen } = await run()
  await workspace.restore()
  flushSync()
  expect(workspace.activeSpaceId).toBe('home')
  expect(onScreen()).toEqual(['Food.md'])

  const { tabSets } = await import('../../src/lib/workspace/spaces')
  // The sets are fetched at the launch's last turn, which a loaded machine reaches late.
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true), { timeout: 15_000 })
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Plan.md'), {
    timeout: 15_000,
  })

  await workspace.showSpace('work')
  expect(onScreen()).toEqual(['Plan.md'])
  await workspace.showSpace('home')
  expect(onScreen()).toEqual(['Food.md'])
})
