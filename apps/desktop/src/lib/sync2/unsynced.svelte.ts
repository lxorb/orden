/** The line that says a file's edits here are not syncing.
 *
 *  A canvas entry renamed to `.md`, or a note renamed to `.canvas`, keeps its kind on
 *  the account (docs/sync-v2.md section 5.5), and what is written into its file that
 *  the kind cannot hold - prose in a canvas - does not reach the account. The words
 *  are kept as a version on this device (`unsynced` in ingest.ts), and the reader is
 *  told once, in the undo toast's shape and for its lifetime; see UndoToast.svelte.
 *
 *  One at a time: a second file is the newer news, and takes its place. */

import { UNDO_LINGER } from '../undo-toast.svelte'

class Unsynced {
  /** The name of the file the toast is about, or null when it is not up. */
  said = $state<string | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  show(name: string) {
    this.said = name
    this.linger()
  }

  /** Held while the pointer is on it, so a reader half way through the line keeps it. */
  hold() {
    clearTimeout(this.timer)
  }

  linger() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  dismiss() {
    this.said = null
    clearTimeout(this.timer)
  }
}

export const unsynced = new Unsynced()
