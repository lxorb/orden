import { describe, expect, test } from 'vitest'
import { aligned, ALIGNMENTS, distributed, ordered } from './arrange'
import type { Canvas, CanvasNode } from './format'

function card(id: string, x: number, y: number, width = 100, height = 100): CanvasNode {
  return { id, type: 'text', x, y, width, height, text: id }
}

function plane(nodes: CanvasNode[]): Canvas {
  return { nodes, edges: [], ink: [], at: {}, gone: {} }
}

const at = (canvas: Canvas) => canvas.nodes.map((node) => [node.id, node.x, node.y])
const order = (canvas: Canvas) => canvas.nodes.map((node) => node.id)

describe('lining things up', () => {
  const canvas = plane([card('a', 0, 0, 100, 40), card('b', 30, 200, 60, 40)])

  test('puts every left edge on the leftmost', () => {
    expect(at(aligned(canvas, ['a', 'b'], 'left'))).toEqual([
      ['a', 0, 0],
      ['b', 0, 200],
    ])
  })

  test('puts every right edge on the rightmost', () => {
    expect(at(aligned(canvas, ['a', 'b'], 'right'))).toEqual([
      ['a', 0, 0],
      ['b', 40, 200],
    ])
  })

  test('puts every middle on the middle of the lot', () => {
    expect(at(aligned(canvas, ['a', 'b'], 'centre'))).toEqual([
      ['a', 0, 0],
      ['b', 20, 200],
    ])
  })

  test('does the same on the other axis', () => {
    expect(at(aligned(canvas, ['a', 'b'], 'top'))).toEqual([
      ['a', 0, 0],
      ['b', 30, 0],
    ])
    expect(at(aligned(canvas, ['a', 'b'], 'bottom'))).toEqual([
      ['a', 0, 200],
      ['b', 30, 200],
    ])
  })

  test('touches nothing that was not picked', () => {
    const three = plane([card('a', 0, 0), card('b', 30, 200), card('c', 900, 900)])
    expect(aligned(three, ['a', 'b'], 'left').nodes[2]).toBe(three.nodes[2])
  })

  test('one thing is nothing to line up', () => {
    for (const how of ALIGNMENTS) {
      expect(aligned(canvas, ['a'], how)).toBe(canvas)
      expect(aligned(canvas, [], how)).toBe(canvas)
    }
  })

  /** A frame is a thing with room in it, so lining one up takes what is inside
   *  it along. */
  test('a frame carries what is inside it', () => {
    const framed = plane([
      { id: 'g', type: 'group', x: 200, y: 0, width: 300, height: 300 },
      card('in', 220, 20),
      card('other', 0, 0),
    ])

    const lined = aligned(framed, ['g', 'other'], 'left')
    expect(at(lined)).toEqual([
      ['g', 0, 0],
      ['in', 20, 20],
      ['other', 0, 0],
    ])
  })
})

describe('spreading things out', () => {
  test('leaves the same gap between each', () => {
    const canvas = plane([
      card('a', 0, 0, 50, 50),
      card('b', 60, 0, 50, 50),
      card('c', 300, 0, 50, 50),
    ])
    const spread = distributed(canvas, ['a', 'b', 'c'], 'x')

    const xs = spread.nodes.map((node) => node.x)
    expect(xs[1]! - (xs[0]! + 50)).toBe(xs[2]! - (xs[1]! + 50))
  })

  test('leaves the two on the outside where they were', () => {
    const canvas = plane([
      card('a', 0, 0, 50, 50),
      card('b', 60, 0, 50, 50),
      card('c', 300, 0, 50, 50),
    ])
    const spread = distributed(canvas, ['a', 'b', 'c'], 'x')

    expect(spread.nodes[0]?.x).toBe(0)
    expect(spread.nodes[2]?.x).toBe(300)
  })

  test('works down the page as well as across it', () => {
    const canvas = plane([
      card('a', 0, 0, 50, 50),
      card('b', 0, 30, 50, 50),
      card('c', 0, 300, 50, 50),
    ])
    const spread = distributed(canvas, ['a', 'b', 'c'], 'y')

    // Three fifty-tall cards between 0 and 300 leave a hundred of gap each way.
    expect(spread.nodes[1]?.y).toBe(150)
  })

  test('fewer than three has no middle to move', () => {
    const canvas = plane([card('a', 0, 0), card('b', 300, 0)])
    expect(distributed(canvas, ['a', 'b'], 'x')).toBe(canvas)
  })
})

describe('the z order', () => {
  const canvas = plane([card('a', 0, 0), card('b', 0, 0), card('c', 0, 0), card('d', 0, 0)])

  test('the front of the plane is the end of the list', () => {
    expect(order(ordered(canvas, ['a'], 'front'))).toEqual(['b', 'c', 'd', 'a'])
    expect(order(ordered(canvas, ['d'], 'back'))).toEqual(['d', 'a', 'b', 'c'])
  })

  test('one step forward swaps with the one in front', () => {
    expect(order(ordered(canvas, ['b'], 'forward'))).toEqual(['a', 'c', 'b', 'd'])
    expect(order(ordered(canvas, ['c'], 'backward'))).toEqual(['a', 'c', 'b', 'd'])
  })

  test('a card at the front cannot go further forward', () => {
    expect(order(ordered(canvas, ['d'], 'forward'))).toEqual(['a', 'b', 'c', 'd'])
    expect(order(ordered(canvas, ['a'], 'backward'))).toEqual(['a', 'b', 'c', 'd'])
  })

  /** Several brought forward arrive in the order they were already in, which is
   *  the only answer nobody has to think about. */
  test('several keep their own order among themselves', () => {
    expect(order(ordered(canvas, ['a', 'b'], 'front'))).toEqual(['c', 'd', 'a', 'b'])
    expect(order(ordered(canvas, ['a', 'b'], 'forward'))).toEqual(['c', 'a', 'b', 'd'])
  })

  test('everything picked is nothing to reorder', () => {
    expect(ordered(canvas, ['a', 'b', 'c', 'd'], 'front')).toBe(canvas)
    expect(ordered(canvas, [], 'front')).toBe(canvas)
  })
})
