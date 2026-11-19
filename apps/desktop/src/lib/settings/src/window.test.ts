import { describe, expect, test, vi } from 'vitest'

vi.stubGlobal('localStorage', (await import('../../../../test/disk')).memoryStorage())

const { settings } = await import('./window.svelte')
const { workspace } = await import('../../workspace/src/api')

describe('the settings window', () => {
  test('comes back without the trouble it said the last time', () => {
    vi.spyOn(workspace, 'settingsTab', 'get').mockReturnValue({} as NonNullable<typeof workspace.settingsTab>)
    vi.spyOn(workspace, 'openSettings').mockImplementation(() => undefined)
    settings.error = 'that did not work'
    settings.show()
    expect(settings.error).toBeNull()
  })
})
