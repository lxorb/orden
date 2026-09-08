/** The little knock a finger feels when it picks a pen up.
 *
 *  A glass bar has no detents, so the only thing that says "that press landed on
 *  the marker and not on the highlighter" is the picture changing, and a thumb
 *  covers the thing it just pressed. One short pulse, under the length of a frame,
 *  gives the row the click a physical row of pens would have had.
 *
 *  Only where the platform has it, and never for a pointer: a mouse arm feels
 *  nothing and a desktop that buzzed at a click would be a machine with a fault.
 *  A person who has turned the system's own haptics off gets nothing, because
 *  `vibrate` is what that setting turns off. */

import { viewport } from '../viewport.svelte'

/** How long the pulse is, in milliseconds. Short enough to read as a click on a
 *  surface rather than as a buzz from a phone. */
const TICK = 8

export function tick(): void {
  if (!viewport.touch || typeof navigator === 'undefined') return

  // A browser that has never heard of it, which every desktop one has not.
  if (typeof navigator.vibrate !== 'function') return

  try {
    navigator.vibrate(TICK)
  } catch {
    // A browser that has the method and refuses the call, which some do inside
    // an iframe or before the first gesture. Nothing is lost but the knock.
  }
}
