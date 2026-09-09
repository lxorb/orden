/** One way for the app to change what it is showing.
 *
 *  Switching a panel, a settings pane, a tab in a segmented control - all of them
 *  used to happen between two frames, which reads as a flicker rather than as a
 *  move. This is the one answer to that, so every swap in the app has the same
 *  weight and none of them is written twice.
 *
 *  Two shapes, and nothing else:
 *
 *  - `arrive` and `leave`, a pair of Svelte transitions: what is going slips a
 *    few pixels away as it fades, what is coming comes back the same few pixels.
 *    The direction is the argument, so a panel arrives from below and a menu
 *    under a header comes down out of it.
 *  - `segmented`, an action on the groove of a segmented control: one raised
 *    surface that slides to the chosen half, rather than a background switching
 *    on under one and off under another.
 *
 *  Both move `transform` and `opacity` and nothing else, so the compositor does
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

/** The raised surface a segmented control marks its choice with, as one element
 *  that moves rather than a background on each half.
 *
 *  Put on the groove itself - `use:segmented` beside `class="nib-segmented"` -
 *  and it draws the surface, measures whichever button is `on` and slides it
 *  there. It watches for that class moving rather than being told, so it works
 *  the same in every control in the app without any of them passing it a value,
 *  and so a choice made from a menu, a key or the palette moves it as faithfully
 *  as one made by pressing the control.
 *
 *  What it moves is a transform. The surface is laid out once at the size of a
 *  half and never again, so switching costs the compositor a translation and the
 *  page no layout at all. How long it takes and how it eases are in `base.css`
 *  with the rest of the control, so they go through the duration tokens - which
 *  are all zeroed for a reader who asked for less movement.
 *
 *  A control whose value is something none of its halves offers is a real state,
 *  and the surface simply is not there for it. */
export function segmented(node: HTMLElement) {
  const thumb = document.createElement('span')
  thumb.className = 'nib-segmented-thumb'
  thumb.setAttribute('aria-hidden', 'true')

  node.prepend(thumb)
  node.classList.add('has-thumb')

  function place() {
    const on = node.querySelector<HTMLElement>('button.on')

    if (!on) {
      thumb.style.opacity = '0'
      return
    }

    thumb.style.opacity = ''
    thumb.style.width = `${on.offsetWidth}px`
    thumb.style.height = `${on.offsetHeight}px`
    thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`
  }

  // The first placing is where the surface already is rather than a slide in
  // from the corner, so a control that opens with its second half chosen opens
  // with it chosen.
  thumb.style.transition = 'none'
  place()
  const settled = requestAnimationFrame(() => (thumb.style.transition = ''))

  // `class` only: the surface's own size is written as a style, and watching
  // that would be this answering itself for ever.
  const watched = new MutationObserver(place)
  watched.observe(node, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  })

  // The groove is as wide as the row it sits in, which a window being resized
  // and a drawer being dragged both change. Undefined where there is no such
  // thing, which is a test environment.
  const measured = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
  measured?.observe(node)

  return {
    destroy() {
      cancelAnimationFrame(settled)
      watched.disconnect()
      measured?.disconnect()
      thumb.remove()
      node.classList.remove('has-thumb')
    },
  }
}
