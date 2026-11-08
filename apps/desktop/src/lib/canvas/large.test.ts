import { describe, expect, test } from 'vitest'
import { linearly } from '../../../../../scripts/growth'
import { aligned, distributed } from './arrange'
import { movedBy, reach, removed, subset } from './edits'
import type { Canvas, CanvasNode, InkStroke } from './format'
import { hitAt } from './hit'

const planes = new Map<number, Canvas>()

function plane(count: number): Canvas {
  const held = planes.get(count)
  if (held) return held

  const cards: CanvasNode[] = Array.from({ length: count }, (_, at) => ({
    id: `c${at}`,
    type: 'text',
    x: (at % 50) * 300,
    y: Math.floor(at / 50) * 200,
    width: 250,
    height: 150,
    text: `card ${at}`,
  }))
  const groups: CanvasNode[] = Array.from({ length: Math.ceil(count / 10) }, (_, at) => ({
    id: `g${at}`,
    type: 'group',
    x: (at % 5) * 3000 - 10,
    y: Math.floor(at / 5) * 200 - 10,
    width: 2990,
    height: 180,
  }))
  const ink: InkStroke[] = Array.from({ length: count }, (_, at) => ({
    id: `s${at}`,
    tool: 'pen',
    color: '#000000',
    size: 2,
    points: [
      {
        x: (at % 50) * 300 + 20,
        y: Math.floor(at / 50) * 200 + 20,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: 0,
      },
      {
        x: (at % 50) * 300 + 60,
        y: Math.floor(at / 50) * 200 + 40,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: 1,
      },
    ],
  }))
  const edges = cards.map((card, at) => ({
    id: `e${at}`,
    fromNode: card.id,
    toNode: `c${(at + 1) % count}`,
  }))

  const made: Canvas = { nodes: [...groups, ...cards], edges, ink, at: {}, gone: {} }
  planes.set(count, made)
  return made
}

const everything = (canvas: Canvas) => [
  ...canvas.nodes.map((node) => node.id),
  ...canvas.edges.map((edge) => edge.id),
  ...canvas.ink.map((stroke) => stroke.id),
]

describe('a plane of thousands of cards, all picked, in groups', () => {
  test('carries every group’s cards and ink along', () => {
    const canvas = plane(100)
    const going = reach(canvas, ['g0'])

    expect([...going].filter((id) => id.startsWith('c')).sort()).toEqual(
      ['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'].sort(),
    )
    expect(going.has('s0')).toBe(true)
    expect(going.has('c10')).toBe(false)
  })

  test('moves in time that grows with the plane, not its square', () => {
    linearly((count) => movedBy(plane(count), everything(plane(count)), 5, 5), 3200)
  })

  test('lines up and spreads out in time that grows with the plane', () => {
    linearly((count) => aligned(plane(count), everything(plane(count)), 'left'), 3200)
    linearly((count) => distributed(plane(count), everything(plane(count)), 'x'), 3200)
  })

  test('is deleted and copied in time that grows with the plane', () => {
    linearly((count) => removed(plane(count), everything(plane(count))), 3200)
    linearly((count) => subset(plane(count), everything(plane(count))), 3200)
  })

  test('answers the pointer in time that grows with the plane', () => {
    linearly(
      (count) =>
        hitAt(
          {
            canvas: plane(count),
            picked: everything(plane(count)),
            box: null,
            scale: 1,
            ported: null,
            coarse: false,
            lassoed: false,
          },
          { x: -5000, y: -5000 },
        ),
      3200,
    )
  })
})
