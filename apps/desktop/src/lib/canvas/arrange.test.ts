import { describe, expect, test } from 'vitest'
import { aligned, ALIGNMENTS, distributed, ordered } from './arrange'
import { type Canvas, type CanvasNode, merged, stamped } from './format'

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

  test('several keep their own order among themselves', () => {
    expect(order(ordered(canvas, ['a', 'b'], 'front'))).toEqual(['c', 'd', 'a', 'b'])
    expect(order(ordered(canvas, ['a', 'b'], 'forward'))).toEqual(['c', 'a', 'b', 'd'])
  })

  test('survives a merge with a copy that added a card meanwhile', () => {
    const base = stamped(plane([]), canvas, 100)
    const ours = stamped(base, ordered(base, ['a'], 'front'), 200)
    const theirs = stamped(base, { ...base, nodes: [...base.nodes, card('e', 0, 0)] }, 210)

    expect(order(merged(ours, theirs, 1000))).toEqual(['b', 'c', 'd', 'a', 'e'])
  })

  test('everything picked is nothing to reorder', () => {
    expect(ordered(canvas, ['a', 'b', 'c', 'd'], 'front')).toBe(canvas)
    expect(ordered(canvas, [], 'front')).toBe(canvas)
  })
})

describe('the order of the stack', () => {
  const board = () =>
    ({
      nodes: ['a', 'b', 'c'].map((id) => ({
        id,
        type: 'text',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        text: id,
      })),
      edges: [],
      ink: [],
      at: {},
      gone: {},
    }) as Canvas

  test.each(['front', 'forward', 'backward', 'back'] as const)('%s moves no new object', (how) => {
    const canvas = board()
    const picked = how === 'front' || how === 'forward' ? 'a' : 'c'
    const after = ordered(canvas, [picked], how)
    expect(after.nodes.map((node) => node.id)).not.toEqual(['a', 'b', 'c'])
    expect(new Set(after.nodes)).toEqual(new Set(canvas.nodes))
    for (const node of after.nodes) expect(canvas.nodes).toContain(node)
  })
})

describe('a frame with handwriting in it', () => {
  const frame: CanvasNode = { id: 'f', type: 'group', x: 100, y: 0, width: 300, height: 300 }
  const stroke = (id: string, x: number) => ({
    id,
    tool: 'pen' as const,
    color: '#000000',
    size: 2,
    points: [
      { x, y: 50, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
      { x: x + 20, y: 60, pressure: 0.5, tiltX: 0, tiltY: 0, t: 1 },
    ],
  })
  const canvas: Canvas = {
    ...plane([frame, card('in', 120, 40, 40, 40), card('far', 0, 500, 40, 40)]),
    ink: [stroke('s', 200), stroke('out', 700)],
  }
  const inkAt = (from: Canvas) => from.ink.map((one) => [one.id, one.points[0]?.x])

  test('takes it along when it is lined up', () => {
    const lined = aligned(canvas, ['f', 'far'], 'left')
    expect(at(lined)[0]).toEqual(['f', 0, 0])
    expect(at(lined)[1]).toEqual(['in', 20, 40])
    expect(inkAt(lined)).toEqual([
      ['s', 100],
      ['out', 700],
    ])
  })

  test('and when it is spread out', () => {
    const spread = distributed(
      { ...canvas, nodes: [...canvas.nodes, card('end', 1000, 0, 40, 40)] },
      ['far', 'f', 'end'],
      'x',
    )
    const moved = (spread.nodes.find((one) => one.id === 'f')?.x ?? 0) - 100
    expect(moved).not.toBe(0)
    expect(inkAt(spread)).toEqual([
      ['s', 200 + moved],
      ['out', 700],
    ])
  })
})
