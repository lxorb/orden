import { describe, expect, test } from 'vitest'
import { canSplit, type Frame, pane, withSplit } from './pane-tree'
import { alongOf, type Box, inside, madeFirst, type Side, zoneAt } from './zones'

/** A pane a thousand across and five hundred down, at the top left of the page.
 *  The bands are 28% of each way: 280 in from the sides, 140 from the top and
 *  the bottom. */
const box: Box = { left: 0, top: 0, width: 1000, height: 500 }

/** Every side on offer, which is what a pane on its own has. */
const all = () => true

/** Which sides a pane in a frame may still be split into, which is what the app
 *  offers: the 2x2 the arrangement stops at, read off the tree. */
const offeredIn = (frame: Frame, id: string) => (side: Side) => canSplit(frame, id, alongOf(side))

const split = (frame: Frame, id: string, made: string, side: Side): Frame =>
  withSplit(frame, id, alongOf(side), pane(made), `s-${made}`, madeFirst(side))

describe('which zone of a pane a drop is in', () => {
  test('the middle of it is the pane itself', () => {
    expect(zoneAt(box, 500, 250, all)).toBe('middle')
  })

  test('a band along each side is that side', () => {
    expect(zoneAt(box, 40, 250, all)).toBe('left')
    expect(zoneAt(box, 960, 250, all)).toBe('right')
    expect(zoneAt(box, 500, 20, all)).toBe('top')
    expect(zoneAt(box, 500, 480, all)).toBe('bottom')
  })

  test('reads the same wherever the pane sits on the page', () => {
    const moved: Box = { left: 300, top: 100, width: 1000, height: 500 }

    expect(zoneAt(moved, 340, 350, all)).toBe('left')
    expect(zoneAt(moved, 800, 350, all)).toBe('middle')
  })

  test('leaves the band the moment the pointer is past it', () => {
    // 28% of a thousand is 280, and a hair past it is the pane itself.
    expect(zoneAt(box, 279, 250, all)).toBe('left')
    expect(zoneAt(box, 281, 250, all)).toBe('middle')
  })

  test('gives a corner to whichever side it is further into', () => {
    // A tenth of the way in across, a fiftieth down: further into the top.
    expect(zoneAt(box, 100, 10, all)).toBe('top')
    // Further into the left, at the same corner.
    expect(zoneAt(box, 10, 100, all)).toBe('left')
  })
})

describe('the sides a pane offers', () => {
  test('a pane on its own offers all four', () => {
    const frame = pane('a')
    const offered = offeredIn(frame, 'a')

    expect(zoneAt(box, 40, 250, offered)).toBe('left')
    expect(zoneAt(box, 960, 250, offered)).toBe('right')
    expect(zoneAt(box, 500, 20, offered)).toBe('top')
    expect(zoneAt(box, 500, 480, offered)).toBe('bottom')
  })

  test('a pane already beside another offers only up and down', () => {
    const frame = split(pane('a'), 'a', 'b', 'right')
    const offered = offeredIn(frame, 'a')

    // Along the row it would be three panes in a row, so the side is not
    // offered and the drop lands in the pane rather than doing nothing.
    expect(zoneAt(box, 40, 250, offered)).toBe('middle')
    expect(zoneAt(box, 960, 250, offered)).toBe('middle')
    expect(zoneAt(box, 500, 20, offered)).toBe('top')
    expect(zoneAt(box, 500, 480, offered)).toBe('bottom')
  })

  test('a full 2x2 offers none of them', () => {
    let frame = split(pane('a'), 'a', 'b', 'right')
    frame = split(frame, 'a', 'c', 'bottom')
    frame = split(frame, 'b', 'd', 'bottom')

    for (const id of ['a', 'b', 'c', 'd']) {
      const offered = offeredIn(frame, id)

      expect(zoneAt(box, 10, 250, offered)).toBe('middle')
      expect(zoneAt(box, 990, 250, offered)).toBe('middle')
      expect(zoneAt(box, 500, 5, offered)).toBe('middle')
      expect(zoneAt(box, 500, 495, offered)).toBe('middle')
    }
  })

  test('gives a corner to the side that is on offer', () => {
    const frame = split(pane('a'), 'a', 'b', 'right')
    const offered = offeredIn(frame, 'a')

    // Deeper into the left than into the top, but the left cannot split.
    expect(zoneAt(box, 10, 100, offered)).toBe('top')
  })
})

describe('what a side means to the tree', () => {
  test('the two sides of a pane split across it, the other two down it', () => {
    expect(alongOf('left')).toBe('row')
    expect(alongOf('right')).toBe('row')
    expect(alongOf('top')).toBe('column')
    expect(alongOf('bottom')).toBe('column')
  })

  test('only the near sides put the new pane first', () => {
    expect(madeFirst('left')).toBe(true)
    expect(madeFirst('top')).toBe(true)
    expect(madeFirst('right')).toBe(false)
    expect(madeFirst('bottom')).toBe(false)
  })
})

describe('whether a point is in a box', () => {
  test('says so for a point inside it and for one on its edge', () => {
    expect(inside(box, 500, 250)).toBe(true)
    expect(inside(box, 0, 0)).toBe(true)
    expect(inside(box, 1000, 500)).toBe(true)
  })

  test('says no for a point outside it either way', () => {
    expect(inside(box, -1, 250)).toBe(false)
    expect(inside(box, 1001, 250)).toBe(false)
    expect(inside(box, 500, -1)).toBe(false)
    expect(inside(box, 500, 501)).toBe(false)
  })
})
