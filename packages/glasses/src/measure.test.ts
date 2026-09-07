import { describe, expect, test } from 'vitest'
import { edgeOf, type Painted } from './measure'

/** A box, with whatever of it matters here. */
function box(right: number, bottom: number, rest: Partial<Painted> = {}): Painted {
  return { right, bottom, clips: false, children: [], ...rest }
}

const NOWHERE = { right: 0, bottom: 0 }

describe('how far a formula paints', () => {
  test('answers where it started when there is nothing in it', () => {
    expect(edgeOf([], { right: 12, bottom: 34 })).toEqual({ right: 12, bottom: 34 })
  })

  test('never comes back narrower than it was asked from', () => {
    // The marker says where inline layout thinks the formula ends, and that is
    // the floor: a box may reach past it, never short of it.
    expect(edgeOf([box(5, 5)], { right: 40, bottom: 20 })).toEqual({ right: 40, bottom: 20 })
  })

  /** Why the walk exists at all. */
  test('reaches past a box that is narrower than what it holds', () => {
    // KaTeX draws a big delimiter with negative margins, so the box shrunk to
    // fit around it comes out narrower than the glyph inside. Measured by the
    // outermost box, the last symbol of a formula falls outside the picture.
    const delimiter = box(100, 50, { children: [box(140, 70)] })

    expect(edgeOf([delimiter], NOWHERE)).toEqual({ right: 140, bottom: 70 })
  })

  test('goes as deep as it has to', () => {
    const deep = box(10, 10, {
      children: [box(20, 20, { children: [box(30, 60, { children: [box(90, 15)] })] })],
    })

    expect(edgeOf([deep], NOWHERE)).toEqual({ right: 90, bottom: 60 })
  })

  /** Why the walk stops.
   *
   *  A square root's tail is an SVG path about nine thousand pixels wide inside
   *  an `svg` that hides its overflow. Counted, a formula with a root in it
   *  measures fifty times too wide, the layout scales it down to fit the column,
   *  and an equation comes out as a few lit pixels. */
  test('does not count what a clipped box is hiding', () => {
    const surd = box(34, 30, { clips: true, children: [box(9215, 30)] })

    expect(edgeOf([surd], NOWHERE)).toEqual({ right: 34, bottom: 30 })
  })

  test('still counts the clipped box itself', () => {
    const surd = box(34, 30, { clips: true, children: [box(9215, 9000)] })

    expect(edgeOf([surd], { right: 10, bottom: 10 })).toEqual({ right: 34, bottom: 30 })
  })

  test('keeps measuring what is beside the clipped box', () => {
    // The root is one term of an equation; the rest of it still has to fit.
    const surd = box(34, 30, { clips: true, children: [box(9215, 30)] })
    const after = box(177, 62)

    expect(edgeOf([surd, after], NOWHERE)).toEqual({ right: 177, bottom: 62 })
  })

  test('stops at the clip however deep it is', () => {
    const nested = box(20, 20, {
      children: [box(30, 30, { clips: true, children: [box(9000, 9000)] })],
    })

    expect(edgeOf([nested], NOWHERE)).toEqual({ right: 30, bottom: 30 })
  })
})
