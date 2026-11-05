import { describe, expect, test } from 'vitest'
import {
  type Along,
  bottomRow,
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

/** Splits a pane and hands back the frame, named the way the app names them. */
function split(frame: Frame, id: string, along: Along, made: string): Frame {
  return withSplit(frame, id, along, pane(made), `s-${made}`)
}

const one = () => pane('a')

/** Beside: a row of two. */
function beside(): Frame {
  return split(one(), 'a', 'row', 'b')
}

/** The 2x2 the app allows at most: a row of two, each split downwards. */
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

  /** A tab dropped against the left of a pane, or the top of it, asks for the
   *  new pane on that side rather than on the far one. */
  test('puts the new pane on the near side when asked to', () => {
    const frame = withSplit(one(), 'a', 'row', pane('b'), 's-b', true)

    expect(panesIn(frame).map((each) => each.id)).toEqual(['b', 'a'])
  })

  test('reaches a pane on the near side of a split it is already in', () => {
    const beside = withSplit(one(), 'a', 'row', pane('b'), 's-b', true)
    const frame = withSplit(beside, 'a', 'column', pane('c'), 's-c', true)

    // Laid out left to right and top to bottom: the new pane is above 'a'.
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
    // Along it would be three in a row, which is a note too narrow to read.
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
    // The pane that is left is beside the split it was not part of, so it can
    // still be split downwards.
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
    // Found rather than rebuilt around: a resize is one number changing, so
    // everything else reading the tree hears nothing. See splitIn.
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
    // A thousand pixels wide with two hundred as the least: a fifth either end.
    expect(clamped(0.01, 1000, 200)).toBeCloseTo(0.2)
    expect(clamped(0.99, 1000, 200)).toBeCloseTo(0.8)
    expect(clamped(0.5, 1000, 200)).toBe(0.5)
  })

  test('splits a window too small for two down the middle', () => {
    expect(clamped(0.1, 300, 200)).toBe(EQUAL)
  })
})

/** The ids of the panes along the top of a frame, left to right. */
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

const bottomIds = (frame: Frame) => panesIn(bottomRow(frame)).map((one) => one.id)

describe('the bottom row', () => {
  test('is the one pane there is', () => {
    expect(bottomIds(pane('a'))).toEqual(['a'])
  })

  test('holds both panes side by side', () => {
    expect(bottomIds(split(pane('a'), 'a', 'row', 'b'))).toEqual(['a', 'b'])
  })

  test('holds only the lower of two panes one above the other', () => {
    expect(bottomIds(split(pane('a'), 'a', 'column', 'b'))).toEqual(['b'])
  })

  test('holds the bottom two of a 2x2 split either way first', () => {
    const across = split(
      split(split(pane('a'), 'a', 'row', 'b'), 'a', 'column', 'c'),
      'b',
      'column',
      'd',
    )
    expect(bottomIds(across)).toEqual(['c', 'd'])
    const down = split(
      split(split(pane('a'), 'a', 'column', 'c'), 'a', 'row', 'b'),
      'c',
      'row',
      'd',
    )
    expect(bottomIds(down)).toEqual(['c', 'd'])
  })

  test("holds a pane beside a column whole, and only the column's lower side", () => {
    const frame = split(split(pane('a'), 'a', 'row', 'b'), 'b', 'column', 'c')
    expect(bottomIds(frame)).toEqual(['a', 'c'])
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
