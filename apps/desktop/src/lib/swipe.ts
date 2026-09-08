/** The drawer follows a finger, and has to decide three things about it: whether
 *  the gesture is the drawer's at all, whether a movement has become a drag, and
 *  where the drawer should land when the finger lifts.
 *
 *  Kept apart from the DOM wiring because these are the parts with rules in
 *  them: a flick should win over position, so a short fast swipe opens the
 *  drawer even though the finger never crossed the halfway mark - and a pen
 *  should never win at all. */

/** Pixels the finger must travel before the gesture is treated as horizontal
 *  rather than a scroll. Below this the drawer stays out of the way. */
export const CLAIM = 12

/** Whether a `touch-action` value says the surface takes every touch on it for
 *  itself, which is what a canvas being drawn on declares. A value naming a
 *  direction it does not handle - the writing surface's `pan-y pinch-zoom` -
 *  is leaving the sideways one to whoever wants it, and that is the drawer. */
export function ownsEveryTouch(action: string): boolean {
  if (action === 'auto' || action === 'manipulation') return false
  return !action.includes('pan-')
}

/** Whether something under the finger owns sideways movement itself, so this
 *  gesture belongs to it and not to the drawer: a wide table or a strip of tabs
 *  that scrolls, or a surface drawn on with a pen.
 *
 *  Wider than its box is not enough: a box that clips what overflows it goes
 *  nowhere when it is dragged, and the writing surface is one of those. Taking
 *  those for scrollers left the drawer refusing to open anywhere in a note that
 *  had a wide table in it. */
export function ownsGesture(from: Element | null, stopAt: Element): boolean {
  for (let node: Element | null = from; node && node !== stopAt; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (ownsEveryTouch(style.touchAction)) return true

    if (node.scrollWidth <= node.clientWidth + 1) continue
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') return true
  }

  return false
}

/** Whether a hand rather than a pen is on the screen.
 *
 *  A pen draws. It inks a canvas and marks up a note, and a stroke left to
 *  right across the middle of the page was pulling the sidebar out from under
 *  it. Nothing but a finger ever drags the drawer. */
export function isFinger(pointer: string): boolean {
  return pointer !== 'pen'
}

/** Whether a finger put down this far from the left of the screen may pull the
 *  drawer out.
 *
 *  A phone's screen is barely wider than a thumb, so there the whole of it is
 *  the handle: an edge-only target is a thin one to find, and nothing is drawn
 *  on a phone's note with a pen anyway. A tablet's note is a page, written and
 *  drawn on across its whole width, so only a drag beginning within the edge
 *  strip is the sidebar's, which is how tablet apps have always read. */
export function opensDrawer(x: number, edge: number, anywhere: boolean): boolean {
  return anywhere || x <= edge
}

/** Pixels per millisecond past which the gesture reads as a flick. */
const FLICK = 0.5

/** How long the drawer takes to settle after the finger lifts, in
 *  milliseconds: the shortest for a drawer let go beside its resting place,
 *  the longest for one that has the whole width still to cross. */
export const SETTLE_MIN = 200
export const SETTLE_MAX = 380

/** Whether the drawer should end up open.
 *
 *  `offset` is how far it has been pulled out, `width` how far it can go, and
 *  `velocity` the finger's last speed - positive when moving right. */
export function settleOpen(offset: number, width: number, velocity: number): boolean {
  if (Math.abs(velocity) >= FLICK) return velocity > 0
  return offset >= width / 2
}

/** Whether a movement has become a drawer drag rather than a scroll. */
export function claimsGesture(dx: number, dy: number): boolean {
  return Math.abs(dx) > CLAIM && Math.abs(dx) > Math.abs(dy)
}
