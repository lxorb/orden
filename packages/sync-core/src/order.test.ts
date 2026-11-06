import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { between, byPosition, isPosition, repositioned, spread } from './order'

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

describe('positions for an order', () => {
  const drawn = (rows: { id: string; pos?: string }[], moved: Map<string, string>) => {
    const now = rows.map((row) => {
      const pos = moved.get(row.id) ?? row.pos
      return pos === undefined ? { id: row.id } : { id: row.id, pos }
    })
    const placed = now.filter((row) => row.pos !== undefined).sort(byPosition)
    return [...placed, ...now.filter((row) => row.pos === undefined)].map((row) => row.id)
  }

  test('spread keeps a hundred in one gap short and rising', () => {
    const out = spread('V', 'W', 100)
    expect(out).toHaveLength(100)
    expect(
      out.every(
        (pos, at) =>
          isPosition(pos) && pos > 'V' && pos < 'W' && (at === 0 || pos > (out[at - 1] ?? '')),
      ),
    ).toBe(true)
    expect(Math.max(...out.map((pos) => pos.length))).toBeLessThanOrEqual(4)
  })

  test('an order nobody placed yet gives each placed row a position', () => {
    const rows = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]
    const moved = repositioned(rows, 2)
    expect([...moved.keys()]).toEqual(['c', 'a'])
    expect(drawn(rows, moved)).toEqual(['c', 'a', 'b'])
  })

  test('one row dragged is one position written', () => {
    const rows = [
      { id: 'a', pos: 'G' },
      { id: 'b', pos: 'N' },
      { id: 'c', pos: 'V' },
      { id: 'd', pos: 'e' },
    ]
    const wanted = [rows[3], rows[0], rows[1], rows[2]].filter((row) => row !== undefined)
    const moved = repositioned(wanted, 4)
    expect([...moved.keys()]).toEqual(['d'])
    expect(drawn(rows, moved)).toEqual(['d', 'a', 'b', 'c'])
  })

  test('a placed row trimmed off the end still stands where the order says', () => {
    const rows = [{ id: 'a', pos: 'V' }, { id: 'b' }, { id: 'c', pos: 'G' }]
    const moved = repositioned(rows, 1)
    expect(drawn(rows, moved)).toEqual(['a', 'b', 'c'])
  })

  test('any order of any rows comes out drawn as wanted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.constantFrom('1', 'G', 'N', 'V', 'e', 'z'), { nil: undefined }), {
          maxLength: 30,
        }),
        fc.nat(),
        fc.nat(),
        (positions, seed, placed) => {
          const rows = positions.map((pos, at) =>
            pos === undefined ? { id: `r${String(at)}` } : { id: `r${String(at)}`, pos },
          )
          const wanted = [...rows].sort(
            (a, b) =>
              ((seed * (a.id.length + 7) + a.id.charCodeAt(1)) % 13) -
              ((seed * (b.id.length + 7) + b.id.charCodeAt(1)) % 13),
          )
          const count = placed % (wanted.length + 1)
          const moved = repositioned(wanted, count)
          for (const pos of moved.values()) expect(isPosition(pos)).toBe(true)
          const drawnNow = drawn(wanted, moved)
          const standing = drawnNow.filter(
            (id) => moved.has(id) || wanted.find((row) => row.id === id)?.pos !== undefined,
          )
          const ids = wanted.map((row) => row.id)
          expect(standing).toEqual(ids.slice(0, standing.length))
          expect(standing.length).toBeGreaterThanOrEqual(count)
        },
      ),
    )
  })
})
