import { describe, expect, test } from 'vitest'
import { RightPan, RIGHT_SLOP } from './right-pan'

const at = (
  x: number,
  y: number,
  more: Partial<{ button: number; pointerType: string; timeStamp: number }> = {},
) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 2,
  clientX: x,
  clientY: y,
  timeStamp: 0,
  ...more,
})

describe('the right mouse button held', () => {
  test('and moved past a few pixels pans by each move, and opens no menu', () => {
    const right = new RightPan()
    expect(right.down(at(100, 100))).toBe(true)

    expect(right.move(at(101, 101))).toBeNull()
    expect(right.move(at(100 + RIGHT_SLOP + 2, 100))).toEqual({ dx: RIGHT_SLOP + 2, dy: 0 })
    expect(right.move(at(110, 130))).toEqual({ dx: 110 - (100 + RIGHT_SLOP + 2), dy: 30 })
    expect(right.up(at(110, 130, { timeStamp: 50 }))).toBe('panned')
  })

  test('let go where it was pressed is a right-click: the menu', () => {
    const right = new RightPan()
    right.down(at(10, 10))
    right.move(at(12, 11))

    expect(right.up(at(12, 11))).toBe('menu')
  })

  test('owns the menu the engine asks for while held and just after, but not a key asking later', () => {
    const right = new RightPan()
    expect(right.ownsMenu(0)).toBe(false)
    right.down(at(10, 10))
    expect(right.ownsMenu(5)).toBe(true)
    right.up(at(10, 10, { timeStamp: 100 }))
    expect(right.ownsMenu(200)).toBe(true)
    expect(right.ownsMenu(5000)).toBe(false)
  })

  test('the left button, a pen or a finger is none of its business', () => {
    const right = new RightPan()
    expect(right.down(at(0, 0, { button: 0 }))).toBe(false)
    expect(right.down(at(0, 0, { pointerType: 'pen' }))).toBe(false)
    expect(right.down(at(0, 0, { pointerType: 'touch' }))).toBe(false)
    expect(right.move(at(50, 50))).toBeNull()
    expect(right.up(at(50, 50))).toBeNull()
  })
})
