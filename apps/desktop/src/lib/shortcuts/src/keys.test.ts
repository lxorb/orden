import { afterEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { shortcuts } = await import('./shortcuts.svelte')
const { viewport } = await import('../../ui-kit/src/api')
afterEach(() => {
  shortcuts.resetAll()
  vi.restoreAllMocks()
})
describe('the keys a button shows inside it', () => {
  test('are the ones the list holds for it, as this system writes them', () => {
    expect(shortcuts.keys('ai.approve')).toBe(shortcuts.hint('ai.approve'))
    expect(shortcuts.keys('ai.deny')).toBe(shortcuts.hint('ai.deny'))
    expect(shortcuts.keys('ai.approve')).toBeTruthy()
  })
  test('follow a key the reader chose, and go when the reader takes it away', () => {
    shortcuts.set('ai.approve', 'Mod-Alt-j')
    expect(shortcuts.keys('ai.approve')).toBe(shortcuts.hint('ai.approve'))
    shortcuts.set('ai.approve', null)
    expect(shortcuts.keys('ai.approve')).toBeUndefined()
  })
  test('are none for a row the list does not know', () => {
    expect(shortcuts.keys('no.such.row')).toBeUndefined()
  })
  test('are none on a touch screen', () => {
    vi.spyOn(viewport, 'touch', 'get').mockReturnValue(true)
    expect(shortcuts.keys('ai.approve')).toBeUndefined()
  })
})
describe('the keys that answer the AI', () => {
  test('stay off every other key the AI panel answers to', () => {
    for (const id of ['ai.approve', 'ai.deny']) {
      expect(shortcuts.conflicts(id, shortcuts.keyFor(id) ?? ''), id).toEqual([])
    }
  })
})
