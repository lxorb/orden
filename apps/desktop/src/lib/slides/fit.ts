/** Sizing a slide's text so it never scrolls.
 *
 *  The arithmetic is in stage.ts, which is testable without a screen; this is
 *  the one thing it cannot be: reading how tall a slide came out. Both places
 *  that put a stage on a page use it - the deck itself and the frames in the
 *  presenter's window - so a slide shrunk on one is shrunk by the same rung on
 *  the other. */

import { fitStep } from './stage'

/** Shrinks `surface` until it fits the box it is in, and answers the rung it
 *  settled on. Read and written in one go, so the browser lays the slide out
 *  once and paints it already fitted. */
export function fitSurface(surface: HTMLElement): number {
  const step = fitStep((wanted) => {
    surface.style.setProperty('--stage-fit', String(wanted))
    return surface.scrollHeight <= surface.clientHeight + 1
  })

  surface.style.setProperty('--stage-fit', String(step))
  return step
}
