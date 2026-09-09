import { isDesktop } from './tauri'
import { stageUpdate } from './updater'

/** How often the app looks for a new version while it is running.
 *
 *  A few hours. A release is not news that has to arrive within a minute, and
 *  what is found installs itself on the way out whether or not anybody presses
 *  the notice, so looking more often would only be traffic. Looking less often
 *  than this is how a machine that is never restarted ends up months behind. */
const EVERY = 6 * 60 * 60 * 1000

/** How often the timer wakes to ask whether it is time yet.
 *
 *  Short, and it asks the clock rather than trusting itself: a lid closed at
 *  lunch stops the timers and does not make up the difference, so one long timer
 *  would fire late and only once. This wakes, reads the clock, and catches up. */
const TICK = 10 * 60 * 1000

/** How long since the last keystroke before the notice may appear. A box that
 *  arrives between two words is a box in the way; the update is in no hurry, so
 *  it waits for the end of the sentence. */
const QUIET = 5000

/** The notice that offers a downloaded update.
 *
 *  Nothing here installs anything: `updater.ts` downloads in the background and
 *  puts the new version in place as the app closes, so the update arrives on
 *  its own. This is only the offer to get there sooner, and dismissing it costs
 *  nothing - what was downloaded is still installed on the way out. */
class Updates {
  /** The version waiting to be installed, once one has been downloaded. Null
   *  when there is nothing new, which is most of the time. */
  ready = $state<string | null>(null)

  /** When the last look happened, so that however many things ask - the timer,
   *  the window being come back to, the menu - nothing looks twice inside one
   *  interval. Zero before the first one. */
  private lookedAt = 0
  /** Whether a look is in flight. A download takes long enough for the window to
   *  be left and come back to while one is running. */
  private looking = false
  /** When the last key went down, for the notice that waits for a pause. */
  private typedAt = 0
  private waiting: ReturnType<typeof setTimeout> | undefined

  /** Looks now, and goes on looking for as long as the app runs: on a timer
   *  every few hours, and again whenever the window is come back to after that
   *  long away. Answers the teardown for both.
   *
   *  Desktop only, because that is the only build that installs anything: a page
   *  is the new version the moment it is reloaded, and a phone app is the store's
   *  business. Nothing at all runs on those, rather than a timer that would ask
   *  and always be told no. */
  start(): () => void {
    if (!isDesktop) return () => undefined

    // The launch's own look, which is not held to the interval: this session has
    // not looked yet.
    void this.check()

    const timer = setInterval(() => void this.lookIfDue(), TICK)
    const returned = () => void this.lookIfDue()
    const typed = () => (this.typedAt = Date.now())

    window.addEventListener('focus', returned)
    // Captured, so a keystroke the editor swallows still counts as typing.
    window.addEventListener('keydown', typed, true)

    return () => {
      clearInterval(timer)
      clearTimeout(this.waiting)
      window.removeEventListener('focus', returned)
      window.removeEventListener('keydown', typed, true)
    }
  }

  /** A look, if it has been long enough since the last one. What the timer and
   *  the window coming back both ask for: the two are one question, since a
   *  machine that was asleep is exactly the machine whose timer is behind. */
  private async lookIfDue() {
    if (Date.now() - this.lookedAt < EVERY) return
    await this.check()
  }

  /** One quiet look, whatever the clock says. What the launch does, and what
   *  asking for it by name from the menu or the palette does.
   *
   *  A machine with no network simply has no update to offer: `stageUpdate`
   *  answers nothing for that as it does for a version already downloaded and
   *  for a release that does not exist, so there is nothing here to report. */
  async check() {
    if (this.looking) return

    this.looking = true
    this.lookedAt = Date.now()
    try {
      const found = await stageUpdate()
      // Only ever set, never cleared: a second look answers nothing for the
      // version it downloaded on the first, and clearing the notice then would
      // take away the offer while the update sat there waiting.
      if (found) this.offer(found)
    } finally {
      this.looking = false
    }
  }

  /** Says so, once whoever is at the keyboard has stopped for a moment. */
  private offer(version: string) {
    clearTimeout(this.waiting)

    const since = Date.now() - this.typedAt
    if (since >= QUIET) {
      this.ready = version
      return
    }

    this.waiting = setTimeout(() => this.offer(version), QUIET - since)
  }

  dismiss() {
    clearTimeout(this.waiting)
    this.ready = null
  }
}

export const updates = new Updates()
