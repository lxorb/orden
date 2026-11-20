import type { EditorView } from '@orden/editor'
import { focusEditor, workspace } from '../../workspace/src/api'
import { nameOf, isRecord, keepJson, stored } from '../../platform/src/api'

export const SCRATCHPAD = 'Scratchpad.md'
export const WIDTH = 320
export const isScratchpad = (path: string | null | undefined): boolean =>
  !!path && nameOf(path) === SCRATCHPAD && workspace.outside(path)
export function padTab(): { id: string } | null {
  return workspace.tabHere((one) => isScratchpad(one.path))
}
const inCard = () =>
  typeof document !== 'undefined' && !!document.activeElement?.closest('[data-scratchpad], [data-scratchpad-card]')
class Shown {
  on = $state(false)
  width = $state(WIDTH)
  calling = $state(false)
  view = $state.raw<EditorView | null>(null)
  from: HTMLElement | null = null
  constructor() {
    const kept = stored('orden:scratchpad')
    if (!isRecord(kept)) return
    this.on = kept.on === true
    if (typeof kept.width === 'number') this.resize(kept.width)
  }
  show(take = true) {
    const tab = padTab()
    if (tab) {
      workspace.activate(tab.id)
      return
    }
    this.calling = take
    this.set(true)
  }
  hide() {
    if (inCard()) {
      if (this.from?.isConnected) this.from.focus({ preventScroll: true })
      else focusEditor()
    }
    this.from = null
    this.set(false)
  }
  toggle() {
    if (this.on) this.hide()
    else this.show()
  }
  resize(width: number) {
    this.width = width
    this.set(this.on)
  }
  private set(on: boolean) {
    this.on = on
    keepJson('orden:scratchpad', { on, width: this.width })
  }
}
export const shown = new Shown()
export function toggleScratchpad(): void {
  if (shown.on && !inCard()) shown.calling = true
  else if (shown.on) workspace.closeRight()
  else workspace.showRight('scratchpad')
}
export function closeScratchpad(): void {
  if (shown.on) workspace.closeRight()
}
export function scratchFromDrawer(): void {
  if (shown.on) {
    workspace.closeRight()
    return
  }
  workspace.closePanel()
  workspace.showRight('scratchpad')
}
