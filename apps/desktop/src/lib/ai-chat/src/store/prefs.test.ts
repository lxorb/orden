import { expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

test('a task done with AI works in Auto until another mode is picked, which a launch keeps', async () => {
  expect((await import('./prefs')).taskMode()).toBe('auto')
  ;(await import('./prefs')).rememberTaskMode('approve')
  vi.resetModules()
  expect((await import('./prefs')).taskMode()).toBe('approve')
})

test('the model and effort picked on an account the vault moved stay with it, not with its old id', async () => {
  const prefs = await import('./prefs')
  prefs.rememberModel('compatible-1', 'llama3.2')
  prefs.rememberEffort('compatible-1', 'llama3.2', 'high')
  const { keepMoves } = await import('../../../ai-providers/src/api')
  keepMoves({ 'compatible-1': 'compatible-2' })
  prefs.rememberModel('compatible-1', 'openai/gpt-5')

  const moved = { id: 'compatible-2', kind: 'compatible', name: '', model: '' } as const
  expect(prefs.modelFor(moved)).toBe('llama3.2')
  expect(prefs.effortFor('compatible-2', 'llama3.2')).toBe('high')
  expect(prefs.effortFor('compatible-1', 'llama3.2')).toBe('auto')
  vi.resetModules()
  const again = await import('./prefs')
  expect(again.modelFor(moved)).toBe('llama3.2')
  expect(again.modelFor({ ...moved, id: 'compatible-1' })).toBe('openai/gpt-5')
})
