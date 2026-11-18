import { beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  invoke: () => Promise.resolve(null),
}))

vi.stubGlobal('localStorage', memoryStorage())

const { modes } = await import('../../modes/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { sectionGroups } = await import('./sections')

const listed = () =>
  sectionGroups()
    .flat()
    .map((one) => one.id)

beforeEach(() => {
  viewport.device = 'desktop'
  modes.mobileSeen = false
})

describe('the Mobile section', () => {
  test('is not offered on a laptop whose account has never been on a phone', () => {
    expect(listed()).not.toContain('mobile')
    expect(listed()).toContain('shortcuts')
    expect(listed()).toContain('spelling')
  })

  test('is offered on a phone and on a tablet', () => {
    viewport.device = 'phone'
    expect(listed()).toContain('mobile')
    viewport.device = 'tablet'
    expect(listed()).toContain('mobile')
  })

  test('is offered on a laptop once the account has been on a phone', () => {
    modes.mobileSeen = true
    expect(listed()).toContain('mobile')
    expect(listed().indexOf('mobile')).toBe(listed().indexOf('shortcuts') + 1)
  })
})
