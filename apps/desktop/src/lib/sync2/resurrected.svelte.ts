import { UNDO_LINGER } from '../undo-toast.svelte'
import type { Resurrected } from './asking.svelte'

class Back {
  said = $state.raw<Resurrected | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  show(event: Resurrected) {
    this.said = event
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

export const back = new Back()
