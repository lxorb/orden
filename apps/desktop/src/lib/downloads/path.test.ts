import { describe, expect, test } from 'vitest'
import {
  arcOf,
  cornerOf,
  flightMs,
  framesOf,
  landing,
  PRESS_LASTS,
  startOf,
  type Glyph,
} from './path'

const AREA = { x: 0, y: 40, width: 1000, height: 600 }
const BUTTON = { x: 100, y: 100, width: 20, height: 20 }

function asked(change: Partial<Parameters<typeof startOf>[0]> = {}) {
  return { element: null, page: null, press: null, pressed: null, now: 1000, area: AREA, ...change }
}

describe('where a flight starts', () => {
  test('at the control it was asked for by', () => {
    const press = { target: null, x: 5, y: 5, at: 999 }
    expect(startOf(asked({ element: BUTTON, press }))).toEqual({ x: 110, y: 110 })
  })

  test('in the page, for a page that is saving a file', () => {
    const press = { target: null, x: 5, y: 5, at: 999 }
    expect(startOf(asked({ page: { x: 500, y: 300 }, press }))).toEqual({ x: 500, y: 300 })
  })

  test('at the pressed element, if it is still on screen', () => {
    const press = { target: null, x: 5, y: 5, at: 999 }
    expect(startOf(asked({ press, pressed: BUTTON }))).toEqual({ x: 110, y: 110 })
  })

  test('where the pointer was, once the element has gone', () => {
    const press = { target: null, x: 5, y: 7, at: 999 }
    expect(startOf(asked({ press }))).toEqual({ x: 5, y: 7 })
  })

  test('in the middle of the panes for a key with nothing left on screen', () => {
    const press = { target: null, x: null, y: null, at: 999 }
    expect(startOf(asked({ press }))).toEqual({ x: 500, y: 340 })
  })

  test('and not at a press from long ago', () => {
    const press = { target: null, x: 5, y: 7, at: 0 }
    expect(startOf(asked({ press, now: PRESS_LASTS + 1 }))).toEqual({ x: 500, y: 340 })
  })
})

describe('where a flight lands', () => {
  const box = { x: 0, y: 0, width: 28, height: 28 }
  const glyph = (tab: string | null, focused = false): Glyph => ({ box, tab, focused })

  test('in the bar of the tab saving the file', () => {
    const own = glyph('b')
    expect(landing([glyph('a', true), own], 'b')).toBe(own)
  })

  test('else in the pane with the focus', () => {
    const focused = glyph('c', true)
    expect(landing([glyph('a'), focused], 'gone')).toBe(focused)
    expect(landing([glyph('a'), focused], null)).toBe(focused)
  })

  test('else on any glyph on screen, and on none when there is none', () => {
    const first = glyph('a')
    expect(landing([first, glyph('b')], null)).toBe(first)
    expect(landing([], 'a')).toBeNull()
  })

  test('and with no glyph, in the corner at the end of the strip', () => {
    expect(cornerOf({ width: 1000, height: 600 })).toEqual({ x: 968, y: 32 })
  })
})

describe('the flight', () => {
  const from = { x: 500, y: 400 }
  const to = { x: 960, y: 20 }

  test('takes 400 to 600 milliseconds, longer the further it goes', () => {
    expect(flightMs(from, from)).toBe(400)
    expect(flightMs({ x: 0, y: 0 }, { x: 5000, y: 0 })).toBe(600)
    const near = flightMs(from, { x: 520, y: 380 })
    const far = flightMs(from, to)
    expect(near).toBeLessThan(far)
  })

  test('is an arc from one end to the other that rises above both', () => {
    const points = arcOf(from, to)
    expect(points[0]).toEqual(from)
    expect(points.at(-1)?.x).toBeCloseTo(to.x)
    expect(points.at(-1)?.y).toBeCloseTo(to.y)
    expect(Math.min(...points.map((one) => one.y))).toBeLessThan(to.y)
  })

  test('moves only a transform and an opacity, so the compositor draws it', () => {
    const frames = framesOf(from, to, true)
    expect(frames.length).toBeGreaterThan(8)
    for (const frame of frames) {
      expect(Object.keys(frame).sort()).toEqual(['offset', 'opacity', 'transform'])
    }
    expect(frames[0]?.offset).toBe(0)
    expect(frames.at(-1)?.offset).toBe(1)
    expect(frames.at(-1)?.opacity).toBe('0')
  })
})
