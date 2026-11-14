import { expect, test } from 'vitest'
import { grownOf } from './bubble'
import { cellAt, REACH } from './cells'

const cells = [
  { key: 'a', box: { x: 0, y: 0, w: 400, h: 300 } },
  { key: 'b', box: { x: 600, y: 0, w: 400, h: 300 } },
]

test('a window stays in its own cell near it, and plops into another nearer that one', () => {
  expect(cellAt(cells, 'a', 450, 100)).toBe('a')
  expect(cellAt(cells, 'a', 640, 100)).toBe('b')
  expect(cellAt(cells, 'b', 510, 100)).toBe('b')
  expect(cellAt(cells, 'b', 300, 100)).toBe('a')
})

test('never between cells or outside every one', () => {
  expect(cellAt(cells, 'a', 5000, 5000)).toBe('a')
  expect(cellAt(cells, 'b', -5000, 100)).toBe('b')
})

test('a cell of one small window is as easy to point into as a big one, right up to its window, at any zoom', () => {
  const big = { key: 'a', box: { x: 0, y: 0, w: 1200, h: 800 } }
  const small = { key: 'b', box: { x: 1290, y: 300, w: 160, h: 140 } }
  for (const zoom of [1, 0.5, 0.2]) {
    for (const [x, y] of [
      [1370, 370],
      [1292, 302],
      [1448, 438],
    ] as const) {
      expect(cellAt([big, small], 'a', x, y, zoom), `${String(zoom)} ${String(x)}`).toBe('b')
    }
    if (zoom >= 0.5) expect(cellAt([big, small], 'a', 1370, 300 + 140 + 50, zoom)).toBe('b')
  }
})

test('how far a cell reaches, and how hard it holds, are the same on the screen at every zoom', () => {
  const one = { key: 'a', box: { x: 0, y: 0, w: 200, h: 100 } }
  const other = { key: 'b', box: { x: 2000, y: 0, w: 200, h: 100 } }
  const bubble = grownOf(other.box)
  const edge = bubble.x + bubble.w
  for (const zoom of [1, 0.25]) {
    expect(cellAt([one, other], 'a', edge + (REACH - 4) / zoom, 50, zoom)).toBe('b')
    expect(cellAt([one, other], 'a', edge + (REACH + 4) / zoom, 50, zoom)).toBe('a')
  }
})
