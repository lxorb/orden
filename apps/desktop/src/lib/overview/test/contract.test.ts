import { describe, expect, test } from 'vitest'
import { around } from '../src/layout'
import { walk, wayOf } from '../src/walk'

describe('moving among the windows', () => {
  const box = (x: number, y: number) => ({ x, y, w: 100, h: 60 })
  const boxes = [box(0, 0), box(120, 0), box(0, 80)]
  test('an arrow goes to the nearest window that way and stays when there is none', () => {
    expect(wayOf('ArrowRight')).toBe('right')
    expect(wayOf('Tab')).toBeNull()
    expect(walk(boxes, 0, 'right')).toBe(1)
    expect(walk(boxes, 0, 'down')).toBe(2)
    expect(walk(boxes, 0, 'left')).toBe(0)
  })
  test('the box around the windows holds every one of them', () => {
    expect(around([])).toBeNull()
    expect(around(boxes)).toEqual({ x: 0, y: 0, w: 220, h: 140 })
  })
})
