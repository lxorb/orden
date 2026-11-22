import { describe, expect, test } from 'vitest'
import type { Canvas, CanvasEdge, CanvasNode, Side } from '@orden/markdown/canvas'
import { edgeEnds, edgeMiddle, boxOf, SIDES, sidePoint } from '../../plane/src/api'
import { hitAt, type Where } from './hit'

const card = (id: string, x: number, y: number): CanvasNode => ({
  id,
  type: 'text',
  x,
  y,
  width: 250,
  height: 60,
  text: id,
})
const NODES = [card('a', 0, 0), card('b', 600, 400)]
const EDGE: CanvasEdge = { id: 'e', fromNode: 'a', toNode: 'b' }
const CANVAS: Canvas = { nodes: NODES, edges: [EDGE], ink: [], at: {}, gone: {} }
const where = (over: Partial<Where> = {}): Where => ({
  canvas: CANVAS,
  picked: [],
  box: null,
  scale: 1,
  ported: null,
  ports: true,
  coarse: false,
  lassoed: false,
  ...over,
})
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
describe('the dots an arrow is drawn from (#2501)', () => {
  const big: CanvasNode = { ...card('big', 0, 0), width: 400, height: 200 }
  const canvas: Canvas = { ...CANVAS, nodes: [big], edges: [] }
  const out = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } }
  const off = (side: Side, screen: number, scale: number) => {
    const at = sidePoint(boxOf(big), side)
    return { x: at.x + (out[side].x * screen) / scale, y: at.y + (out[side].y * screen) / scale }
  }
  for (const scale of [0.25, 1, 4]) {
    for (const side of SIDES) {
      test(`start an arrow from up to 11 px off the ${side} middle at ${scale}x, hovered or not`, () => {
        for (const ported of [null, 'big']) {
          const at = where({ canvas, scale, ported })
          for (const screen of [11, 6, 0, -3]) {
            expect(hitAt(at, off(side, screen, scale)).port).toEqual({ id: 'big', side })
          }
          const along = side === 'top' || side === 'bottom' ? { x: 8 / scale, y: 0 } : { x: 0, y: 8 / scale }
          const beside = off(side, 8, scale)
          expect(hitAt(at, { x: beside.x + along.x, y: beside.y + along.y }).port).toEqual({ id: 'big', side })
        }
      })
      test(`leave the card body and the plane past the dot alone at ${scale}x off the ${side} middle`, () => {
        const at = where({ canvas, scale, ported: 'big' })
        expect(hitAt(at, off(side, -6, scale))).toMatchObject({ port: null, node: 'big' })
        expect(hitAt(at, off(side, 14, scale)).port).toBeNull()
      })
    }
  }
  test('are not there while something else is going on', () => {
    expect(hitAt(where({ canvas, ports: false }), off('top', 0, 1)).port).toBeNull()
  })
  test('leave an arrow passing near the dot to the arrow, but not the dot itself', () => {
    const left: CanvasNode = { ...card('left', -700, -40), width: 200 }
    const right: CanvasNode = { ...card('right', 1100, -40), width: 200 }
    const passing: CanvasEdge = { id: 'past', fromNode: 'left', toNode: 'right' }
    const crowded: Canvas = { ...CANVAS, nodes: [big, left, right], edges: [passing] }
    const at = where({ canvas: crowded, ported: 'big' })
    expect(hitAt(at, { x: 200, y: -10 })).toMatchObject({ port: null, edge: 'past' })
    expect(hitAt(at, { x: 200, y: -5 }).port).toEqual({ id: 'big', side: 'top' })
  })
  test('keep the arrows that end at the dot from taking a press around it', () => {
    const below: CanvasNode = { ...card('below', 75, 600), width: 250 }
    const ending: CanvasEdge = { id: 'in', fromNode: 'big', fromSide: 'bottom', toNode: 'below', toSide: 'top' }
    const crowded: Canvas = { ...CANVAS, nodes: [big, below], edges: [ending] }
    expect(hitAt(where({ canvas: crowded }), { x: 200, y: 210 }).port).toEqual({ id: 'big', side: 'bottom' })
  })
  test('do not take a press on the card beside the one they belong to', () => {
    const beside: CanvasNode = { ...card('beside', 404, 50), width: 250, height: 600 }
    const crowded: Canvas = { ...CANVAS, nodes: [big, beside], edges: [] }
    expect(hitAt(where({ canvas: crowded, ported: 'big' }), { x: 408, y: 100 })).toMatchObject({
      port: null,
      node: 'beside',
    })
  })
})
