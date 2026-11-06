import type { EditorView } from '@orden/editor'

import { focusEditor } from '../focus'
import { nameOf } from '../space-paths'
import { isRecord, keepJson, stored } from '../stored'
import { workspace } from '../workspace.svelte'

export const SCRATCHPAD = 'Scratchpad.md'
export const WIDTH = 320

export function isScratchpad(path: string | null | undefined): boolean {
  return !!path && nameOf(path) === SCRATCHPAD && workspace.outside(path)
}

export function padTab(): { id: string } | null {
  return workspace.tabs.find((one) => isScratchpad(one.path)) ?? null
}

const inCard = () =>
  typeof document !== 'undefined' &&
  !!document.activeElement?.closest('[data-scratchpad], [data-scratchpad-card]')

class Shown {
  on = $state(false)
  width = $state(WIDTH)
  calling = $state(false)
  view = $state.raw<EditorView | null>(null)
  from: HTMLElement | null = null

  constructor() {
    const kept = stored('nib:scratchpad')
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
    keepJson('nib:scratchpad', { on, width: this.width })
  }
}

export const shown = new Shown()

export function toggleScratchpad(): void {
  if (__EVEN_PLUGIN__) return
  if (shown.on && !inCard()) shown.calling = true
  else if (shown.on) workspace.closeRight()
  else workspace.showRight('scratchpad')
}

export function closeScratchpad(): void {
  if (shown.on) workspace.closeRight()
}

export function scratchFromDrawer(): void {
  if (__EVEN_PLUGIN__) return
  if (shown.on) {
    workspace.closeRight()
    return
  }
  workspace.closePanel()
  workspace.showRight('scratchpad')
}
