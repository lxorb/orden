import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())
const { workspace } = await import('../../workspace/src/api')
const { appCommands } = await import('./api')
describe('the palette’s commands', () => {
  test('name each thing once, with a space open as without', () => {
    for (const open of [false, true]) {
      workspace.spaces = open ? [{ id: 's', name: 'Space', root: '/space' }] : []
      workspace.activeSpaceId = open ? 's' : null
      const labels = appCommands().map((one) => one.label)
      const twice = labels.filter((one, at) => labels.indexOf(one) !== at)
      expect(twice, open ? 'with a space' : 'without').toEqual([])
    }
  })
})
