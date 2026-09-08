import { describe, expect, test } from 'vitest'
import type { Canvas, CanvasNode } from './format'
import {
  bounds,
  boxOf,
  caught,
  dragged,
  edgeEnds,
  edgeMiddle,
  edgePath,
  facingSide,
  GRID,
  insideGroup,
  nodeAt,
  overlaps,
  rectBetween,
  resizedBox,
  sidePoint,
  snapped,
  within,
} from './geometry'

function card(id: string, x: number, y: number, width = 100, height = 100): CanvasNode {
  return { id, type: 'text', x, y, width, height, text: '' }
}

function group(id: string, x: number, y: number, width: number, height: number): CanvasNode {
  return { id, type: 'group', x, y, width, height }
}

describe('the middle of a side', () => {
  const box = { x: 100, y: 200, width: 60, height: 40 }

  test('is where an edge meets the box', () => {
    expect(sidePoint(box, 'top')).toEqual({ x: 130, y: 200 })
    expect(sidePoint(box, 'right')).toEqual({ x: 160, y: 220 })
    expect(sidePoint(box, 'bottom')).toEqual({ x: 130, y: 240 })
    expect(sidePoint(box, 'left')).toEqual({ x: 100, y: 220 })
  })
})

describe('which side faces which', () => {
  const here = { x: 0, y: 0, width: 100, height: 100 }

  test('is the way the other box lies', () => {
    expect(facingSide(here, { x: 400, y: 0, width: 100, height: 100 })).toBe('right')
    expect(facingSide(here, { x: -400, y: 0, width: 100, height: 100 })).toBe('left')
    expect(facingSide(here, { x: 0, y: 400, width: 100, height: 100 })).toBe('bottom')
    expect(facingSide(here, { x: 0, y: -400, width: 100, height: 100 })).toBe('top')
  })

  /** A wide card beside a tall one connects the way it looks like it should,
   *  which is what weighing the distance against the box's own size is for. */
  test('reads a wide box as wide', () => {
    const wide = { x: 0, y: 0, width: 600, height: 40 }
    expect(facingSide(wide, { x: 200, y: 200, width: 40, height: 40 })).toBe('bottom')
  })
})

describe('where an edge starts and ends', () => {
  const from = card('a', 0, 0)
  const to = card('b', 400, 0)

  test('follows the sides the file names', () => {
    const ends = edgeEnds(
      { id: 'e', fromNode: 'a', fromSide: 'bottom', toNode: 'b', toSide: 'top' },
      boxOf(from),
      boxOf(to),
    )

    expect(ends.from).toEqual({ x: 50, y: 100 })
    expect(ends.to).toEqual({ x: 450, y: 0 })
  })

  test('works out a side the file leaves out from where the cards are', () => {
    const ends = edgeEnds({ id: 'e', fromNode: 'a', toNode: 'b' }, boxOf(from), boxOf(to))

    expect(ends.fromSide).toBe('right')
    expect(ends.toSide).toBe('left')
    expect(ends.from).toEqual({ x: 100, y: 50 })
    expect(ends.to).toEqual({ x: 400, y: 50 })
  })

  test('is a curve that starts and ends where the sides are', () => {
    const ends = edgeEnds({ id: 'e', fromNode: 'a', toNode: 'b' }, boxOf(from), boxOf(to))
    const path = edgePath(ends)

    expect(path.startsWith('M 100 50 C ')).toBe(true)
    expect(path.endsWith(' 400 50')).toBe(true)
  })

  test('puts a label halfway along it', () => {
    const ends = edgeEnds({ id: 'e', fromNode: 'a', toNode: 'b' }, boxOf(from), boxOf(to))
    const middle = edgeMiddle(ends)

    expect(middle.x).toBeCloseTo(250)
    expect(middle.y).toBeCloseTo(50)
  })
})

describe('snapping', () => {
  test('lands on the nearest dot', () => {
    expect(snapped(0)).toBe(0)
    expect(snapped(GRID / 2 - 1)).toBe(0)
    expect(snapped(GRID / 2 + 1)).toBe(GRID)
    expect(snapped(-GRID / 2 - 1)).toBe(-GRID)
  })
})

describe('what is under a point', () => {
  const nodes = [card('under', 0, 0), card('over', 50, 50)]

  test('is the topmost card that holds it', () => {
    expect(nodeAt(nodes, { x: 60, y: 60 })?.id).toBe('over')
    expect(nodeAt(nodes, { x: 10, y: 10 })?.id).toBe('under')
    expect(nodeAt(nodes, { x: 500, y: 500 })).toBeNull()
  })

  test('counts the edges of a card as the card', () => {
    const box = boxOf(nodes[0]!)

    expect(within(box, { x: 0, y: 0 })).toBe(true)
    expect(within(box, { x: 100, y: 100 })).toBe(true)
    expect(within(box, { x: 101, y: 50 })).toBe(false)
  })

  /** A group is a frame around some room: the frame is the group, and the room
   *  inside it belongs to whatever is sitting there. */
  test('picks a group up by its frame and not by the middle of it', () => {
    const framed = [group('g', 0, 0, 400, 400), card('inside', 100, 100)]

    expect(nodeAt(framed, { x: 2, y: 200 })?.id).toBe('g')
    expect(nodeAt(framed, { x: 300, y: 40 })).toBeNull()
    expect(nodeAt(framed, { x: 150, y: 150 })?.id).toBe('inside')
  })
})

describe('a rubber band', () => {
  test('is the rectangle between two points, whichever corner it started in', () => {
    expect(rectBetween({ x: 100, y: 100 }, { x: 20, y: 40 })).toEqual({
      x: 20,
      y: 40,
      width: 80,
      height: 60,
    })
  })

  test('catches every card it touches at all', () => {
    const nodes = [card('a', 0, 0), card('b', 300, 0), card('c', 90, 90)]

    expect(caught(nodes, { x: -10, y: -10, width: 120, height: 120 })).toEqual(['a', 'c'])
    expect(caught(nodes, { x: 500, y: 500, width: 10, height: 10 })).toEqual([])
  })

  test('touching along an edge alone is not touching', () => {
    expect(
      overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }),
    ).toBe(false)
  })
})

describe('what a drag carries', () => {
  const canvas: Canvas = {
    nodes: [group('g', 0, 0, 400, 400), card('in', 50, 50), card('out', 900, 900)],
    edges: [],
    ink: [],
    at: {},
    gone: {},
  }

  test('is the cards themselves when no group is among them', () => {
    expect(dragged(canvas, ['in'])).toEqual(['in'])
  })

  test('is a group and everything inside it', () => {
    expect(dragged(canvas, ['g']).sort()).toEqual(['g', 'in'])
  })

  test('reaches through a group inside a group', () => {
    const nested: Canvas = {
      nodes: [
        group('outer', 0, 0, 800, 800),
        group('inner', 100, 100, 300, 300),
        card('deep', 150, 150),
      ],
      edges: [],
      ink: [],
      at: {},
      gone: {},
    }

    expect(dragged(nested, ['outer']).sort()).toEqual(['deep', 'inner', 'outer'])
  })

  test('counts a card as inside only when the whole of it is', () => {
    expect(
      insideGroup({ x: 0, y: 0, width: 100, height: 100 }, { x: 10, y: 10, width: 50, height: 50 }),
    ).toBe(true)
    expect(
      insideGroup({ x: 0, y: 0, width: 100, height: 100 }, { x: 80, y: 10, width: 50, height: 50 }),
    ).toBe(false)
  })
})

describe('resizing a box', () => {
  const box = { x: 100, y: 100, width: 200, height: 200 }
  const least = GRID * 2

  test('moves the edges the handle pulls and leaves the others', () => {
    expect(resizedBox(box, 'se', 40, 40, least)).toEqual({
      x: 100,
      y: 100,
      width: 240,
      height: 240,
    })
    expect(resizedBox(box, 'nw', 40, 40, least)).toEqual({
      x: 140,
      y: 140,
      width: 160,
      height: 160,
    })
    expect(resizedBox(box, 'e', 40, 40, least)).toEqual({ x: 100, y: 100, width: 240, height: 200 })
    expect(resizedBox(box, 'n', 0, -40, least)).toEqual({ x: 100, y: 60, width: 200, height: 240 })
  })

  /** The offset arrives already snapped, or not, as the surface decided: the
   *  guides and the grid are settled next door, in snap.ts. */
  test('takes the offset as it was given, rounded to a whole pixel', () => {
    expect(resizedBox(box, 'se', 27.4, 27.4, least)).toEqual({
      x: 100,
      y: 100,
      width: 227,
      height: 227,
    })
  })

  test('stops rather than turning the box inside out', () => {
    const small = resizedBox(box, 'se', -1000, -1000, least)
    expect(small.width).toBe(least)
    expect(small.height).toBe(least)

    const other = resizedBox(box, 'nw', 1000, 1000, least)
    expect(other.width).toBe(least)
    expect(other.x).toBe(300 - least)
  })
})

describe('the box around everything', () => {
  test('is what a fit frames', () => {
    expect(bounds([card('a', 0, 0), card('b', 300, 400, 50, 50)])).toEqual({
      x: 0,
      y: 0,
      width: 350,
      height: 450,
    })
  })

  test('is nothing at all for an empty canvas', () => {
    expect(bounds([])).toBeNull()
  })
})
