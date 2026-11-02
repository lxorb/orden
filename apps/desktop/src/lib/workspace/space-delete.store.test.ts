import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** A space deleted takes its set of tabs with it, whichever tabs and whichever way it
 *  went (#786). The space on screen was the gap: its set was still the one showing while
 *  the list of spaces changed, so `gone` passed over it, and the switch away then put it
 *  aside under a key no space has. A web tab or a terminal, which no file-ops closes, went
 *  on running with nowhere to show, and came back the same after a restart.
 *
 *  Every test starts the store afresh, since sets.svelte.ts reads the window it finds as
 *  it is first fetched. The disk is a map; see test/disk.ts. */

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    if (command === 'list_spaces') {
      return Promise.resolve(
        [...disk.current.folders]
          .filter((path) => /^\/spaces\/[^/]+$/.test(path))
          .map((path) => ({ name: path.split('/').pop(), path })),
      )
    }
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const WORK = { id: 'work', name: 'Work', root: '/spaces/Work' }
const FOOD = { id: 'food', name: 'Food', root: '/spaces/Food' }

/** A window as a launch leaves it, with these spaces and this one on screen. */
async function window(spaces: (typeof WORK)[], active: string | null, setsRead?: unknown) {
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace } = await import('../workspace.svelte')
  workspace.spaces = spaces.map((one) => ({ ...one }))
  workspace.activeSpaceId = active
  workspace.setsRead = setsRead
  return workspace
}

const fetched = async () => (await import('./sets.svelte')).sets

const names = (tabs: readonly { kind: string; path: string | null }[]) =>
  tabs.map((one) => one.path ?? one.kind).sort()

beforeEach(() => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folders.add(WORK.root).add(FOOD.root)
  one.files.set(`${WORK.root}/Plan.md`, '# Plan\n')
  one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
})

afterEach(() => vi.dynamicImportSettled())

describe('the space on screen deleted', () => {
  test('closes its tabs that are no file, and the next space’s stay', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    await workspace.selectSpace('food')
    await workspace.open(`${FOOD.root}/Food.md`)
    await workspace.selectSpace('work')
    await workspace.open(`${WORK.root}/Plan.md`)
    workspace.openWebsite()
    expect(names(workspace.tabs)).toEqual([`${FOOD.root}/Food.md`, `${WORK.root}/Plan.md`, 'web'])

    await workspace.deleteSpace('work')

    expect(workspace.activeSpaceId).toBe('food')
    expect(names(workspace.tabs)).toEqual([`${FOOD.root}/Food.md`])
  })

  test('closes them too where it is the first thing to fetch the sets', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    workspace.openWebsite()
    expect(names(workspace.tabs)).toEqual(['web'])

    await workspace.deleteSpace('work')

    expect(workspace.activeSpaceId).toBe('food')
    expect(names(workspace.tabs)).toEqual([])
  })

  test('leaves nothing for the next launch', async () => {
    const workspace = await window([WORK, FOOD], 'work')
    await fetched()
    workspace.openWebsite()

    await workspace.deleteSpace('work')

    expect(Object.keys((workspace.setsWritten() as { aside: object }).aside)).toEqual([])
  })
})

test('a space that left on its own is closed at the switch away from it', async () => {
  const workspace = await window([WORK, FOOD], 'work')
  await fetched()
  workspace.openWebsite()

  workspace.spaces = workspace.spaces.filter((one) => one.id !== 'work')
  await workspace.selectSpace('food')

  expect(workspace.tabs).toEqual([])
})

test('a session that kept the set of a space already gone lets it go at the launch', async () => {
  // Written by the builds this was wrong in: the tabs are put aside under `work`.
  const before = await window([WORK, FOOD], 'work')
  await fetched()
  before.openWebsite()
  await before.selectSpace('food')
  const written: unknown = JSON.parse(JSON.stringify(before.setsWritten()))
  expect(Object.keys((written as { aside: object }).aside)).toEqual(['work'])

  const after = await window([FOOD], 'food', written)
  await (await fetched()).wake()

  expect(after.tabs).toEqual([])
  expect(Object.keys((after.setsWritten() as { aside: object }).aside)).toEqual([])
})

test('a space that is still there keeps its set through a launch', async () => {
  const before = await window([WORK, FOOD], 'work')
  await fetched()
  before.openWebsite()
  await before.selectSpace('food')
  const written: unknown = JSON.parse(JSON.stringify(before.setsWritten()))

  const after = await window([WORK, FOOD], 'food', written)
  await (await fetched()).wake()

  expect(names(after.tabs)).toEqual(['web'])
})

describe('the set older builds shared, in a window with no space to give it to', () => {
  /** A session holding that set: its tabs one web tab, drafted under `global`. */
  async function sharedSet(on: string) {
    const before = await window([WORK], 'work')
    const sets = await fetched()
    before.openWebsite()
    await sets.toSpace('food', false)
    const { aside } = JSON.parse(JSON.stringify(before.setsWritten())) as {
      aside: Record<string, unknown>
    }
    return { on, aside: { global: aside.work } }
  }

  test('comes on screen at that launch, none of it lost', async () => {
    const written = await sharedSet('work')

    const after = await window([], null, written)
    await (await fetched()).wake()

    expect(names(after.tabs)).toEqual(['web'])
    expect(after.tabs.every((tab) => after.panes.at(tab.paneId))).toBe(true)
  })

  test('kept for the next launch, where the window itself shows the shared set', async () => {
    // No build writes this: a set on screen is never also aside. Not lost if one did.
    const written = await sharedSet('global')

    const after = await window([], null, written)
    await (await fetched()).wake()

    expect(Object.keys((after.setsWritten() as { aside: object }).aside)).toEqual(['global'])
  })
})
