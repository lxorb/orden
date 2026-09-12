/** Which page note is in front, and where in it somebody is.
 *
 *  The surface is a component in a pane; the page counter is in the status bar and
 *  the thumbnails are in the outline panel, and neither of those is inside that
 *  pane. So the surface says what it is showing here and the two of them read it,
 *  which is the same arrangement `rooms.drawing` uses for the same reason: neither
 *  side has to be second, and a pane that closes takes its entry with it.
 *
 *  Keyed by document rather than by tab, because the same note in two panes is one
 *  note; the pane the keyboard is in is the one whose page number the bar says, and
 *  that is the one that reported last.
 *
 *  Nothing here draws or edits. It is one fact about what is on screen. */

import type { PagesStore } from './store.svelte'

/** What a page note that is open says about itself. */
export interface Showing {
  store: PagesStore
  /** Which page is being looked at, counting from one. */
  page: number
  count: number
}

class Pages {
  /** The page note whose pane reported last, or null when none is open. Raw: it is
   *  read for what it says and replaced whole, never edited in place. */
  current = $state.raw<Showing | null>(null)
  private key: string | null = null

  /** A page note reporting where it is. Called from an effect on every scroll, so
   *  it does nothing at all when nothing it holds has changed - the status bar is
   *  one number, and rewriting it sixty times a second for the same number is a
   *  repaint nobody asked for. */
  showing(key: string, what: Showing) {
    const held = this.current
    if (
      this.key === key &&
      held &&
      held.store === what.store &&
      held.page === what.page &&
      held.count === what.count
    ) {
      return
    }

    this.key = key
    this.current = what
  }

  /** That pane has gone. Only its own entry: a second pane showing another page
   *  note has already replaced this one, and clearing then would take theirs. */
  gone(key: string) {
    if (this.key !== key) return

    this.key = null
    this.current = null
  }
}

export const pages = new Pages()
