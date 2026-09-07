/** How wide a piece of text is, asked rather than answered.
 *
 *  The layout has to know a width before it can break a line, and only
 *  something with the fonts in front of it can say. So it is handed in: the
 *  rasteriser measures against a real canvas, and a test measures against a
 *  ruler it wrote itself, and the layout is the same code in both cases and has
 *  no DOM in it at all. */

import { LINE_RATIO } from './panel'
import type { TextStyle } from './style'

export interface Box {
  width: number
  height: number
}

/** A formula's box, and how far of it hangs below the baseline. Without the
 *  depth an inline formula sits on the line rather than in it, and a fraction
 *  floats a third of a line above the words around it. */
export interface MathBox extends Box {
  depth: number
}

/** How far right and how far down something reaches. */
export interface Edge {
  right: number
  bottom: number
}

/** A box as `edgeOf` sees it: where it ends, whether it keeps what overflows it
 *  to itself, and what is inside it.
 *
 *  Structural rather than a DOM element so that the rule below can be tested
 *  without a browser, which is the only way anything in this package is tested. */
export interface Painted {
  right: number
  bottom: number
  /** True when nothing inside can show outside. */
  clips: boolean
  children: readonly Painted[]
}

/** How far a tree of boxes actually paints, which is not the same as how far it
 *  reaches.
 *
 *  The walk exists because a box is not always as wide as what it holds: KaTeX
 *  draws a big delimiter with negative margins, and a box shrunk to fit around
 *  one comes out narrower than its own contents, so a formula measured by its
 *  outermost box loses its last symbol off the edge of the picture.
 *
 *  It stops at anything that clips because of the opposite trap. KaTeX draws a
 *  square root's tail as an SVG path several hundred em wide inside an `svg`
 *  that hides its overflow. Asked for its rectangle that path answers about nine
 *  thousand pixels, so a formula with a root in it measured fifty times too
 *  wide, and the layout, doing as it was told, scaled the whole formula down to
 *  fit the column and left a few lit pixels where an equation should have been.
 *  A clipped box's children cannot show outside it, so they are not asked. */
export function edgeOf(boxes: readonly Painted[], from: Edge): Edge {
  let { right, bottom } = from

  for (const box of boxes) {
    right = Math.max(right, box.right)
    bottom = Math.max(bottom, box.bottom)
    if (box.clips) continue

    const inside = edgeOf(box.children, { right, bottom })
    right = inside.right
    bottom = inside.bottom
  }

  return { right, bottom }
}

export interface Measurer {
  /** How much room `text` takes in `style`, in pixels. */
  width(text: string, style: TextStyle): number
  /** How far the face reaches above the baseline at this size. */
  ascent(style: TextStyle): number
  /** How far below. */
  descent(style: TextStyle): number
  /** The box a formula draws in, and how much of it is below the baseline. */
  math(tex: string, display: boolean): MathBox
  /** The box a picture draws in, at most `most` big, or null when nothing is
   *  known about it - a path the app cannot resolve, an address off the net. */
  picture(source: string, most: Box): Box | null
}

/** The air between one line's descent and the next line's ascent. Taken from
 *  the size of the tallest thing on the line, so a heading breathes more than a
 *  line of prose. */
export function leadingOf(size: number): number {
  return Math.round(size * (LINE_RATIO - 1))
}

/** A measurer built on a fixed advance per character, for tests and for the
 *  first layout of a note before the fonts have arrived.
 *
 *  The advances are the ones the app's own faces come out at, measured once:
 *  the content face averages 0.5 of its size across English prose, the mono
 *  face is 0.6 by construction, and bold is a hair wider. Rough, and honest
 *  about it: what it is for is a page count that is right and a line that is
 *  never wildly over the edge. */
export function ruler(): Measurer {
  const advance = (style: TextStyle) => {
    const base = style.family === 'mono' ? 0.6 : 0.5
    return style.size * (style.weight === 'bold' ? base * 1.04 : base)
  }

  return {
    width: (text, style) => text.length * advance(style),
    ascent: (style) => style.size * 0.8,
    descent: (style) => style.size * 0.2,
    // A formula is about as wide as its source and a line and a half tall,
    // which is what KaTeX comes out at for the arithmetic in a note. A quarter
    // of an inline one hangs below the line, which is where a subscript goes.
    math: (tex, display) => ({
      width: tex.length * (display ? 9 : 7),
      height: display ? 28 : 18,
      depth: display ? 0 : 4,
    }),
    picture: (_source, most) => ({ width: most.width, height: most.height }),
  }
}
