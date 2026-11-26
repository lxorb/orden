import { describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())
const { BY_ID, offeredHere } = await import('./registry')
const { todosOn } = await import('../../gates/src/api')
describe('Add task', () => {
  test('is offered only where the app has todos', () => {
    for (const id of ['app.quick-add', 'tasks.quick-add']) {
      const entry = BY_ID.get(id)
      expect(entry?.shown, id).toBeTypeOf('function')
      expect(entry?.shown?.(), id).toBe(todosOn())
      expect(entry && offeredHere(entry), id).toBe(todosOn())
    }
  })
})
