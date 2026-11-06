import { settings } from './settings.svelte'
import { undoToastNotice } from './surfaces.svelte'
import { UNDO_LINGER, undoToast } from './undo-toast.svelte'

export function openInstructions(root: string) {
  settings.show('space', root, true)
}

class ReservedName {
  root = $state.raw<string | null>(null)

  private timer: ReturnType<typeof setTimeout> | undefined

  tell(root: string) {
    if (!__EVEN_PLUGIN__) void undoToastNotice.ask()
    undoToast.dismiss()
    this.root = root
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  open() {
    const root = this.root
    this.dismiss()
    if (root !== null) openInstructions(root)
  }

  dismiss() {
    this.root = null
    clearTimeout(this.timer)
  }
}

export const reservedName = new ReservedName()
