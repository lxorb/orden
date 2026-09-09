/** The document, and nothing else.
 *
 *  Full screen takes the app away and leaves what is being read or drawn: the
 *  rail with its spaces, the file list, the title bar and the status bar all go,
 *  and the document fills the screen behind whatever the system keeps for its
 *  clock and its gesture bar. Where there is a window to ask, the window goes
 *  full screen too, so a desktop loses its frame and a browser tab loses the
 *  browser.
 *
 *  One command for both halves, which is `app.fullscreen` and F11 - see
 *  shortcuts/registry.ts - reached from the View menu, from the three dots on a
 *  phone and a tablet, and from the one small button that stays behind.
 *
 *  Nothing about it is remembered. It belongs to the document it was entered on
 *  and to this sitting: closing that document brings the app back, and so does
 *  starting it again. A reader who cannot find their way out of a screen with
 *  nothing on it is the one thing this must never do, which is why there are four
 *  ways back - the button, Escape, back on Android, and the menu row it was
 *  turned on from. */

import { currentWindow } from './tauri'

/** How long the way out stays lit after the last thing moved. Long enough to
 *  find, short enough that a page being read is not sharing it with a button. */
export const IDLE = 2600

/** How often a moving pointer is allowed to re-arm that: a pointer crossing the
 *  screen says the same thing sixty times a second. */
const STIR = 400

class FullScreen {
  /** Whether the app is out of the way. */
  on = $state(false)
  /** The document it was entered on, by tab. */
  of = $state<string | null>(null)
  /** Whether the way out has faded back: still there, still reachable by a key,
   *  no longer part of what is being read. */
  idle = $state(false)

  private timer: ReturnType<typeof setTimeout> | undefined
  private stirred = 0

  async toggle(tabId: string | null) {
    if (this.on) await this.leave()
    else await this.enter(tabId)
  }

  async enter(tabId: string | null) {
    if (this.on) return

    this.on = true
    this.of = tabId
    this.wake()
    await this.window(true)
  }

  async leave() {
    if (!this.on) return

    this.on = false
    this.of = null
    this.idle = false
    clearTimeout(this.timer)
    this.timer = undefined
    await this.window(false)
  }

  /** Something moved, so the way out is lit again and fades once nothing has
   *  moved for a while. Called from every pointer that crosses the screen, so it
   *  answers a moving hand once every `STIR` rather than on every event. */
  stir(now: number = Date.now()) {
    if (!this.on || (!this.idle && now - this.stirred < STIR)) return

    this.stirred = now
    this.wake()
  }

  /** Whether the document this belongs to is still open. Full screen goes with
   *  it: a window with no document in it and no app around it is a window with
   *  nothing at all. */
  watch(openTabIds: readonly string[]) {
    if (!this.on || this.of === null || openTabIds.includes(this.of)) return

    void this.leave()
  }

  private wake() {
    this.idle = false
    clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.idle = true), IDLE)
  }

  /** The window itself, where there is one to ask: the desktop's frame, or the
   *  browser's own chrome. A platform that will not do it - a webview on a phone,
   *  a browser that refuses outside a gesture - changes nothing here: the app is
   *  already out of the way, which is what was asked for. */
  private async window(on: boolean) {
    try {
      const window = await currentWindow()
      await window.setFullscreen(on)
    } catch {
      // Nothing to say to the reader: the document is full screen either way.
    }
  }
}

export const fullscreen = new FullScreen()
