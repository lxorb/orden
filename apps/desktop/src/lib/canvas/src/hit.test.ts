import { describe, expect, test } from 'vitest'
import type { Canvas, CanvasEdge, CanvasNode } from '@orden/markdown/canvas'
import { edgeEnds, edgeMiddle, boxOf } from '../../plane/src/api'
import { hitAt, type Where } from './hit'

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

  test('is the handle before the card it sits on', () => {
    const box = boxOf(NODES[0]!)
    const picked = where({ picked: ['a'], box })

    expect(hitAt(picked, { x: box.x + box.width, y: box.y + box.height })).toMatchObject({
      handle: 'se',
    })
  })
})

describe('what a point is on, over something locked in place', () => {
  const photo: CanvasNode = { ...card('photo', -50, -50), width: 400, height: 300, locked: true }

  test('is the card under it', () => {
    const canvas = { ...CANVAS, nodes: [...NODES, photo] }
    expect(hitAt(where({ canvas }), { x: 100, y: 30 })).toMatchObject({ node: 'a' })
  })

  test('is nothing where there is nothing under it', () => {
    const canvas = { ...CANVAS, nodes: [...NODES, photo] }
    expect(hitAt(where({ canvas }), { x: 300, y: 200 }).node).toBeNull()
  })
})

describe('a picked card too small on screen for its handles', () => {
  const box = { x: 0, y: 0, width: 250, height: 60 }

  test('is the card under a press in its middle, not a handle', () => {
    const far = where({ picked: ['a'], box, scale: 0.09 })
    expect(hitAt(far, { x: 125, y: 30 })).toMatchObject({ node: 'a', handle: null })
  })

  test('and near, the corner is the handle it always was', () => {
    const near = where({ picked: ['a'], box, scale: 1 })
    expect(hitAt(near, { x: 250, y: 60 }).handle).not.toBeNull()
  })
})
