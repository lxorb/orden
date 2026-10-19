/** A menu opened by a press that is still held, let go of (#368).
 *
 *  David, on a Mac: *"right clicking in a canvas, document or the sidebar immediately
 *  disappears on mac after briefly showing the right click window. when holding the key,
 *  it stays, but releasing when hovering over an option doesnt make it clickable."* A Mac
 *  and Linux open a context menu as the button goes down, not as it comes up as Windows
 *  does, and their own menus are worked the way that allows: held, slid onto a row and
 *  let go of, which chooses it. Let go of where it was pressed, it stays open to be
 *  clicked, as a click does; let go of anywhere else, it closes.
 *
 *  The row is read off the point the button came up at, not off the release's target: a
 *  canvas holds the pointer it was pressed with, so its release is the canvas's, wherever
 *  it is. The click a release makes goes to what both halves of the press were over,
 *  which is never the row, and is spent; see ContextMenu.svelte. */

/** How far the pointer may wander from where it was pressed and still be a click, in
 *  px: what a hand on a trackpad moves while it presses. */
export const SLOP = 4

/** What letting go means: the row under it chosen, the menu closed, or nothing. */
export type Release = 'choose' | 'close' | 'stay'

export function released(
  from: { x: number; y: number },
  at: { x: number; y: number },
  under: 'row' | 'menu' | 'outside',
): Release {
  if (Math.hypot(at.x - from.x, at.y - from.y) <= SLOP) return 'stay'
  if (under === 'row') return 'choose'
  return under === 'menu' ? 'stay' : 'close'
}
