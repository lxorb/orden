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

const fetched = async () => (await import('./sets.svelte')).sets

beforeEach(() => {
  const one = disk.current
  if (!one) throw new Error('no disk')
  one.reset()
  one.folders.add(WORK.root).add(FOOD.root)
  one.files.set(`${WORK.root}/Plan.md`, '# Plan\n')
  one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
})

afterEach(() => vi.dynamicImportSettled())

describe('a tab that is one of its kind', () => {
  test('is one per space: Settings asked for in each space is a tab in each', async () => {
    const workspace = await window()
    const sets = await fetched()
    workspace.restored = true

    workspace.openSettings()
    const work = workspace.settingsTab
    await workspace.selectSpace('food')
    expect(workspace.settingsTab).toBeNull()
    workspace.openSettings()
    const food = workspace.settingsTab

    expect(food).not.toBeNull()
    expect(food?.id).not.toBe(work?.id)
    expect(workspace.activeSpaceId).toBe('food')
    expect(workspace.active?.id).toBe(food?.id)
    expect(sets.tabsOf('food').filter((one) => one.kind === 'settings')).toHaveLength(1)
    expect(workspace.tabs.filter((one) => one.kind === 'settings')).toHaveLength(2)
  })

  test('is still one within a space, however it is asked for', async () => {
    const workspace = await window()
    await fetched()
    workspace.restored = true

    workspace.openSettings()
    await workspace.selectSpace('food')
    workspace.openSettings()
    workspace.openSettings()
    workspace.openChat()
    workspace.openChat()
    await workspace.selectSpace('work')
    workspace.openSettings()
    workspace.openChat()

    expect(workspace.activeSpaceId).toBe('work')
    expect(workspace.active?.kind).toBe('chat')
    expect(workspace.tabs.filter((one) => one.kind === 'settings')).toHaveLength(2)
    expect(workspace.tabs.filter((one) => one.kind === 'chat')).toHaveLength(2)
  })
  test('moved into a space that has its own is let go there, not kept as a second', async () => {
    const workspace = await window()
    const sets = await fetched()
    workspace.restored = true

    workspace.openSettings()
    await workspace.selectSpace('food')
    workspace.openSettings()
    const food = workspace.settingsTab
    await workspace.selectSpace('work')
    const work = workspace.settingsTab
    if (!work) throw new Error('no Settings in work')

    await sets.adopt([work], 'food')

    expect(workspace.tabs.filter((one) => one.kind === 'settings').map((one) => one.id)).toEqual([
      food?.id,
    ])
  })
})
