import { undoToastNotice } from './surfaces.svelte'
import { UNDO_LINGER } from './undo-toast.svelte'

class GateNote {
  said = $state<string | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  show(words: string) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    this.said = words
    this.linger()
  }

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

export const gateNote = new GateNote()
