/** The canvas that is open, as its own picture code wants it.
 *
 *  The Export menu is the app's; the surface is a component. So the drawing is
 *  built from the words the tab holds rather than from the store on screen, which
 *  is the same thing: every edit to a plane is written back into those words as it
 *  is made, so a canvas is never further from its text than a keystroke is.
 *
 *  Loaded when an export runs rather than at startup. Reading a canvas and
 *  drawing it are a good deal more code than a list of rows. */

import { readCanvas } from '../canvas/format'
import { readPalette } from '../canvas/palette'
import type { Drawing } from '../canvas/picture'

/** The canvas in `text`, ready to be drawn, named and placed. */
export function drawingOf(open: {
  text: string
  name: string
  path: string | null
  root: string | null
}): Drawing {
  return {
    canvas: readCanvas(open.text),
    // The theme's own colours as colours: a picture that has left the app carries
    // no stylesheet, so nothing in it can look `var(--canvas-1)` up any more. The
    // tokens sit on the root element, whichever theme is on.
    palette: readPalette(document.documentElement),
    path: open.path,
    root: open.root,
    name: open.name,
  }
}
