import { describe, expect, test } from 'vitest'
import { READER } from '../../automation/src/api'
import { count } from './call'

function asked(args: Record<string, unknown>) {
  return { verb: 'list_tasks', args, caller: READER }
}

describe('a count an agent sends', () => {
  test('left out or null is the fallback', () => {
    expect(count(asked({}), 'limit', 50, 500)).toBe(50)
    expect(count(asked({ limit: null }), 'limit', 50, 500)).toBe(50)
  })

  test('is a whole number between one and the most', () => {
    expect(count(asked({ limit: 0 }), 'limit', 50, 500)).toBe(1)
    expect(count(asked({ limit: 7.9 }), 'limit', 50, 500)).toBe(7)
    expect(count(asked({ limit: 9000 }), 'limit', 50, 500)).toBe(500)
    expect(count(asked({ limit: '12' }), 'limit', 50, 500)).toBe(12)
  })
})
