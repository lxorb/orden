/** What a canvas colour looks like on screen.
 *
 *  The file says `"1"`; the six presets are tokens, so a theme restates them like
 *  any other colour and a canvas coloured in Obsidian arrives wearing the same
 *  six. A hex string is used as written, which is the other half of the format.
 *
 *  Cards and connectors are drawn by the browser, which understands `var(...)`.
 *  Ink is drawn on a 2d context, which does not, so the same six are also read
 *  off the theme as real colours once the surface is on the page. */

import { PRESET_COLOURS, type CanvasColour } from './format'
import type { Palette } from './paint'

/** The colour as CSS, or null for a card with no colour of its own, which wears
 *  the surface it is drawn on. */
export function shownColour(colour: CanvasColour | undefined): string | null {
  if (colour === undefined) return null
  if (PRESET_COLOURS.some((one) => one === colour)) return `var(--canvas-${colour})`

  return colour
}

/** What a pen writing in this colour looks like on screen.
 *
 *  Unlike a card's, a pen's colour is never absent: one with none of its own
 *  writes in the ink the words on the page are set in, and `ink` is the name for
 *  that rather than a colour any stylesheet could resolve. Said here so that
 *  every drawing of a pen answers it the same way; a `fill` of `ink` is not a
 *  colour at all, and a browser handed one paints black in both themes. */
export function shownInk(colour: string): string {
  if (colour === DEFAULT_INK) return 'var(--text-strong)'
  return shownColour(colour) ?? 'var(--text-strong)'
}

/** The six, for the row of dots on the floating bar. */
export const DOTS = PRESET_COLOURS.map((colour) => ({
  colour,
  css: `var(--canvas-${colour})`,
}))

/** The tokens ink is painted with, resolved against whatever theme is on. Read
 *  once per repaint of the plane and not per stroke: `getComputedStyle` is a
 *  layout read, and a page of handwriting is thousands of strokes. */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element)
  const palette: Palette = {}

  for (const colour of PRESET_COLOURS) {
    palette[colour] = style.getPropertyValue(`--canvas-${colour}`).trim() || '#888'
  }

  // The rest of the theme an export needs, since an SVG that has left the app
  // carries no stylesheet and no `var(...)` to look anything up in.
  for (const [name, token, fallback] of TOKENS) {
    palette[name] = style.getPropertyValue(token).trim() || fallback
  }

  return palette
}

const TOKENS: readonly [string, string, string][] = [
  ['accent', '--accent', '#4c6ef5'],
  // What a pen writes in when nobody chose a colour: the same ink the words on
  // the page are set in.
  ['ink', '--text-strong', '#111111'],
  ['text', '--text', '#1f2933'],
  ['muted', '--muted', '#8a9099'],
  ['line', '--line-strong', '#d6d9de'],
  ['surface', '--surface', '#ffffff'],
  ['bg', '--bg', '#fbfbfd'],
]

/** What a pen with no colour of its own writes in. A name rather than a value,
 *  because the value is whatever the theme says it is. */
export const DEFAULT_INK = 'ink'
