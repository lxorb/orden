import { currentWindow } from '../tauri'

class Filling {
  by = $state<string | null>(null)
  private holder: string | null = null
  private before = false

  async take(tabId: string): Promise<void> {
    if (this.holder === tabId) return

    const window = await currentWindow()
    if (this.holder === null) this.before = await window.isFullscreen().catch(() => false)
    this.holder = tabId
    this.by = tabId
    await window.setFullscreen(true).catch(() => undefined)
  }

  async give(tabId: string): Promise<void> {
    if (this.holder !== tabId) return

    this.holder = null
    this.by = null
    if (this.before) return
    const window = await currentWindow()
    await window.setFullscreen(false).catch(() => undefined)
  }
}

export const filling = new Filling()
