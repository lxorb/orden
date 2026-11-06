import { isDeck } from '@orden/markdown/slide-breaks'
import { currentWindow } from '../tauri'
import { workspace } from '../workspace.svelte'

class Present {
  tabId = $state<string | null>(null)

  readonly on = $derived(this.tabId !== null)

  private wasFullscreen = false

  private filled = false

  private turn: Promise<void> = Promise.resolve()

  start(tabId: string | null = workspace.activeTabId) {
    const tab = workspace.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    workspace.flush()
    if (!isDeck(tab.doc)) return

    this.tabId = tab.id
    this.follow()
  }

  stop() {
    if (this.tabId === null) return

    this.tabId = null
    this.follow()
  }

  toggle(tabId: string | null = workspace.activeTabId) {
    if (this.on) this.stop()
    else this.start(tabId)
  }

  get available(): boolean {
    const tab = workspace.active
    if (tab?.kind !== 'note') return false

    return isDeck(tab.doc)
  }

  private follow() {
    this.turn = this.turn.then(() => this.settle()).catch(() => undefined)
  }

  private async settle() {
    if (this.on === this.filled) return

    const window = await currentWindow()
    if (this.on) {
      this.wasFullscreen = await window.isFullscreen()
      this.filled = true
      if (!this.wasFullscreen) await window.setFullscreen(true)
      return
    }

    this.filled = false
    if (!this.wasFullscreen) await window.setFullscreen(false)
  }
}

export const present = new Present()
