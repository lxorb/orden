/** One way for the app to change what it is showing.
 *
 *  Switching a panel, a settings pane, a tab in a segmented control - all of them
 *  used to happen between two frames, which reads as a flicker rather than as a
 *  move. This is the one answer to that, so every swap in the app has the same
 *  weight and none of them is written twice.
 *
 *  `arrive` and `leave` are a pair of Svelte transitions: what is going slips a
 *  few pixels away as it fades, what is coming comes back the same few pixels.
 *  The direction is the argument, so a panel arrives from below and a menu under
 *  a header comes down out of it.
 *
 *  They move `transform` and `opacity` and nothing else, so the compositor does
 *  the whole of it and nothing is laid out again on any frame of it. Neither
 *  delays the press: what was chosen is chosen on the frame it was pressed, and
 *  the movement is what catches up.
 *
 *  Durations come through `motion.ts`, which is where the reader's answer to
 *  "as little movement as possible" is applied, so all of this is instant for
 *  somebody who asked for that. */

import type { TransitionConfig } from 'svelte/transition'
import { cubicOut } from 'svelte/easing'
import { dur } from './motion'

/** How far a thing slips as it goes. Small on purpose: this says "something
 *  else is here now", not "you have gone somewhere". */
const STEP = 6
/** The same, for a list that drops out of the header above it, which has a
 *  little further to come because it has an edge to come out from. */
export const LIST_STEP = 8

/** `--dur-fast` and `--dur-base`, which is where the stylesheets keep these.
 *  Stated here as well because a Svelte transition takes a number and cannot
 *  read a custom property; `motion.test.ts` holds the two in step. */
const SWAP = 130

interface Slip {
  /** Which way, and how far. Positive is from below. */
  y?: number
  ms?: number
}

function slip(y: number, ms: number): TransitionConfig {
  return {
    duration: dur(ms),
    easing: cubicOut,
    // `u` is 1 at the far end of the movement and 0 at rest, whichever
    // direction the transition is running in, so one line covers both halves.
    css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`,
  }
}

/** What is arriving: from `y` pixels away, fading in. */
export function arrive(_node: Element, { y = STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}

/** What is leaving: away by `y` pixels, fading out. Its default is the opposite
 *  of `arrive`'s, so a pair written with no arguments crosses the way a pair
 *  should: the old one up and out, the new one up from below. */
export function leave(_node: Element, { y = -STEP, ms = SWAP }: Slip = {}): TransitionConfig {
  return slip(y, ms)
}
