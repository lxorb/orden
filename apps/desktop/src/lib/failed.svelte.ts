import { undoToastNotice } from './surfaces.svelte'
import { UNDO_LINGER, undoToast } from './undo-toast.svelte'

class Failed {
  retry = $state.raw<(() => void) | null>(null)

  undoing = $state(false)

  skip = $state.raw<(() => void) | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  tell(retry: () => void, undoing = false, skip: (() => void) | null = null) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    undoToast.dismiss()
    this.retry = retry
    this.undoing = undoing
    this.skip = skip
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  again() {
    const retry = this.retry
    this.dismiss()
    retry?.()
  }

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
