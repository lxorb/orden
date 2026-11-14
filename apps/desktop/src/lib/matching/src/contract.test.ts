import { describe, expect, test } from 'vitest'
import { fuzzyFolded, MOST_PLACES, pieces, ranked } from './api'

describe('matching', () => {
  test('finds letters in order and nothing out of order', () => {
    expect(fuzzyFolded('ord', 'orden')).not.toBeNull()
    expect(fuzzyFolded('dro', 'orden')).toBeNull()
  })

  test('marks the letters it matched, the whole name in pieces', () => {
    const parts = pieces('Orden', 'od')
    expect(parts.map((one) => one.text).join('')).toBe('Orden')
    expect(parts.some((one) => one.hit)).toBe(true)
  })

  test('ranks a name the term starts before one it is only inside', () => {
    const row = (name: string) => ({
      key: name,
      kind: 'note' as const,
      name,
      names: [name],
      also: [],
      lift: 0,
      use: 0,
      item: name,
    })
    expect(ranked('ord', [row('board'), row('orden')])).toEqual(['orden', 'board'])
    expect(MOST_PLACES).toBeGreaterThan(0)
  })
})
