// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { ctrlWheelZoom, heldGestures, NOTCH, pinching } from './camera'

/** A trackpad pinch zooms a canvas and a page note with the fingers (#410): as the
 *  Ctrl-wheel Chromium and WebView2 send for one, and as the gestures WebKit sends on a
 *  Mac. A wheel's notch with Ctrl held is still `NOTCH`. */

/** A pinch to `span` times the fingers' distance, as Chromium sends it: in steps of a
 *  hundred times the log of each step's own scale. */
function pinchSteps(span: number, steps = 12): { deltaY: number; deltaMode: number }[] {
  const each = Math.log(span) / steps
  return Array.from({ length: steps }, () => ({ deltaY: -100 * each, deltaMode: 0 }))
}

describe('Ctrl and the wheel', () => {
  test('a pinch to twice the span is twice the size, and back to half is half', () => {
    const out = pinchSteps(2).reduce((scale, one) => scale * ctrlWheelZoom(one), 1)
    expect(out).toBeCloseTo(2, 6)
    const back = pinchSteps(0.5).reduce((scale, one) => scale * ctrlWheelZoom(one), 1)
    expect(back).toBeCloseTo(0.5, 6)
  })

  test('a wheel’s notch is a notch, at a display’s own scale too', () => {
    expect(ctrlWheelZoom({ deltaY: -100, deltaMode: 0 })).toBeCloseTo(NOTCH, 10)
    expect(ctrlWheelZoom({ deltaY: 100, deltaMode: 0 })).toBeCloseTo(1 / NOTCH, 10)
    // A notch at 150 per cent, as Chromium on Windows sends it.
    expect(ctrlWheelZoom({ deltaY: -200 / 3, deltaMode: 0 })).toBeLessThan(NOTCH)
    expect(ctrlWheelZoom({ deltaY: -200 / 3, deltaMode: 0 })).toBeGreaterThan(1)
    // A wheel counted in lines is a wheel.
    expect(ctrlWheelZoom({ deltaY: -3.5, deltaMode: 1 })).toBeLessThan(1.1)
  })
})

describe('a Mac’s pinch', () => {
  function gesture(type: string, scale: number, x = 40, y = 60): Event {
    return Object.assign(new Event(type, { cancelable: true }), { scale, clientX: x, clientY: y })
  }

  test('zooms by what the fingers moved since the last change, about where they are', () => {
    const element = document.createElement('div')
    const zooms: [number, number, number][] = []
    const stop = heldGestures(element, (at, by) => zooms.push([at.clientX, at.clientY, by]))

    const began = gesture('gesturestart', 1)
    element.dispatchEvent(began)
    expect(began.defaultPrevented).toBe(true)
    expect(pinching()).toBe(true)
    for (const scale of [1.25, 1.5, 3]) element.dispatchEvent(gesture('gesturechange', scale))
    element.dispatchEvent(gesture('gestureend', 3))
    expect(pinching()).toBe(false)

    expect(zooms.map(([x, y]) => [x, y])).toEqual([
      [40, 60],
      [40, 60],
      [40, 60],
    ])
    expect(zooms.reduce((scale, [, , by]) => scale * by, 1)).toBeCloseTo(3, 10)
    stop()
    element.dispatchEvent(gesture('gesturechange', 4))
    expect(zooms).toHaveLength(3)
  })
})
