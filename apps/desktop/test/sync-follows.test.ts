import { expect, test, vi } from 'vitest'
import { memoryStorage } from './disk'

vi.stubGlobal('localStorage', memoryStorage())
test('the sync store and its record follow the file ops of a workspace that was loaded first', async () => {
  const { workspace } = await import('../src/lib/workspace/src/workspace.svelte')
  const { sync } = await import('../src/lib/sync-store/src/api')
  const { record } = await import('../src/lib/sync-mirror/src/api')
  const synced = vi.spyOn(sync, 'follow').mockReturnValue(undefined)
  const recorded = vi.spyOn(record, 'follow').mockReturnValue(undefined)
  const op = { op: 'moved', from: '/s/A.md', to: '/s/B.md', kind: 'file', root: '/s' } as const
  await workspace.fileOps.tell(op)
  await workspace.fileOps.tell({ ...op, heard: true })
  expect(synced.mock.calls).toEqual([[op]])
  expect(recorded.mock.calls).toEqual([[op]])
})
