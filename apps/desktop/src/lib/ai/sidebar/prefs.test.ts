import { expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

test('a task done with AI works in Auto until another mode is picked, which a launch keeps', async () => {
  expect((await import('./prefs')).taskMode()).toBe('auto')
  ;(await import('./prefs')).rememberTaskMode('approve')
  vi.resetModules()
  expect((await import('./prefs')).taskMode()).toBe('approve')
})
