import { expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async () => undefined,
}))

vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./api')

test('the recent list is the notes in a space', () => {
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.device.remember('/downloads/Outside.md')
  workspace.device.remember('/space/One.md')
  expect(workspace.recent).toEqual(['/space/One.md'])
})
