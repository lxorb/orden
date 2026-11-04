import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { between, byPosition, isPosition } from './order'

describe('a position', () => {
  test('fits between any two, and at either end', () => {
    const first = between(null, null)
    const before = between(null, first)
    const after = between(first, null)
    const middle = between(before, first)
    expect([before, middle, first, after].every(isPosition)).toBe(true)
    expect(before < middle && middle < first && first < after).toBe(true)
  })

  test('always fits again, however many times one gap is filled', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { maxLength: 200 }), (sides) => {
        let low: string | null = null
        let high: string | null = null
        for (const toLow of sides) {
          const next = between(low, high)
          expect(isPosition(next)).toBe(true)
          if (low !== null) expect(next > low).toBe(true)
          if (high !== null) expect(next < high).toBe(true)
          if (toLow) low = next
          else high = next
        }
      }),
    )
  })

  test('is refused where it is not one', () => {
    expect(isPosition('')).toBe(false)
    expect(isPosition('a0')).toBe(false)
    expect(isPosition('a-b')).toBe(false)
    expect(isPosition('x'.repeat(129))).toBe(false)
    expect(() => between('b', 'a')).toThrow()
  })

  test('orders entries, the positioned first and the ids breaking ties', () => {
    const rows = [{ id: 'c' }, { id: 'b', pos: 'V' }, { id: 'a', pos: 'V' }, { id: 'd', pos: 'G' }]
    expect([...rows].sort(byPosition).map((one) => one.id)).toEqual(['d', 'a', 'b', 'c'])
  })
})
