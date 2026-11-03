/** A space gone from a listing may be a drive not mounted or a folder renamed elsewhere,
 *  and nothing says it was deleted: the tabs of its set stay, unsaved words and running
 *  shells with them. The list changing used to close them, which only an effect can
 *  show. See `gone` in workspace/sets.svelte.ts and space-delete.store.test.ts. */

import { flushSync } from 'svelte'
import { expect, test, vi } from 'vitest'

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const { Disk, memoryStorage } = await import('../disk')
disk.current = new Disk()
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('../../src/lib/workspace.svelte')

test('a set out of sight stays when its space leaves the list', async () => {
  workspace.spaces = [
    { id: 'work', name: 'Work', root: '/spaces/Work' },
    { id: 'food', name: 'Food', root: '/spaces/Food' },
  ]
  workspace.activeSpaceId = 'work'
  // Fetched with a space on screen, which is the set it takes to be showing.
  await import('../../src/lib/workspace/sets.svelte')
  flushSync()
  workspace.openWebsite()
  await workspace.selectSpace('food')
  expect(workspace.tabs).toHaveLength(1)

  workspace.spaces = workspace.spaces.filter((one) => one.id !== 'work')
  flushSync()

  expect(workspace.tabs).toHaveLength(1)
})
