/** Two things the layout has to answer to on a phone that CSS cannot see: how
 *  much of the window the on-screen keyboard is covering, and whether this is a
 *  phone at all. Both come from the visual viewport, which is the only thing
 *  that shrinks when the keyboard opens. */

const PHONE = '(max-width: 720px)'
/** Where the drawer is the whole width of the screen. The same breakpoint the
 *  stylesheets use for it. */
const NARROW = '(max-width: 460px)'

class Viewport {
  /** Pixels of the window hidden behind the keyboard. Zero when it is closed. */
  keyboard = $state(0)
  phone = $state(false)
  /** A phone so narrow that the drawer, open, covers all of it. */
  narrow = $state(false)
  /** True while the app is running as an installed app rather than a tab. */
  installed = $state(false)

  private started = false

  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true

    const phone = window.matchMedia(PHONE)
    this.phone = phone.matches
    phone.addEventListener('change', (event) => (this.phone = event.matches))

    const narrow = window.matchMedia(NARROW)
    this.narrow = narrow.matches
    narrow.addEventListener('change', (event) => (this.narrow = event.matches))

    const standalone = window.matchMedia('(display-mode: standalone)')
    this.installed = standalone.matches
    standalone.addEventListener('change', (event) => (this.installed = event.matches))

    const seen = window.visualViewport
    if (!seen) return

    const measure = () => {
      // What the layout viewport has that the visual one does not. Scrolling
      // the page moves `offsetTop`, so it has to come off as well or the bar
      // jumps while the document scrolls under the keyboard.
      const hidden = window.innerHeight - (seen.height + seen.offsetTop)
      this.keyboard = Math.max(0, Math.round(hidden))
    }

    measure()
    seen.addEventListener('resize', measure)
    seen.addEventListener('scroll', measure)
  }
}

export const viewport = new Viewport()

/** Whether the keyboard is up, which is the only reliable signal that someone
 *  is typing rather than reading. A few pixels of browser chrome sliding away
 *  is not a keyboard. */
export const KEYBOARD_THRESHOLD = 120
