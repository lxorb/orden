/** What floats in the corners of the note (#1076): the status bar with the page
 *  counter and the word count, the vim mode, and on a touch screen the round button
 *  for a new note. They belong to the note's pane, not to the window: drawn inside the
 *  focused pane (Pane.svelte), so they stay inside its box whichever sidebar is open,
 *  however wide it is or revealed from its edge (#1038), and whichever pane of a split
 *  has the keyboard. The window says what is in them (App.svelte, where what they show
 *  is known); this is the one place that says where they are. */

import type { Snippet } from 'svelte'

class PaneCorners {
  /** The corners' contents, set once by the window. Raw: a snippet is drawn, never
   *  looked inside. */
  draw = $state.raw<Snippet | null>(null)
}

export const paneCorners = new PaneCorners()

/** The box something floating over a note is measured against: what it is placed in
 *  (its positioned container: the surface, the pane), never the window, whose edges
 *  are a sidebar's or the scratchpad's as often as the note's (#1076). The window only
 *  where nothing holds it. */
export function frameOf(element: HTMLElement | null | undefined): {
  left: number
  top: number
  width: number
  height: number
} {
  const held = element?.offsetParent
  if (held) {
    const box = held.getBoundingClientRect()
    return { left: box.left, top: box.top, width: box.width, height: box.height }
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}
