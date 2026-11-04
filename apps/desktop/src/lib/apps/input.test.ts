import { describe, expect, test } from 'vitest'
import { displayPoint, keyEvent, wheelClicks } from './input'

/** What the holder does over an application's picture, as its host is sent it (issue
 *  1063, step 4; input.ts). */

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height }) as DOMRectReadOnly

describe('the point under the pointer', () => {
  test('is the display’s own pixel, through the scale the picture is drawn at', () => {
    // A 2560 by 1600 display in a pane of 1280 by 800 CSS pixels: two to one.
    expect(displayPoint(100, 50, box(0, 0, 1280, 800), 2560, 1600)).toEqual({ x: 200, y: 100 })
  })

  test('leaves out the bands round a picture of another shape, and keeps to the display', () => {
    // A square display in a wide pane is drawn in its middle.
    expect(displayPoint(400, 300, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 300, y: 300 })
    expect(displayPoint(10, 300, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 0, y: 300 })
    expect(displayPoint(799, 599, box(0, 0, 800, 600), 600, 600)).toEqual({ x: 599, y: 599 })
  })

  test('is nowhere before the picture has a size', () => {
    expect(displayPoint(1, 1, box(0, 0, 800, 600), 0, 0)).toBeNull()
  })
})

describe('the wheel', () => {
  test('makes a click a notch, and keeps what is left over for the next turn', () => {
    const first = wheelClicks({ x: 0, y: 0 }, 0, 150, 0)
    expect(first).toEqual({ x: 0, y: 1, left: { x: 0, y: 0.5 } })
    const second = wheelClicks(first.left, -30, 60, 0)
    expect(second.y).toBe(1)
    expect(second.x).toBe(0)
    expect(second.left.y).toBeCloseTo(0.1)
    expect(second.left.x).toBeCloseTo(-0.3)
  })

  test('counts lines three to a click', () => {
    expect(wheelClicks({ x: 0, y: 0 }, 0, -6, 1)).toEqual({ x: 0, y: -2, left: { x: 0, y: 0 } })
  })
})

describe('a key', () => {
  test('is sent by what it gave and the key it was', () => {
    expect(keyEvent({ key: 'ä', code: 'Quote', isComposing: false }, true)).toEqual({
      t: 'key',
      key: 'ä',
      code: 'Quote',
      down: true,
    })
  })

  test('is not pressed mid-composition or when the engine cannot name it, but always let go', () => {
    expect(keyEvent({ key: 'a', code: 'KeyA', isComposing: true }, true)).toBeNull()
    expect(keyEvent({ key: 'Dead', code: 'BracketLeft', isComposing: false }, true)).toBeNull()
    expect(keyEvent({ key: 'Dead', code: 'BracketLeft', isComposing: false }, false)).toEqual({
      t: 'key',
      key: 'Dead',
      code: 'BracketLeft',
      down: false,
    })
  })
})
