import { beforeEach, expect, test, vi } from 'vitest'
import { providePort } from '@orden/contracts'

const held = vi.hoisted(() => ({ disk: null as import('../../../../test/disk').Disk | null }))
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'list_spaces') return [{ name: 'Team', path: '/spaces/Team' }]
    return held.disk?.invoke(command, args)
  },
}))
const { Disk, memoryStorage } = await import('../../../../test/disk')
held.disk = new Disk()
vi.stubGlobal('localStorage', memoryStorage())
const { workspace } = await import('./workspace.svelte')
const PATH = '/spaces/Team/Plan.md'
const ITEM = { id: 'shared-plan', name: 'Plan', path: '/Plan.md' }
providePort('sync.store', { idOf: (path: string) => (path === PATH ? ITEM.id : null) } as never)
const plans = () => workspace.tabs.filter((one) => one.note.shared === ITEM.id || one.path === PATH)
beforeEach(async () => {
  held.disk!.reset()
  held.disk!.folders.add('/spaces/Team')
  held.disk!.files.set(PATH, '# Plan\n\nwords\n')
  for (const tab of [...workspace.tabs]) workspace.close(tab.id, false)
  workspace.spaces = [{ id: 'team', name: 'Team', root: '/spaces/Team' }]
  workspace.activeSpaceId = 'team'
  await workspace.loadTree()
})
test('a note opened from its link as a guest, then by its path as a member, is one tab on the path', async () => {
  workspace.openShared(ITEM, '# Plan\n\nwords\n')
  plans()[0]?.note.live.replace('# Plan\n\nwords\n\nmore from the guest\n')
  await workspace.openEntry(PATH)
  expect(plans()).toHaveLength(1)
  expect(plans()[0]?.path).toBe(PATH)
  expect(workspace.active?.path).toBe(PATH)
})
test('and the other way round, opened by its path first, its link shows that same tab', async () => {
  await workspace.openEntry(PATH)
  workspace.openShared(ITEM, '# Plan\n\nwords\n')
  expect(plans()).toHaveLength(1)
  expect(plans()[0]?.path).toBe(PATH)
})
