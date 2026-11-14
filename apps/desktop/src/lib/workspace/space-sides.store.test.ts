import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../test/disk').Disk | null }))

vi.mock('../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/src/tauri')>()),
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

async function window(setsRead?: unknown) {
  await vi.dynamicImportSettled()
  vi.resetModules()
  const { workspace } = await import('../workspace.svelte')
  workspace.spaces = [{ ...WORK }, { ...FOOD }]
  workspace.activeSpaceId = 'work'
  workspace.setsRead = setsRead
  workspace.right = ['outline', 'links']
  workspace.panel = null
  workspace.rightPanel = null
  return workspace
}

type Workspace = Awaited<ReturnType<typeof window>>

const fetched = async () => (await import('./sets.svelte')).sets

async function bothOpen(workspace: Workspace) {
  await fetched()
  await workspace.open(`${WORK.root}/Plan.md`)
  await workspace.selectSpace('food')
  await workspace.open(`${FOOD.root}/Food.md`)
  await workspace.selectSpace('work')
}

const sides = (workspace: Workspace) => [workspace.panel, workspace.rightPanel]

beforeEach(() => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folders.add(WORK.root).add(FOOD.root)
  one.files.set(`${WORK.root}/Plan.md`, '# Plan\n')
  one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
})

afterEach(() => vi.dynamicImportSettled())

describe('a switch between two spaces with tabs of their own', () => {
  test('leaves the left side shut where it was shut in the other space', async () => {
    const workspace = await window()
    await bothOpen(workspace)

    workspace.panel = 'tree'
    await workspace.selectSpace('food')
    workspace.panel = null
    await workspace.selectSpace('work')

    expect(workspace.panel).toBeNull()
  })

  test('leaves the left side on the panel chosen in the other space', async () => {
    const workspace = await window()
    await bothOpen(workspace)

    await workspace.selectSpace('food')
    workspace.panel = 'search'
    await workspace.selectSpace('work')
    expect(workspace.panel).toBe('search')

    workspace.panel = 'tree'
    await workspace.selectSpace('food')
    expect(workspace.panel).toBe('tree')
  })

  test('leaves the right side open on its panel, and shut where it was shut', async () => {
    const workspace = await window()
    await bothOpen(workspace)

    workspace.rightPanel = 'links'
    await workspace.selectSpace('food')
    expect(workspace.rightPanel).toBe('links')

    workspace.rightPanel = null
    await workspace.selectSpace('work')
    expect(workspace.rightPanel).toBeNull()

    workspace.rightPanel = 'outline'
    await workspace.selectSpace('food')
    expect(workspace.rightPanel).toBe('outline')
  })

  test('to a space that has never had a set leaves both sides as they are', async () => {
    const workspace = await window()
    await fetched()
    await workspace.open(`${WORK.root}/Plan.md`)

    workspace.panel = 'tree'
    workspace.rightPanel = 'links'
    await workspace.selectSpace('food')

    expect(sides(workspace)).toEqual(['tree', 'links'])
  })

  test('to a space a tab was moved into leaves the sides as they are', async () => {
    const workspace = await window()
    await fetched()
    await workspace.open(`${WORK.root}/Plan.md`)
    workspace.openWebsite()
    const sets = await fetched()
    const web = workspace.tabs.find((one) => one.kind === 'web')
    if (!web) throw new Error('no web tab')
    await sets.adopt([web], 'food')

    await workspace.selectSpace('food')

    expect(sides(workspace)).toEqual([null, null])
  })
})

describe('the switcher', () => {
  test('opens no shut side, with no tabs open', async () => {
    const workspace = await window()

    await workspace.showSpace('food')

    expect(workspace.activeSpaceId).toBe('food')
    expect(sides(workspace)).toEqual([null, null])
  })

  test('opens no shut side, with tabs of their own in both spaces', async () => {
    const workspace = await window()
    await bothOpen(workspace)

    await workspace.showSpace('food')
    await workspace.showSpace('work')

    expect(workspace.activeSpaceId).toBe('work')
    expect(sides(workspace)).toEqual([null, null])
  })

  test('leaves an open side on its panel', async () => {
    const workspace = await window()
    await bothOpen(workspace)
    workspace.panel = 'search'
    workspace.rightPanel = 'outline'

    await workspace.showSpace('food')

    expect(sides(workspace)).toEqual(['search', 'outline'])
  })
})

describe('a session with a side for every space, as older builds wrote it', () => {
  async function older() {
    const before = await window()
    await bothOpen(before)
    const written = JSON.parse(JSON.stringify(before.setsWritten())) as {
      on: string
      aside: Record<string, { layout: { panel: unknown }; right: unknown }>
    }
    const food = written.aside.food
    if (!food) throw new Error('no set for Food')
    food.layout.panel = 'search'
    food.right = 'links'
    return written
  }

  test('comes back with the sides the window had on screen, in every space', async () => {
    const written = await older()

    const after = await window(written)
    await (await fetched()).wake()
    await after.selectSpace('food')

    expect(after.tabs.map((one) => one.path)).toContain(`${FOOD.root}/Food.md`)
    expect(sides(after)).toEqual([null, null])
  })

  test('is written again with the window’s sides for every set', async () => {
    const workspace = await window()
    await bothOpen(workspace)
    workspace.panel = 'search'
    workspace.rightPanel = 'links'

    const written = workspace.setsWritten() as
      { aside: Record<string, { layout: { panel: unknown }; right: unknown }> } | undefined

    expect(written?.aside.food?.layout.panel).toBe('search')
    expect(written?.aside.food?.right).toBe('links')
  })
})
