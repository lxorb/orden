import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

/** The set every Global space shared, from a window an older build wrote, given to a space
 *  once every space keeps its own tabs (#674). A file of its own, since each case is a run
 *  of the store and a relaunch reading what it wrote; see space-tabs-restart.effect.test.ts. */

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

/** A window an older build wrote, when a space chose: Global, sharing one set, or its own
 *  (#674). The shared set becomes a space's own, once, and no tab is lost: here it was out
 *  of sight under `global`, and goes to Home, which shared it. */
test('the set every Global space shared becomes the first such space’s own', async () => {
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
    workspace.activeSpaceId = 'home'
    await workspace.loadTree()
    await workspace.openEntry(FOOD)
    await workspace.showSpace('work')
    await workspace.openEntry(PLAN)
    workspace.persist()
  }

  // What the older build wrote: Home's set kept as the shared one, Work its own.
  const session = JSON.parse(localStorage.getItem('nib:workspace') ?? '{}') as {
    sets: { on: string; aside: Record<string, unknown> }
  }
  session.sets.aside = { global: session.sets.aside.home }
  localStorage.setItem('nib:workspace', JSON.stringify(session))
  localStorage.setItem('nib:space-tabs', JSON.stringify({ work: 'space' }))

  // What the first run fetched lazily - the sets' store, and what it fetches in turn - is
  // all in before the modules are dropped, or it lands in the second run's half-built ones.
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace, onScreen } = await run()
  await workspace.restore()
  flushSync()
  expect(onScreen()).toEqual(['Plan.md'])

  const { tabSets } = await import('../../src/lib/workspace/spaces')
  // The sets are fetched at the launch's last turn, which a loaded machine reaches late.
  await vi.waitFor(() => expect(tabSets.fetched).toBe(true), { timeout: 15_000 })
  await vi.waitFor(() => expect(workspace.tabs.map((tab) => tab.name)).toContain('Food.md'), {
    timeout: 15_000,
  })

  await workspace.showSpace('home')
  expect(onScreen()).toEqual(['Food.md'])
  expect(localStorage.getItem('nib:space-tabs')).toBeNull()
})
