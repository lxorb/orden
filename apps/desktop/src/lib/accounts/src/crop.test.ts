import { describe, expect, test } from 'vitest'
import { clampOffset, MOST_ZOOM, scaleAt, sourceSquare, turned, wheeledZoom, zoomed } from './crop'

const VIEW = 240

describe('the avatar sheet’s window', () => {
  test('at zoom 1 just fills the window with the picture’s shorter side', () => {
    expect(scaleAt(1200, 800, VIEW, 1)).toBe(0.3)
    expect(sourceSquare({ zoom: 1, offset: { x: 0, y: 0 } }, 1200, 800, VIEW)).toEqual({
      left: 200,
      top: 0,
      side: 800,
    })
  })

  test('never leaves a corner of the window uncovered', () => {
    expect(clampOffset({ x: 999, y: 50 }, 1200, 800, VIEW, 1)).toEqual({ x: 60, y: 0 })
    expect(clampOffset({ x: -999, y: -50 }, 1200, 800, VIEW, 1)).toEqual({ x: -60, y: 0 })
  })

  test('shows the part of the picture that was dragged into it', () => {
    expect(sourceSquare({ zoom: 1, offset: { x: -60, y: 0 } }, 1200, 800, VIEW)).toEqual({
      left: 400,
      top: 0,
      side: 800,
    })
  })

  test('zooms about the point under the pointer, which stays where it was', () => {
    const before = { zoom: 1, offset: { x: 0, y: 0 } }
    const at = { x: 60, y: 60 }
    const after = zoomed(before, 2, at, 800, 800, VIEW)

    const under = (crop: typeof before) => {
      const scale = scaleAt(800, 800, VIEW, crop.zoom)
      return { x: 400 + (at.x - crop.offset.x) / scale, y: 400 + (at.y - crop.offset.y) / scale }
    }
    expect(after.zoom).toBe(2)
    expect(under(after)).toEqual(under(before))
  })

  test('stays between zoom 1 and its most', () => {
    const start = { zoom: 1, offset: { x: 0, y: 0 } }
    expect(zoomed(start, 0.2, { x: 0, y: 0 }, 800, 800, VIEW).zoom).toBe(1)
    expect(zoomed(start, 99, { x: 0, y: 0 }, 800, 800, VIEW).zoom).toBe(MOST_ZOOM)
  })

  test('crops a square a quarter of the size at zoom 4', () => {
    expect(sourceSquare({ zoom: 4, offset: { x: 0, y: 0 } }, 800, 800, VIEW)).toEqual({
      left: 300,
      top: 300,
      side: 200,
    })
  })

  test('turns a picture on its side by swapping its sides', () => {
    expect(turned(1200, 800, 0)).toEqual([1200, 800])
    expect(turned(1200, 800, 1)).toEqual([800, 1200])
    expect(turned(1200, 800, 2)).toEqual([1200, 800])
    expect(turned(1200, 800, 3)).toEqual([800, 1200])
  })
})

describe('the wheel over the picture', () => {
  test('zooms as far for a wheel counted in lines, as Firefox counts one, as for pixels', () => {
    expect(wheeledZoom(1, { deltaY: -3, deltaMode: 1 })).toBeCloseTo(
      wheeledZoom(1, { deltaY: -120, deltaMode: 0 }),
      10,
    )
    expect(wheeledZoom(1, { deltaY: -120, deltaMode: 0 })).toBeGreaterThan(1.3)
  })
})
