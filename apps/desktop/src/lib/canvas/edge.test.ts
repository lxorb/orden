import { describe, expect, test } from 'vitest'
import { heldAtEdge, INSET } from './edge'

/** A hand off the screen is held at the screen's edge and points the way to it,
 *  whatever the camera is doing (#386). */

const WIDTH = 800
const HEIGHT = 600
const still = { x: 0, y: 0, scale: 1 }

/** Where a held hand is on the screen, in pixels, for a camera. */
function onScreen(at: { x: number; y: number }, camera = still) {
  return {
    x: WIDTH / 2 + (at.x - camera.x) * camera.scale,
    y: HEIGHT / 2 + (at.y - camera.y) * camera.scale,
  }
}

describe('a hand on the screen', () => {
  test('is drawn where it is', () => {
    expect(heldAtEdge({ x: 0, y: 0 }, still, WIDTH, HEIGHT)).toBeNull()
    expect(heldAtEdge({ x: 399, y: -299 }, still, WIDTH, HEIGHT)).toBeNull()
  })

  test('and so is one just over the edge, whose dot still shows', () => {
    expect(heldAtEdge({ x: 402, y: 0 }, still, WIDTH, HEIGHT)).toBeNull()
  })

  test('before the surface has a size, nothing is held anywhere', () => {
    expect(heldAtEdge({ x: 5000, y: 0 }, still, 0, 0)).toBeNull()
  })
})

describe('a hand off the screen', () => {
  test('far to the right is held at the right edge, level with it, pointing right', () => {
    const held = heldAtEdge({ x: 3000, y: 40 }, still, WIDTH, HEIGHT)

    expect(held).not.toBeNull()
    expect(onScreen(held!.at)).toEqual({ x: WIDTH - INSET.right, y: HEIGHT / 2 + 40 })
    expect(held!.angle).toBeCloseTo(0)
    // Its name reads inwards, to the left of the arrow.
    expect(held!.anchor).toBe('end')
    expect(held!.baseline).toBe('middle')
  })

  test('above is held at the top, pointing up, with its name under the arrow', () => {
    const held = heldAtEdge({ x: -100, y: -5000 }, still, WIDTH, HEIGHT)

    expect(onScreen(held!.at)).toEqual({ x: WIDTH / 2 - 100, y: INSET.top })
    expect(held!.angle).toBeCloseTo(-90)
    expect(held!.anchor).toBe('middle')
    expect(held!.baseline).toBe('hanging')
  })

  test('below is held clear of the bar at the foot', () => {
    const held = heldAtEdge({ x: 0, y: 5000 }, still, WIDTH, HEIGHT)

    expect(onScreen(held!.at).y).toBe(HEIGHT - INSET.bottom)
    expect(held!.angle).toBeCloseTo(90)
    expect(held!.baseline).toBe('auto')
  })

  test('off a corner is held in that corner and points into it', () => {
    const held = heldAtEdge({ x: -9000, y: -9000 }, still, WIDTH, HEIGHT)

    expect(onScreen(held!.at)).toEqual({ x: INSET.left, y: INSET.top })
    expect(held!.angle).toBeCloseTo(-135, 0)
    expect(held!.anchor).toBe('start')
    expect(held!.baseline).toBe('hanging')
  })

  test('is held on the screen however far the camera is zoomed out or moved', () => {
    const away = { x: 20_000, y: -7_000, scale: 0.04 }
    const held = heldAtEdge({ x: 0, y: 0 }, away, WIDTH, HEIGHT)
    const shown = onScreen(held!.at, away)

    expect(shown.x).toBeCloseTo(INSET.left)
    expect(shown.y).toBeGreaterThanOrEqual(INSET.top)
    expect(shown.y).toBeLessThanOrEqual(HEIGHT - INSET.bottom)
  })

  test('on a surface smaller than its margins is held in the middle', () => {
    const held = heldAtEdge({ x: 900, y: 0 }, still, 30, 60)
    const at = { x: 15 + held!.at.x, y: 30 + held!.at.y }

    expect(at).toEqual({ x: 15, y: 30 })
  })
})
