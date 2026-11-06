import { currentWindow } from './tauri'
import { afterQuiet } from './timing'

export interface Panes {
  fills: string | null
  readonly focusedId: string
  readonly focused: { readonly activeTabId: string | null }
}

export const IDLE = 2600

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function escapeLeaves(
  spent: boolean,
  holder: { readonly tagName?: string } | null,
): boolean {
  return !spent && !FIELDS.has(holder?.tagName ?? '')
}

const STIR = 400

class FullScreen {
  on = $state(false)
  idle = $state(false)

  private readonly fading = afterQuiet(() => (this.idle = true), IDLE)
  private stirred = 0
  private panes: Panes | null = null
  private filledBefore: string | null = null

  async toggle(panes: Panes) {
    if (this.on) await this.leave()
    else await this.enter(panes)
  }

  async enter(panes: Panes) {
    if (this.on || panes.focused.activeTabId === null) return

    this.on = true
    this.panes = panes
    this.filledBefore = panes.fills
    panes.fills = panes.focusedId
    this.wake()
    await this.window(true)
  }

  async leave() {
    if (!this.on) return

    this.on = false
    this.idle = false
    this.fading.cancel()
    const panes = this.panes
    if (panes) panes.fills = this.filledBefore === panes.focusedId ? this.filledBefore : null
    this.panes = null
    this.filledBefore = null
    if (typeof document !== 'undefined')
      document.removeEventListener('fullscreenchange', this.given)
    await this.window(false)
  }

  private readonly given = () => {
    if (document.fullscreenElement !== null) return
    document.removeEventListener('fullscreenchange', this.given)
    void this.leave()
  }

  stir(now: number = Date.now()) {
    if (!this.on || (!this.idle && now - this.stirred < STIR)) return

    this.stirred = now
    this.wake()
  }

  follow() {
    const panes = this.panes
    if (!this.on || !panes) return

    if (panes.focused.activeTabId === null) void this.leave()
    else if (panes.fills !== panes.focusedId) panes.fills = panes.focusedId
  }

  private wake() {
    this.idle = false
    this.fading()
  }

  private async window(on: boolean) {
    try {
      const window = await currentWindow()
      await window.setFullscreen(on)
      if (on && this.on && typeof document !== 'undefined' && document.fullscreenElement) {
        document.addEventListener('fullscreenchange', this.given)
      }
    } catch {
      // Nothing to say to the reader: the document is full screen either way.
    }
  }
}

export const fullscreen = new FullScreen()
