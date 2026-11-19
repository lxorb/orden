import { currentWindow } from '../../platform/src/api'

class Filling {
  by = $state<string | null>(null)
  private holder: string | null = null
  private before = false
  private turns: Promise<void> = Promise.resolve()
  take(tabId: string): Promise<void> {
    return this.inTurn(() => this.taken(tabId))
  }
  give(tabId: string): Promise<void> {
    return this.inTurn(() => this.given(tabId))
  }
  private inTurn(change: () => Promise<void>): Promise<void> {
    const turn = this.turns.then(change)
    this.turns = turn.catch(() => undefined)
    return turn
  }
  private async taken(tabId: string): Promise<void> {
    if (this.holder === tabId) return
    const window = await currentWindow()
    if (this.holder === null) this.before = await window.isFullscreen().catch(() => false)
    this.holder = tabId
    this.by = tabId
    await window.setFullscreen(true).catch(() => undefined)
  }
  private async given(tabId: string): Promise<void> {
    if (this.holder !== tabId) return
    this.holder = null
    this.by = null
    if (this.before) return
    const window = await currentWindow()
    await window.setFullscreen(false).catch(() => undefined)
  }
}
export const filling = new Filling()
