/** Two panes on one note, scrolling together.
 *
 *  By document position, not by pixels. The same note at two widths wraps into
 *  different numbers of lines, so the same pixel offset is a different place in
 *  the text; a position is the same place in both. The line at the top of one
 *  pane is put at the top of the other, which is what keeps a heading level.
 *
 *  The ends are an interface rather than editor views, because what this has to
 *  get right is which end is leading and when the other one's scroll is only the
 *  echo of it - and that is worth testing without a browser. */

/** One end of the link: where it is, where to put it, and when it moves. */
export interface ScrollEnd {
  /** The document position of the line at the top of what is on screen. */
  top(): number
  /** Puts that position at the top. */
  show(position: number): void
  /** Calls back whenever this end is scrolled. Answers the teardown. */
  onScroll(run: () => void): () => void
}

/** How long after a scroll the other end is still reading as its echo. Long
 *  enough to cover the frame the other end needs to settle, short enough that
 *  taking hold of the other pane answers at once. */
const ECHO = 150

/** Ties two ends together until the teardown is called.
 *
 *  Only one end leads at a time. Carrying a scroll into the other end scrolls
 *  it, which it reports as a scroll of its own, and answering that would push
 *  the first end back: the two would fight each other down the note. So the end
 *  that moved first leads until it has been still for a moment. */
export function linkScroll(a: ScrollEnd, b: ScrollEnd): () => void {
  let leading: ScrollEnd | null = null
  let quiet: ReturnType<typeof setTimeout> | undefined

  const carry = (from: ScrollEnd, to: ScrollEnd) => () => {
    if (leading && leading !== from) return

    leading = from
    clearTimeout(quiet)
    quiet = setTimeout(() => {
      leading = null
    }, ECHO)

    to.show(from.top())
  }

  const stops = [a.onScroll(carry(a, b)), b.onScroll(carry(b, a))]

  return () => {
    clearTimeout(quiet)
    for (const stop of stops) stop()
  }
}
