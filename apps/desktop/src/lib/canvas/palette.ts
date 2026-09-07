/** What a canvas colour looks like on screen.
 *
 *  The file says `"1"`; the six presets are tokens, so a theme restates them like
 *  any other colour and a canvas coloured in Obsidian arrives wearing the same
 *  six. A hex string is used as written, which is the other half of the format. */

import { PRESET_COLOURS, type CanvasColour } from './format'

/** The colour as CSS, or null for a card with no colour of its own, which wears
 *  the surface it is drawn on. */
export function shownColour(colour: CanvasColour | undefined): string | null {
  if (colour === undefined) return null
  if (PRESET_COLOURS.some((one) => one === colour)) return `var(--canvas-${colour})`

  return colour
}

/** The six, for the row of dots on the floating bar. */
export const DOTS = PRESET_COLOURS.map((colour) => ({
  colour,
  css: `var(--canvas-${colour})`,
}))
