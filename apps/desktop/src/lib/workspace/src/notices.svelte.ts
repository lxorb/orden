import { log, onDisk } from '../../platform/src/api'
import { askSheet, settingsWindow } from '@orden/contracts'
import { UNDO_LINGER, undoToast } from '../../undo-toast/src/api'

class Lingering {
  private timer: ReturnType<typeof setTimeout> | undefined
  protected told() {
    void askSheet('undo-toast')
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
    clearTimeout(this.timer)
  }
}
class GateNote extends Lingering {
  said = $state<string | null>(null)
  show(words: string) {
    this.said = words
    this.told()
  }
  override dismiss() {
    this.said = null
    super.dismiss()
  }
}
class Unread extends Lingering {
  shown = $state(false)
  async there(path: string): Promise<boolean> {
    if (!(await onDisk(path).catch(() => false))) return false
    log('warn', `open: ${path} is there and would not read`)
    this.shown = true
    this.told()
    return true
  }
  override dismiss() {
    this.shown = false
    super.dismiss()
  }
}
class Failed extends Lingering {
  retry = $state.raw<(() => void) | null>(null)
  undoing = $state(false)
  skip = $state.raw<(() => void) | null>(null)
  tell(retry: () => void, undoing = false, skip: (() => void) | null = null) {
    undoToast.dismiss()
    this.retry = retry
    this.undoing = undoing
    this.skip = skip
    this.told()
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
  override dismiss() {
    this.retry = null
    this.skip = null
    super.dismiss()
  }
}
export function openInstructions(root: string) {
  settingsWindow().show('space', root, true)
}
class ReservedName extends Lingering {
  root = $state.raw<string | null>(null)
  tell(root: string) {
    undoToast.dismiss()
    this.root = root
    this.told()
  }
  open() {
    const root = this.root
    this.dismiss()
    if (root !== null) openInstructions(root)
  }
  override dismiss() {
    this.root = null
    super.dismiss()
  }
}
export const gateNote = new GateNote()
export const unread = new Unread()
export const failed = new Failed()
export const reservedName = new ReservedName()
