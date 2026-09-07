/** How every kind of text is drawn.
 *
 *  The panel has three faces to work with and sixteen greys, so the whole of
 *  the app's typography has to come out of size, weight, slant, brightness and
 *  an underline. What is here is the translation: the app's own faces by the
 *  names the theme tokens give them, the app's heading scale flattened onto a
 *  panel a fifth as tall as a window, and the muted greys that a rule, a quote
 *  bar and a code box are drawn in. */

import type { Slant, Weight } from './grey'
import { BODY_SIZE, WHITE } from './panel'

/** Which of the app's three faces. The stacks themselves live in `fonts.ts`,
 *  because only the side that talks to a canvas needs them. */
export type Family = 'content' | 'mono' | 'ui'

export interface TextStyle {
  family: Family
  /** In pixels on the panel. */
  size: number
  weight: Weight
  slant: Slant
  /** 0 to 15; see panel.ts. */
  grey: number
  underline: boolean
  strike: boolean
}

export const BODY: TextStyle = {
  family: 'content',
  size: BODY_SIZE,
  weight: 'normal',
  slant: 'normal',
  grey: WHITE,
  underline: false,
  strike: false,
}

/** Headings, by level.
 *
 *  The app's own scale is far steeper, and it has a window to be steep in. Here
 *  an h1 that took two and a half lines of body text would cost a fifth of the
 *  page, so the scale is compressed and the weight carries what the size used
 *  to: every heading is bold, which on glass reads as a heading faster than
 *  size does. */
const HEADING_SIZES: readonly number[] = [23, 20, 18, 17, 16, 16]

export function headingStyle(level: number): TextStyle {
  const size = HEADING_SIZES[Math.min(HEADING_SIZES.length, Math.max(1, level)) - 1] ?? BODY_SIZE
  return { ...BODY, size, weight: 'bold' }
}

/** Inline code, and the box drawn behind it. A little smaller than the prose
 *  around it, the way the app sets it, so a mono face beside a proportional one
 *  does not look oversized. */
const INLINE_CODE_SIZE = Math.round(BODY_SIZE * 0.94)

export function inlineCodeStyle(): TextStyle {
  return {
    family: 'mono',
    size: INLINE_CODE_SIZE,
    weight: 'normal',
    slant: 'normal',
    grey: 13,
    underline: false,
    strike: false,
  }
}

/** A fence's own size. The same as prose rather than a step under it: a fence
 *  set smaller than the words around it is the hardest thing on the panel to
 *  read, and a line of code that wraps is a smaller price than a line of code
 *  nobody can make out. The measure still fits about seventy mono characters. */
export const CODE_SIZE = BODY_SIZE

/** The greys that are not text: a rule, the bar beside a quote, a table's grid.
 *
 *  Furniture may sit under the floor that words keep, because furniture is
 *  read by being noticed rather than by being made out - but only just under.
 *  These were two and three, which on a real panel is nothing at all: the bar
 *  beside a quote was not there, and the box behind inline code was a rumour.
 *
 *  The fence's own background is gone. It never separated a fence from the
 *  prose the way the mono face already does, and a dark wash under light text is
 *  the one thing a see-through panel cannot draw: it has no ink, so a background
 *  can only add light behind the letters and take contrast away. */
export const FURNITURE = {
  rule: 7,
  quoteBar: 9,
  codeBox: 6,
  tableGrid: 8,
  /** The bullet or number in front of a list item. */
  marker: 12,
  /** A fence has no ground of its own; the face and the greys carry it. */
  codeBlock: 0,
} as const

/** Prose that is quieter than the note around it: a quote, a caption, the
 *  brackets of a footnote. */
export const MUTED_GREY = 12
