import { describe, expect, test } from 'vitest'
import {
  type Along,
  canSplit,
  clamped,
  EQUAL,
  type Frame,
  nextPane,
  pane,
  paneIn,
  panesIn,
  splitIn,
  topRow,
  tracks,
  withoutPane,
  withSplit,
} from './pane-tree'

function split(frame: Frame, id: string, along: Along, made: string): Frame {
  return withSplit(frame, id, along, pane(made), `s-${made}`)
}

const one = () => pane('a')

function beside(): Frame {
  return split(one(), 'a', 'row', 'b')
}

function four(): Frame {
  let frame = beside()
  frame = split(frame, 'a', 'column', 'c')
  return split(frame, 'b', 'column', 'd')
}

describe('splitting a pane', () => {
  test('puts the new pane on the far side of it', () => {
    const frame = beside()

    expect(frame.kind).toBe('split')
    expect(panesIn(frame).map((each) => each.id)).toEqual(['a', 'b'])
  })

  test('leaves the panes it was not asked about alone', () => {
    const frame = split(beside(), 'b', 'column', 'c')

    expect(panesIn(frame).map((each) => each.id)).toEqual(['a', 'b', 'c'])
    expect(paneIn(frame, 'a')).toEqual(pane('a'))
  })

  test('opens with both sides the same', () => {
    const frame = beside()
    expect(frame.kind === 'split' && frame.fraction).toBe(EQUAL)
  })

  test('does nothing for a pane that is not there', () => {
    const frame = split(one(), 'nowhere', 'row', 'b')
    expect(frame).toEqual(one())
  })

  test('puts the new pane on the near side when asked to', () => {
    const frame = withSplit(one(), 'a', 'row', pane('b'), 's-b', true)

    expect(panesIn(frame).map((each) => each.id)).toEqual(['b', 'a'])
  })

  test('reaches a pane on the near side of a split it is already in', () => {
    const beside = withSplit(one(), 'a', 'row', pane('b'), 's-b', true)
    const frame = withSplit(beside, 'a', 'column', pane('c'), 's-c', true)

    expect(panesIn(frame).map((each) => each.id)).toEqual(['b', 'c', 'a'])
  })

  test('splits no further for having gone the near way', () => {
    const frame = withSplit(one(), 'a', 'row', pane('b'), 's-b', true)

    expect(canSplit(frame, 'a', 'row')).toBe(false)
    expect(canSplit(frame, 'b', 'row')).toBe(false)
    expect(canSplit(frame, 'a', 'column')).toBe(true)
  })
})

describe('how far a pane may split', () => {
  test('a pane on its own may go either way', () => {
    expect(canSplit(one(), 'a', 'row')).toBe(true)
    expect(canSplit(one(), 'a', 'column')).toBe(true)
  })

  test('a pane already beside another may only split across', () => {
    const frame = beside()

    expect(canSplit(frame, 'a', 'column')).toBe(true)
    expect(canSplit(frame, 'b', 'column')).toBe(true)
    expect(canSplit(frame, 'a', 'row')).toBe(false)
    expect(canSplit(frame, 'b', 'row')).toBe(false)
  })

  test('stops at four', () => {
    const frame = four()

    expect(panesIn(frame)).toHaveLength(4)
    for (const each of panesIn(frame)) {
      expect(canSplit(frame, each.id, 'row')).toBe(false)
      expect(canSplit(frame, each.id, 'column')).toBe(false)
    }
  })

  test('says no about a pane that is not there', () => {
    expect(canSplit(one(), 'nowhere', 'row')).toBe(false)
  })
})

describe('closing a pane', () => {
  test('gives the room to the pane beside it', () => {
    const frame = withoutPane(beside(), 'b')

    expect(frame).toEqual(pane('a'))
  })

  test('leaves the last pane standing, since a window needs one', () => {
    expect(withoutPane(one(), 'a')).toEqual(one())
  })

  test('takes a whole side of a 2x2 back to three', () => {
    const frame = withoutPane(four(), 'c')

    expect(panesIn(frame).map((each) => each.id)).toEqual(['a', 'b', 'd'])
    expect(canSplit(frame, 'a', 'column')).toBe(true)
  })
})

describe('moving the focus', () => {
  test('goes round the panes in the order they are laid out', () => {
    const frame = four()
    const order = ['a', 'c', 'b', 'd']

    for (const [at, id] of order.entries()) {
      expect(nextPane(frame, id)?.id).toBe(order[(at + 1) % order.length])
    }
  })

  test('answers the first pane when the one asked about has gone', () => {
    expect(nextPane(beside(), 'gone')?.id).toBe('a')
  })

  test('answers the one pane there is', () => {
    expect(nextPane(one(), 'a')?.id).toBe('a')
  })
})

describe('the share of the room', () => {
  test('is written into the split the divider belongs to', () => {
    const frame = beside()
    const split = splitIn(frame, 's-b')
    expect(split).not.toBeNull()

    if (split) split.fraction = 0.32
    expect(frame.kind === 'split' && frame.fraction).toBe(0.32)
  })

  test('has no split to find under a lone pane, or under a name nobody has', () => {
    expect(splitIn(one(), 'a')).toBeNull()
    expect(splitIn(beside(), 'nobody')).toBeNull()
  })

  test('leaves both sides something to show', () => {
    expect(clamped(0.01, 1000, 200)).toBeCloseTo(0.2)
    expect(clamped(0.99, 1000, 200)).toBeCloseTo(0.8)
    expect(clamped(0.5, 1000, 200)).toBe(0.5)
  })

  test('splits a window too small for two down the middle', () => {
    expect(clamped(0.1, 300, 200)).toBe(EQUAL)
  })
})

const topIds = (frame: Frame) => panesIn(topRow(frame)).map((one) => one.id)

describe('the top row', () => {
  test('is the one pane there is', () => {
    expect(topIds(pane('a'))).toEqual(['a'])
  })

  test('holds both panes side by side, with the share the split gives them', () => {
    const frame = split(pane('a'), 'a', 'row', 'b')
    expect(topIds(frame)).toEqual(['a', 'b'])
    const row = topRow(frame)
    expect(row.kind === 'split' && row.fraction).toBe(EQUAL)
  })

  test('holds only the upper of two panes one above the other', () => {
    expect(topIds(split(pane('a'), 'a', 'column', 'b'))).toEqual(['a'])
  })

  test('holds the top two of a 2x2 split either way first', () => {
    const across = split(
      split(split(pane('a'), 'a', 'row', 'b'), 'a', 'column', 'c'),
      'b',
      'column',
      'd',
    )
    expect(topIds(across)).toEqual(['a', 'b'])
    const down = split(
      split(split(pane('a'), 'a', 'column', 'c'), 'a', 'row', 'b'),
      'c',
      'row',
      'd',
    )
    expect(topIds(down)).toEqual(['a', 'b'])
  })

  test("keeps the panes themselves, so a strip over one is that pane's", () => {
    const frame = split(pane('a'), 'a', 'column', 'b')
    expect(topRow(frame)).toBe(panesIn(frame)[0])
  })
})

describe('the tracks of a split', () => {
  test('share what is left once the room between the cards is taken', () => {
    const frame = split(pane('a'), 'a', 'row', 'b')
    if (frame.kind !== 'split') throw new Error('no split')
    expect(tracks({ ...frame, fraction: 0.25 })).toBe(
      'minmax(0, 0.25000fr) var(--card-gap) minmax(0, 0.75000fr)',
    )
  })
})
