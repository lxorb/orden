/** Whether a stream of scroll has moved the content sideways.
 *
 *  A passive listener is handed the wheel after the content has already scrolled with it.
 *  So a scroller with a little way left to go - a table a few pixels wider than its
 *  column, a page that overflows its window by a scrollbar's width - is at its edge by
 *  the time it is asked which way it would still go, says nothing, and the stream that
 *  just moved it was read as a swipe: the arrow came in over a pane that had slid along
 *  with the fingers (#407). Firefox and Chrome do not ask the content where it is; they
 *  ask whether the scroll moved it, and a stream that did is the content's to its end.
 *
 *  So every scroll is heard, and when a scroller moves sideways the pane it is in is
 *  written down with the time. A stream is the content's once its pane moved sideways
 *  from a moment before its first step on (`LEAD`, since the scroll can be heard in the
 *  frame before the wheel that made it). A scroller first seen moving is taken to have
 *  started at nought, where every scroller starts.
 *
 *  Pure but for reading `scrollLeft`: swipes.ts hears the window's scrolls into it, and a
 *  web page asks the same of itself in src-tauri/src/web_swipe.js. */

/** How long before a stream's first step a scroll is still that stream's, in ms. */
export const LEAD = 50

/** Half a pixel is a zoomed page stopping at a fraction, not a scroll. */
const SLACK = 0.5

export class Slid {
  private readonly lefts = new WeakMap<Element, number>()
  private readonly moved = new Map<string, number>()

  /** A scroll of `scroller`, inside the pane `pane` (or none), heard at `at`. */
  heard(scroller: Element, pane: string | null, at: number): void {
    const was = this.lefts.get(scroller) ?? 0
    const now = scroller.scrollLeft
    this.lefts.set(scroller, now)
    if (pane !== null && Math.abs(now - was) > SLACK) this.moved.set(pane, at)
  }

  /** Whether the pane has moved sideways since a stream that began at `first`. */
  since(pane: string, first: number): boolean {
    return (this.moved.get(pane) ?? -Infinity) >= first - LEAD
  }

  forget(): void {
    this.moved.clear()
  }
}
