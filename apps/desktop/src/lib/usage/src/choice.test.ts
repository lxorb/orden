import { beforeEach, describe, expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')
beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', memoryStorage())
})
describe('helping improve Orden, across windows', () => {
  test('turned off in another window stops this one too', async () => {
    localStorage.setItem('orden:usage-help', 'true')
    const { usageChoice } = await import('./choice.svelte')
    let changed = 0
    usageChoice.changes.add(() => changed++)
    expect(usageChoice.helping).toBe(true)
    localStorage.setItem('orden:usage-help', 'false')
    usageChoice.heard()
    expect(usageChoice.helping).toBe(false)
    expect(changed).toBe(1)
  })
})
