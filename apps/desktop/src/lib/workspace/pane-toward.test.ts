import { describe, expect, test } from 'vitest'
import { type Along, type Frame, pane, paneToward, type Toward, withSplit } from './pane-tree'

function split(frame: Frame, id: string, along: Along, made: string): Frame {
  return withSplit(frame, id, along, pane(made), `s-${made}`)
}

const to = (frame: Frame, id: string, toward: Toward) => paneToward(frame, id, toward)?.id ?? null

describe('the pane next over', () => {
  test('is nothing in a window of one pane', () => {
    for (const toward of ['left', 'right', 'up', 'down'] as const) {
      expect(to(pane('a'), 'a', toward)).toBeNull()
    }
  })

  test('is the other side of a row, and nothing past the edge', () => {
    const row = split(pane('a'), 'a', 'row', 'b')
    expect(to(row, 'a', 'right')).toBe('b')
    expect(to(row, 'b', 'left')).toBe('a')
    expect(to(row, 'a', 'left')).toBeNull()
    expect(to(row, 'b', 'right')).toBeNull()
    expect(to(row, 'a', 'up')).toBeNull()
    expect(to(row, 'a', 'down')).toBeNull()
  })

  test('is above and below in a column', () => {
    const column = split(pane('a'), 'a', 'column', 'b')
    expect(to(column, 'a', 'down')).toBe('b')
    expect(to(column, 'b', 'up')).toBe('a')
    expect(to(column, 'a', 'right')).toBeNull()
  })

  test('goes every way round a 2x2', () => {
    const four = split(
      split(split(pane('a'), 'a', 'row', 'b'), 'a', 'column', 'c'),
      'b',
      'column',
      'd',
    )
    expect(to(four, 'a', 'right')).toBe('b')
    expect(to(four, 'a', 'down')).toBe('c')
    expect(to(four, 'c', 'right')).toBe('d')
    expect(to(four, 'd', 'up')).toBe('b')
    expect(to(four, 'd', 'left')).toBe('c')
    expect(to(four, 'b', 'left')).toBe('a')
  })

  test('from a wide pane over two, is the one beside its middle, by where the divider is', () => {
    const frame = split(split(pane('a'), 'a', 'column', 'b'), 'b', 'row', 'd')
    expect(to(frame, 'b', 'up')).toBe('a')
    expect(to(frame, 'd', 'up')).toBe('a')
    expect(to(frame, 'a', 'down')).toBe('b')
    if (frame.kind !== 'split' || frame.sides[1].kind !== 'split') throw new Error('the shape')
    frame.sides[1].fraction = 0.3
    expect(to(frame, 'a', 'down')).toBe('d')
  })

  test('of a pane not in the window is nothing', () => {
    expect(to(split(pane('a'), 'a', 'row', 'b'), 'gone', 'right')).toBeNull()
  })
})
