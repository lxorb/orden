import { isDeck } from '@orden/markdown/slide-breaks'
import { currentWindow } from '../tauri'
import { workspace } from '../workspace.svelte'

class Present {
  tabId = $state<string | null>(null)

  readonly on = $derived(this.tabId !== null)

  private wasFullscreen = false

  start(tabId: string | null = workspace.activeTabId) {
    const tab = workspace.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    workspace.flush()
    if (!isDeck(tab.doc)) return

    this.tabId = tab.id
    void this.fill()
  }

  stop() {
    if (this.tabId === null) return

    this.tabId = null
    void this.shrink()
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

  private async fill() {
    const window = await currentWindow()
    this.wasFullscreen = await window.isFullscreen()
    if (!this.wasFullscreen) await window.setFullscreen(true)
  }

  private async shrink() {
    if (this.wasFullscreen) return

    const window = await currentWindow()
    await window.setFullscreen(false)
  }
}

export const present = new Present()
