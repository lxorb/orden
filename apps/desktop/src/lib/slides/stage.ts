/** The stage a slide is shown on, and moving through a deck.
 *
 *  All of it arithmetic, so the two things that decide whether presenting feels
 *  right can be tested without a screen: a slide is the same shape whatever it
 *  is shown on, and pressing a key always lands somewhere that exists. */

import { FIT_STEPS } from '@nib/markdown/deck'

/** The sizes a slide's text is allowed to take. One ladder for the app, an
 *  exported file and a published page, so a slide is the same size on all three;
 *  it lives beside the page builder that has to write it out as a literal. */
export { FIT_STEPS } from '@nib/markdown/deck'

/** The stage, in CSS pixels. Sixteen by nine, fixed, so a slide written on a
 *  laptop is the slide a projector shows: everything is laid out at this size
 *  and the whole of it is scaled to whatever the screen is, which letterboxes
 *  rather than reflowing the words. */
export const STAGE_WIDTH = 1280
export const STAGE_HEIGHT = 720

/** How much the stage has to be scaled by to fit a box. Zero for a box with no
 *  area, which is what a stage measured before it has been laid out reports. */
export function stageScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0

  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT)
}

/** The largest rung the slide fits on.
 *
 *  Found by halving rather than by walking down, so a slide costs four layouts
 *  instead of ten. `fits` only gets smaller as the rungs do, which is what lets
 *  the search assume that anything below a rung that fits fits too. */
export function fitStep(fits: (step: number) => boolean): number {
  let low = 0
  let high = FIT_STEPS.length - 1

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (fits(FIT_STEPS[middle] ?? 1)) high = middle
    else low = middle + 1
  }

  return FIT_STEPS[low] ?? 1
}

/** Where in the deck the presenter is: which slide, and how many of its steps
 *  have been taken. */
export interface Place {
  slide: number
  step: number
}

export const START: Place = { slide: 0, step: 0 }

/** How many clicks each slide holds before the deck moves on. Asks a deck for
 *  the one thing it needs, so a parsed slide and a rendered one both answer. */
export function stepsOf(slides: readonly { fragments: readonly number[] }[]): number[] {
  return slides.map((slide) => slide.fragments.length)
}

/** Which slides continue the one before them downwards. */
export function axesOf(slides: readonly { vertical: boolean }[]): boolean[] {
  return slides.map((slide) => slide.vertical)
}

function stepsAt(steps: readonly number[], slide: number): number {
  return steps[slide] ?? 0
}

/** One press onwards: the next step of this slide, else the next slide. The end
 *  of the deck stays at the end rather than wrapping - a deck that looped would
 *  put the title back up while somebody was still talking about the last page. */
export function forward(steps: readonly number[], at: Place): Place {
  if (at.step < stepsAt(steps, at.slide)) return { slide: at.slide, step: at.step + 1 }
  if (at.slide + 1 < steps.length) return { slide: at.slide + 1, step: 0 }

  return at
}

/** One press back. A slide arrived at from below is shown with everything on it
 *  already out: going back should undo the last press, and the last press was
 *  whatever revealed the end of that slide. */
export function back(steps: readonly number[], at: Place): Place {
  if (at.step > 0) return { slide: at.slide, step: at.step - 1 }
  if (at.slide > 0) return { slide: at.slide - 1, step: stepsAt(steps, at.slide - 1) }

  return at
}

/** A slide asked for by number, with nothing on it revealed yet. */
export function toSlide(steps: readonly number[], slide: number): Place {
  const found = Math.max(0, Math.min(slide, steps.length - 1))
  return { slide: found, step: 0 }
}

/** The last slide, everything on it out. What End means. */
export function toEnd(steps: readonly number[]): Place {
  const last = Math.max(0, steps.length - 1)
  return { slide: last, step: stepsAt(steps, last) }
}

/** A place that still exists after the note was edited under it: a slide that
 *  was deleted leaves the presenter on the nearest one that is left. */
export function clamp(steps: readonly number[], at: Place): Place {
  if (!steps.length) return START

  const slide = Math.max(0, Math.min(at.slide, steps.length - 1))
  return { slide, step: Math.max(0, Math.min(at.step, stepsAt(steps, slide))) }
}

/** Which way the deck moved, which is the whole of what a transition has to
 *  know. Null for a step taken on the slide that is already up: nothing moves,
 *  the next line simply arrives.
 *
 *  A slide that continues the one before it downwards is entered from above and
 *  left upwards, so the eye follows the note's own shape rather than being told
 *  about it. */
export type Move = 'forward' | 'back' | 'down' | 'up' | null

export function moveBetween(axes: readonly boolean[], from: number, to: number): Move {
  if (from === to) return null
  if (to > from) return axes[to] === true ? 'down' : 'forward'

  return axes[from] === true ? 'up' : 'back'
}

/** The slide a typed number names, counting from one the way the counter shows
 *  them. Null when the deck has no such slide, so nothing happens and the
 *  typing was harmless. */
export function typedSlide(typed: string, count: number): number | null {
  if (!/^\d{1,4}$/.test(typed)) return null

  const wanted = Number(typed)
  return wanted >= 1 && wanted <= count ? wanted - 1 : null
}

/** How many of a slide's waiting items are out at `step`. The items themselves
 *  are found in the rendered page by their place in it; see Slides.svelte. */
export function shownFragments(fragments: readonly number[], step: number): number[] {
  return fragments.slice(0, step)
}
