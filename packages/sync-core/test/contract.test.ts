import { describe, expect, it } from 'vitest'
import {
  between,
  byPosition,
  ENTRY_KINDS,
  isEntryId,
  isPosition,
  metaOf,
  patched,
  sameMeta,
  spread,
} from '../src/api'

describe('order', () => {
  it('always finds a position between two others', () => {
    const first = between(null, null)
    const after = between(first, null)
    const before = between(null, first)
    const middle = between(before, after)
    expect(before < first && first < after).toBe(true)
    expect(before < middle && middle < after).toBe(true)
    for (const one of [first, after, before, middle]) expect(isPosition(one)).toBe(true)
  })

  it('spreads a count of positions in order', () => {
    const positions = spread(null, null, 5)
    expect(positions).toHaveLength(5)
    expect([...positions].sort()).toEqual(positions)
    expect(new Set(positions).size).toBe(5)
  })

  it('sorts by position and leaves equal rows where they were', () => {
    const [a, b, c] = spread(null, null, 3)
    const rows = [
      { id: 'two', pos: b },
      { id: 'three', pos: c },
      { id: 'one', pos: a },
    ]
    expect([...rows].sort(byPosition).map((one) => one.id)).toEqual(['one', 'two', 'three'])
  })
})

describe('item meta', () => {
  it('reads only string-to-string records', () => {
    expect(metaOf({ colour: 'red' })).toEqual({ colour: 'red' })
    expect(metaOf({ colour: 3 })).toBeNull()
    expect(metaOf('red')).toBeNull()
  })

  it('patches with null meaning removed and compares by value', () => {
    const had = { colour: 'red', icon: 'star' }
    const next = patched(had, { icon: null, size: 'big' })
    expect(next).toEqual({ colour: 'red', size: 'big' })
    expect(sameMeta(had, { icon: 'star', colour: 'red' })).toBe(true)
    expect(sameMeta(had, next)).toBe(false)
    expect(patched(undefined, { icon: null })).toBeUndefined()
  })
})

describe('wire', () => {
  it('names the entry kinds and refuses ids that could be paths', () => {
    expect(ENTRY_KINDS).toEqual([
      'note',
      'canvas',
      'pages',
      'url',
      'term',
      'chat',
      'file',
      'folder',
    ])
    expect(isEntryId('abc')).toBe(true)
    expect(isEntryId('a/b')).toBe(false)
    expect(isEntryId('')).toBe(false)
  })
})
