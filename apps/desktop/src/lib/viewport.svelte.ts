/** Three things the layout has to answer to on a phone that CSS cannot see: how
 *  much of the window the on-screen keyboard is covering, whether somebody is
 *  typing at all, and whether this is a phone in the first place. The first two
 *  come from the visual viewport, which is the only thing that shrinks when the
 *  keyboard opens. */

import { isMobile } from './tauri'

const PHONE = '(max-width: 720px)'
/** Where the drawer is the whole width of the screen. The same breakpoint the
 *  stylesheets use for it. */
const NARROW = '(max-width: 460px)'

/** How much of the window has to go before it counts as a keyboard rather than
 *  a few pixels of browser chrome sliding away. */
const KEYBOARD_THRESHOLD = 120

class Viewport {
  /** Pixels of the window hidden behind the keyboard. Zero when it is closed,
   *  and zero in the phone app, where the window is made shorter to sit above
   *  the keyboard rather than left under it. */
  keyboard = $state(0)
  /** Whether the keyboard is up, however this platform makes room for it. What
   *  everything that gets out of the way while a note is being written reads. */
  typing = $state(false)
  /** How tall the page is right now. Read by whatever has to be scrolled back
   *  into sight each time the keyboard takes some of it away. */
  height = $state(0)
  phone = $state(false)
  /** A phone so narrow that the drawer, open, covers all of it. */
  narrow = $state(false)
  /** True while the app is running as an installed app rather than a tab. */
  installed = $state(false)

  private started = false
  /** The tallest the page has been since the window was last this wide, which
   *  is the page with no keyboard making room for itself. Per width, so turning
   *  the phone on its side starts the measurement again. */
  private tallest = 0
  private atWidth = 0

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    // The phone app is a phone whatever the screen measures, so a tablet gets
    // the one-note layout rather than a desktop's three columns on a touch
    // screen with no pointer to arrange them with.
    const phone = window.matchMedia(PHONE)
    this.phone = isMobile || phone.matches
    phone.addEventListener('change', (event) => (this.phone = isMobile || event.matches))

    const narrow = window.matchMedia(NARROW)
    this.narrow = narrow.matches
    narrow.addEventListener('change', (event) => (this.narrow = event.matches))

    // Standalone, not fullscreen: the phone's clock and battery stay visible.
    const standalone = window.matchMedia('(display-mode: standalone)')
    this.installed = isMobile || standalone.matches
    standalone.addEventListener('change', (event) => (this.installed = isMobile || event.matches))

    const seen = window.visualViewport
    if (!seen) return

    const measure = () => this.measure(seen)

    measure()
    seen.addEventListener('resize', measure)
    seen.addEventListener('scroll', measure)
  }

  private measure(seen: VisualViewport) {
    // What the layout viewport has that the visual one does not. Scrolling the
    // page moves `offsetTop`, so it has to come off as well or the bar jumps
    // while the document scrolls under the keyboard.
    const hidden = window.innerHeight - (seen.height + seen.offsetTop)
    this.keyboard = Math.max(0, Math.round(hidden))
    this.height = Math.round(seen.height)

    const full = this.height + this.keyboard
    if (seen.width !== this.atWidth) {
      this.atWidth = seen.width
      this.tallest = 0
    }
    this.tallest = Math.max(this.tallest, full)

    // In the phone app the keyboard is not over the page at all: the window is
    // padded by its height so the page ends where the keys begin, and the only
    // trace of it is the height the window has lost. See MainActivity.kt. In a
    // browser the page keeps its height and the keyboard covers the bottom of
    // it, which is what `keyboard` measures. A desktop window is only ever
    // resized by the person using it, so nothing there is read as a keyboard.
    const shorter = isMobile ? this.tallest - full : 0
    this.typing = Math.max(this.keyboard, shorter) > KEYBOARD_THRESHOLD
  }
}

export const viewport = new Viewport()

/** How tall a page that fills the screen should be drawn, or nothing while
 *  there is no measurement yet and the stylesheet's `100dvh` is the best answer
 *  going.
 *
 *  A phone's page is the visual viewport rather than the window: the keyboard
 *  covers the bottom of the window and takes none of its height away, so a page
 *  sized from the window ends underneath the keys with its last rows out of
 *  reach. Everywhere else the window is the page and CSS can say so on its own. */
export function pageHeight(): string | undefined {
  return viewport.phone && viewport.height ? `${viewport.height}px` : undefined
}
