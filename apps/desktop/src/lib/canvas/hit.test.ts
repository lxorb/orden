import { describe, expect, test } from 'vitest'
import type { Canvas, CanvasEdge, CanvasNode } from './format'
import { edgeEnds, edgeMiddle, boxOf } from './geometry'
import { hitAt, type Where } from './hit'

/** What is under a point, which is the one question a press asks. It is answered
 *  from the same geometry the plane is drawn from, so what is checked here is
 *  that the two agree: a connector is found where it is drawn, and nowhere else. */

function card(id: string, x: number, y: number): CanvasNode {
  return { id, type: 'text', x, y, width: 250, height: 60, text: id }
}

const NODES = [card('a', 0, 0), card('b', 600, 400)]
const EDGE: CanvasEdge = { id: 'e', fromNode: 'a', toNode: 'b' }

const CANVAS: Canvas = { nodes: NODES, edges: [EDGE], ink: [], at: {}, gone: {} }

function where(over: Partial<Where> = {}): Where {
  return {
    canvas: CANVAS,
    picked: [],
    box: null,
    scale: 1,
    ported: null,
    coarse: false,
    lassoed: false,
    ...over,
  }
}

describe('what a point is on', () => {
  test('is the card the point is inside', () => {
    expect(hitAt(where(), { x: 100, y: 30 })).toMatchObject({ node: 'a' })
  })

  test('is the connector where the connector is drawn', () => {
    const middle = edgeMiddle(edgeEnds(EDGE, boxOf(NODES[0]!), boxOf(NODES[1]!)))
    expect(hitAt(where(), middle)).toMatchObject({ edge: 'e' })
  })

  test('is nothing at all out on the plane beside it', () => {
    const middle = edgeMiddle(edgeEnds(EDGE, boxOf(NODES[0]!), boxOf(NODES[1]!)))
    expect(hitAt(where(), { x: middle.x, y: middle.y - 200 })).toEqual({
      handle: null,
      port: null,
      endpoint: null,
      node: null,
      edge: null,
      stroke: null,
      ink: null,
    })
  })

  /** An end of a picked connector is what moves that end onto another card, and it
   *  sits exactly where a card's own dot would: it is found first, because it is what
   *  is drawn on top. */
  test('is the end of a picked connector, before the card under it', () => {
    const ends = edgeEnds(EDGE, boxOf(NODES[0]!), boxOf(NODES[1]!))
    const picked = where({ picked: ['e'] })

    expect(hitAt(picked, ends.from)).toMatchObject({ endpoint: { id: 'e', end: 'from' } })
    expect(hitAt(picked, ends.to)).toMatchObject({ endpoint: { id: 'e', end: 'to' } })
  })

  test('is not an end of a connector nobody picked', () => {
    const ends = edgeEnds(EDGE, boxOf(NODES[0]!), boxOf(NODES[1]!))
    expect(hitAt(where(), ends.from).endpoint).toBeNull()
  })

  /** The chrome a selection wears is drawn over everything, so it is grabbed
   *  before anything under it. */
  test('is the handle before the card it sits on', () => {
    const box = boxOf(NODES[0]!)
    const picked = where({ picked: ['a'], box })

    expect(hitAt(picked, { x: box.x + box.width, y: box.y + box.height })).toMatchObject({
      handle: 'se',
    })
  })
})
