import { expect, test } from 'vitest'
import { walk, wayOf } from './walk'

const box = (x: number, y: number) => ({ x, y, w: 100, h: 60 })

const boxes = [box(0, 0), box(120, 0), box(0, 80), box(400, 40)]

test('an arrow goes to the nearest window that way', () => {
  expect(walk(boxes, 0, 'right')).toBe(1)
  expect(walk(boxes, 0, 'down')).toBe(2)
  expect(walk(boxes, 1, 'right')).toBe(3)
  expect(walk(boxes, 3, 'left')).toBe(1)
})

test('with nothing that way it stays', () => {
  expect(walk(boxes, 0, 'left')).toBe(0)
  expect(walk(boxes, 0, 'up')).toBe(0)
})

test('only arrows are ways', () => {
  expect(wayOf('ArrowUp')).toBe('up')
  expect(wayOf('Enter')).toBe(null)
})
