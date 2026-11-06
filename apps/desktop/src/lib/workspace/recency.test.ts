import { describe, expect, test } from 'vitest'
import { ranked, successor, Walk } from './recency'

const STRIP = ['a', 'b', 'c', 'd']

describe('a strip in order of use', () => {
  test('is the tab in front, then the rest by how recently each was in front', () => {
    expect(ranked(STRIP, ['c', 'a', 'b'], 'c')).toEqual(['c', 'a', 'b', 'd'])
  })

  test('keeps the strip s own order for tabs never in front', () => {
    expect(ranked(STRIP, [], 'b')).toEqual(['b', 'a', 'c', 'd'])
  })

  test('leaves out tabs that are not in this strip any more', () => {
    expect(ranked(['a', 'b'], ['gone', 'b', 'a'], 'a')).toEqual(['a', 'b'])
  })
})

describe('Ctrl+Tab in order of use', () => {
  const walk = () => new Walk(STRIP, 'c', ['c', 'b', 'a'])

  test('goes to the tab used before this one', () => {
    expect(walk().step(1)).toBe('b')
  })

  test('goes further back with each press while held, and round', () => {
    const held = walk()
    expect([held.step(1), held.step(1), held.step(1), held.step(1)]).toEqual(['b', 'a', 'd', 'c'])
  })

  test('goes to the tab used longest ago with Shift', () => {
    expect(walk().step(-1)).toBe('d')
  })

  test('moves only the tab it ended on to the front of the order', () => {
    const held = walk()
    held.step(1)
    held.step(1)
    expect(held.ended('a')).toEqual(['a', 'c', 'b'])
  })

  test('goes back and forth between two tabs, one press at a time', () => {
    const first = walk()
    const there = first.step(1)
    const again = new Walk(STRIP, there ?? '', first.ended(there))
    expect(again.step(1)).toBe('c')
  })

  test('has nowhere to go in a strip of one', () => {
    expect(new Walk(['a'], 'a', ['a']).step(1)).toBeNull()
  })
})

describe('the tab a pane shows once its tab in front has gone (#1079)', () => {
  test('the one used last of those left', () => {
    expect(successor(['a', 'b', 'c'], ['x', 'c', 'a'], 0)).toBe('c')
  })

  test('none used: the neighbour of the place it went from, right then left', () => {
    expect(successor(['a', 'b', 'c'], ['x'], 1)).toBe('b')
    expect(successor(['a', 'b'], [], 2)).toBe('b')
    expect(successor(['a', 'b'], [], 0)).toBe('a')
  })

  test('no place known: the end of the strip, never the first for being first', () => {
    expect(successor(['a', 'b', 'c'], [])).toBe('c')
    expect(successor([], [])).toBeNull()
  })
})
