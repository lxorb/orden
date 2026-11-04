/** A board's write that did not land: a card carried to a column whose note would not
 *  be written. The card goes back, and the toast Undo lives in says so in one word with
 *  the way to try again; see UndoToast.svelte. An undo that could not go ahead, what it
 *  waited for not landing, says so the same way. */

import { undoToastNotice } from '../surfaces.svelte'
import { UNDO_LINGER, undoToast } from '../undo-toast.svelte'

class Failed {
  /** What a press of Retry does, while the toast says so. */
  retry = $state.raw<(() => void) | null>(null)

  /** Whether what did not happen was an undo, rather than a move. */
  undoing = $state(false)

  /** What a press of Skip does, where what did not happen can be let go of. */
  skip = $state.raw<(() => void) | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  /** The newest news has the toast: an Undo up for something before this goes (Ctrl+Z
   *  still takes it back), and one for something after this takes the toast in turn. */
  tell(retry: () => void, undoing = false, skip: (() => void) | null = null) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    undoToast.dismiss()
    this.retry = retry
    this.undoing = undoing
    this.skip = skip
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  /** Retry pressed: the toast goes and the write is tried again. */
  again() {
    const retry = this.retry
    this.dismiss()
    retry?.()
  }

  /** Skip pressed: the toast goes, and what would not happen with it. */
  giveUp() {
    const skip = this.skip
    this.dismiss()
    skip?.()
  }

  dismiss() {
    this.retry = null
    this.skip = null
    clearTimeout(this.timer)
  }
}

export const failed = new Failed()
