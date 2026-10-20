/** A board's write that did not land: a card carried to a column whose note would not
 *  be written. The card goes back, and the toast Undo lives in says so in one word with
 *  the way to try again; see UndoToast.svelte. */

import { undoToastNotice } from '../surfaces.svelte'
import { UNDO_LINGER, undoToast } from '../undo-toast.svelte'

class Failed {
  /** What a press of Retry does, while the toast says so. */
  retry = $state.raw<(() => void) | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  /** The newest news has the toast: an Undo up for something before this goes (Ctrl+Z
   *  still takes it back), and one for something after this takes the toast in turn. */
  tell(retry: () => void) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    undoToast.dismiss()
    this.retry = retry
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  /** Retry pressed: the toast goes and the write is tried again. */
  again() {
    const retry = this.retry
    this.dismiss()
    retry?.()
  }

  dismiss() {
    this.retry = null
    clearTimeout(this.timer)
  }
}

export const failed = new Failed()
