/** Which page note is in front, for the two things beside it that need to know.
 *
 *  The surface is a component in a pane; the page counter is in the status bar and the
 *  thumbnails are in the outline panel, and neither of those is inside that pane. So the
 *  surface says which note is in front and the two of them read the rest off its store,
 *  which is the same arrangement `rooms.drawing` uses for the same reason: neither side
 *  has to be second, and a pane that closes takes its entry with it.
 *
 *  **The store and nothing else.** Which page somebody is looking at is not written down
 *  here - it is a getter on the store, and the bar reads it. Pushing it would mean the
 *  surface writing into state the bar has already read, on every frame of every scroll,
 *  which is a write per frame and an update loop the framework is right to refuse. One
 *  write when a note opens, one when it closes.
 *
 *  Keyed by document rather than by tab, because the same note in two panes is one note;
 *  the pane that reported last is the one whose pages the panel shows.
 *
 *  Nothing here draws or edits. It is one fact about what is on screen. */

import type { PagesStore } from './store.svelte'

class Pages {
  /** The page note in front, or null when none is open. Raw: it is read for what it can
   *  do rather than for anything inside it, and replaced whole. */
  current = $state.raw<{ store: PagesStore } | null>(null)
  private key: string | null = null

  /** A page note's surface, arriving. Called once, when the surface mounts. */
  arrived(key: string, store: PagesStore) {
    this.key = key
    this.current = { store }
  }

  /** And going. Only its own entry: a second pane showing another page note has already
   *  replaced this one, and clearing then would take theirs. */
  gone(key: string) {
    if (this.key !== key) return

    this.key = null
    this.current = null
  }
}

export const pages = new Pages()
