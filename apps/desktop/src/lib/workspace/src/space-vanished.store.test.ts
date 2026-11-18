import { describe, expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../../../../test/disk').Disk | null }))

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
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

const { Disk, memoryStorage } = await import('../../../../test/disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const shown = (ws: {
  panes: { all: { id: string }[] }
  tabsIn(pane: string): { path: string | null }[]
}) => ws.panes.all.flatMap((one) => ws.tabsIn(one.id).map((tab) => tab.path))

const WORK = { id: 'work', name: 'Work', root: '/spaces/Work' }
const FOOD = { id: 'food', name: 'Food', root: '/spaces/Food' }

describe('the shown space going away in another window', () => {
  test('shows the space that takes its place with that space’s own tabs', async () => {
    const one = disk.current!
    one.folders.add(WORK.root).add(FOOD.root)
    one.files.set(`${WORK.root}/Plan.md`, '# Plan\n')
    one.files.set(`${FOOD.root}/Food.md`, '# Food\n')
    const { workspace } = await import('./workspace.svelte')
    workspace.spaces = [{ ...WORK }, { ...FOOD }]
    workspace.activeSpaceId = 'work'
    const { sets } = await import('./sets.svelte')
    await workspace.open(`${WORK.root}/Plan.md`)
    await workspace.selectSpace('food')
    await workspace.open(`${FOOD.root}/Food.md`)
    await workspace.selectSpace('work')
    expect(shown(workspace)).toEqual([`${WORK.root}/Plan.md`])

    one.folders.delete(WORK.root)
    one.files.delete(`${WORK.root}/Plan.md`)
    await workspace.loadSpaces()

    expect(workspace.activeSpaceId).toBe('food')
    expect(shown(workspace)).toEqual([`${FOOD.root}/Food.md`])
    expect(workspace.tabs.map((tab) => tab.path)).not.toContain(`${WORK.root}/Plan.md`)
    expect(sets.tabsOf('work')).toEqual([])
  })
})
