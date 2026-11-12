import { UNDO_LINGER } from '../../undo-toast.svelte'

class Unsynced {
  said = $state<string | null>(null)
  many = $state(0)

  private readonly names = new Set<string>()

  private timer: ReturnType<typeof setTimeout> | undefined

  show(name: string) {
    this.said = name
    this.names.add(name)
    this.many = this.names.size
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
    this.names.clear()
    this.many = 0
    clearTimeout(this.timer)
  }
}

export const unsynced = new Unsynced()
