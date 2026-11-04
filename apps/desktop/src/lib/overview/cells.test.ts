import { expect, test } from 'vitest'
import { cellAt } from './cells'

const cells = [
  { key: 'a', box: { x: 0, y: 0, w: 400, h: 300 } },
  { key: 'b', box: { x: 600, y: 0, w: 400, h: 300 } },
]

test('a window stays in its own cell near it, and plops into another well inside that one', () => {
  expect(cellAt(cells, 'a', 450, 100)).toBe('a')
  expect(cellAt(cells, 'a', 640, 100)).toBe('b')
  // On the way back, it stays in the cell it plopped into until it is clear of it.
  expect(cellAt(cells, 'b', 520, 100)).toBe('b')
  expect(cellAt(cells, 'b', 300, 100)).toBe('a')
})

test('never between cells or outside every one', () => {
  expect(cellAt(cells, 'a', 5000, 5000)).toBe('a')
})
