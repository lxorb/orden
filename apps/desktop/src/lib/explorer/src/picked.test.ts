import { describe, expect, it } from 'vitest'
import { NOTHING, pickedAll, pickedAt, stillThere } from './picked'

const names = ['a', 'b', 'c', 'd', 'e']

describe("a file explorer's pick", () => {
  it('is one row for a plain press, and a range from the anchor with Shift', () => {
    const one = pickedAt(NOTHING, names, 'b', 'one')
    expect([...one.names]).toEqual(['b'])
    const range = pickedAt(one, names, 'd', 'range')
    expect([...range.names]).toEqual(['b', 'c', 'd'])
    expect(pickedAt(range, names, 'a', 'range').names).toEqual(new Set(['a', 'b']))
  })

  it('adds and takes one away with Ctrl, and moves only the keyboard with Ctrl and an arrow', () => {
    const one = pickedAt(NOTHING, names, 'a', 'one')
    const two = pickedAt(one, names, 'c', 'toggle')
    expect(two.names).toEqual(new Set(['a', 'c']))
    expect(pickedAt(two, names, 'a', 'toggle').names).toEqual(new Set(['c']))
    const moved = pickedAt(two, names, 'e', 'move')
    expect(moved.names).toEqual(two.names)
    expect(moved.cursor).toBe('e')
  })

  it('takes everything at once, and keeps what is still there after a listing', () => {
    expect(pickedAll(NOTHING, names).names.size).toBe(5)
    const kept = stillThere(pickedAt(pickedAll(NOTHING, names), names, 'c', 'move'), ['a', 'c'])
    expect(kept.names).toEqual(new Set(['a', 'c']))
    expect(kept.cursor).toBe('c')
    expect(stillThere(pickedAt(NOTHING, names, 'b', 'one'), ['a']).cursor).toBeNull()
  })
})
