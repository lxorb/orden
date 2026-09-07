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
