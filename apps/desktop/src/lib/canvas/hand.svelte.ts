/** What the glass has under it: whether a pen has ever been on it, and whether a
 *  finger is allowed to draw anyway.
 *
 *  A tablet with a stylus is two instruments, not one. The pen writes; the hand
 *  holds the page and moves it about, and it must be able to do that with an ink
 *  tool in hand, or there is no way to reach the rest of the drawing. So the
 *  first time a pen touches this glass, the finger stops being a nib. A phone has
 *  no pen and never will, so there the finger draws, because nothing else can.
 *
 *  Of the device rather than of the person. The same reader on a tablet and on a
 *  phone wants two different answers, so both live in this browser's own store
 *  and neither is synced or offered in Settings: one is not a choice anybody
 *  makes, and the other is a switch in the pen's own row for the one hand in a
 *  hundred that wants it. */

import { keep } from '../stored'

const SEEN = 'nib:pen-seen'
const DRAWS = 'nib:finger-draws'

/** What the store says, which is a string or nothing until it has been checked. */
function saved(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'yes'
  } catch {
    // A browser with site data turned off. Nothing to remember and nothing to
    // report: the pen still works, it is only forgotten between sittings.
    return false
  }
}

/** A yes or a no, as the word the store holds. */
function remember(key: string, on: boolean) {
  keep(key, on ? 'yes' : 'no')
}

class Hand {
  /** Whether a pen has ever been on this glass. */
  penSeen = $state(saved(SEEN))
  /** Whether a finger draws even so. */
  fingerDraws = $state(saved(DRAWS))

  /** A pen has touched the glass. Said on every pen event, written once. */
  sawPen() {
    if (this.penSeen) return

    this.penSeen = true
    remember(SEEN, true)
  }

  /** The switch in the pen's row, flicked. */
  toggleFinger() {
    this.fingerDraws = !this.fingerDraws
    remember(DRAWS, this.fingerDraws)
  }
}

export const hand = new Hand()
