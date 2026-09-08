/** What the layout has to answer to that a stylesheet cannot see on its own:
 *  which of the three kinds of device this is, which way it is being held, how
 *  much of the window the on-screen keyboard is covering, and whether somebody
 *  is typing at all. The last two come from the visual viewport, which is the
 *  only thing that shrinks when the keyboard opens.
 *
 *  The device is settled here, once, and written on the document as well: every
 *  rule that used to key off a width now keys off `html[data-device]` and
 *  `html[data-layout]`, so the markup and the stylesheet cannot come to
 *  different conclusions about the same screen. */

import { startInsets } from './insets'
import { isMobile } from './tauri'

/** The three shapes the app comes in. A phone is one column with the sidebar as
 *  a drawer over it. A tablet is that same drawer in portrait and a sidebar
 *  beside the note in landscape, sized for fingers either way. A desktop is
 *  columns and a pointer. */
export type Device = 'phone' | 'tablet' | 'desktop'

/** At or below this a window is a phone, whatever is running it. */
const PHONE = 720
/** And in the app, at or below this on its narrow side: a phone laid on its
 *  side is 844 points wide and still a phone. */
const PHONE_SIDE = 500
/** A phone so narrow that the drawer, open, covers all of it. */
const NARROW = 460

/** How much of the window has to go before it counts as a keyboard rather than
 *  a few pixels of browser chrome sliding away. */
const KEYBOARD_THRESHOLD = 120

/** Which of the three a window this size is.
 *
 *  Width decides first, so a desktop window dragged narrow gets the phone
 *  layout it has always had. Past that width a browser window is a desktop even
 *  on a touch screen, which is what the web app has always done and what a
 *  browser's conventions expect. Only in the app is the other side asked, and
 *  only to keep a phone laid on its side a phone. */
export function deviceFor(width: number, height: number, mobile: boolean): Device {
  if (width <= PHONE) return 'phone'
  if (!mobile) return 'desktop'
  return Math.min(width, height) <= PHONE_SIDE ? 'phone' : 'tablet'
}

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
  /** Which kind of screen this is; see `deviceFor`. */
  device = $state<Device>('desktop')
  /** Taller than it is wide. Only a tablet reads it, to know whether there is
   *  room for the sidebar to stay open beside the note. */
  portrait = $state(false)
  /** A phone so narrow that the drawer, open, covers all of it. */
  narrow = $state(false)
  /** True while the app is running as an installed app rather than a tab. */
  installed = $state(false)

  /** Fingers rather than a pointer: thumb-sized targets, sheets instead of
   *  dropdowns, one note at a time. Both the phone and the tablet. */
  touch = $derived(this.device !== 'desktop')
  /** The sidebar is a drawer over the note rather than a column beside it, so
   *  it is what a swipe drags and what the scrim dims. A tablet on its side has
   *  room for both and keeps the sidebar open, the way tablet apps do. */
  drawer = $derived(this.device === 'phone' || (this.device === 'tablet' && this.portrait))

  private started = false
  /** The tallest the page has been since the window was last this wide, which
   *  is the page with no keyboard making room for itself. Per width, so turning
   *  the phone on its side starts the measurement again. */
  private tallest = 0
  private atWidth = 0

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    // What the system bars leave for the page, which on Android only the
    // activity knows; see insets.ts.
    startInsets()

    this.shape()
    const shape = () => this.shape()
    window.addEventListener('resize', shape)
    window.addEventListener('orientationchange', shape)

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

  /** Which device this is and which way up, from the window as it stands, said
   *  once in these fields and once on the document for the stylesheets. Every
   *  rule that used to ask a width asks one of these instead, so there is no
   *  screen on which the markup says phone and the stylesheet says desktop.
   *
   *  Orientation is the window's own shape rather than the screen's: no
   *  keyboard is deep enough to turn a screen held upright into one on its
   *  side, and reading the window keeps a browser window dragged into a tall
   *  shape honest as well. */
  private shape() {
    const width = window.innerWidth
    const height = window.innerHeight
    this.device = deviceFor(width, height, isMobile)
    this.portrait = height >= width
    this.narrow = width <= NARROW

    const root = document.documentElement
    root.dataset.device = this.device
    root.toggleAttribute('data-touch', this.touch)
    root.toggleAttribute('data-drawer', this.drawer)
    root.toggleAttribute('data-narrow', this.narrow)
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
 *  A touch device's page is the visual viewport rather than the window: the
 *  keyboard covers the bottom of the window and takes none of its height away,
 *  so a page sized from the window ends underneath the keys with its last rows
 *  out of reach. Everywhere else the window is the page and CSS can say so on
 *  its own. */
export function pageHeight(): string | undefined {
  return viewport.touch && viewport.height ? `${viewport.height}px` : undefined
}
