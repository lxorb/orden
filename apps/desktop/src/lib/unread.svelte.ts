import { log } from './log'
import { onDisk } from './on-disk'
import { undoToastNotice } from './surfaces.svelte'
import { UNDO_LINGER } from './undo-toast.svelte'

class Unread {
  shown = $state(false)

  private timer: ReturnType<typeof setTimeout> | undefined

  async there(path: string): Promise<boolean> {
    if (!(await onDisk(path).catch(() => false))) return false

    log('warn', `open: ${path} is there and would not read`)
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()

    this.shown = true
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
    return true
  }

  dismiss() {
    this.shown = false
    clearTimeout(this.timer)
  }
}

export const unread = new Unread()
