import { keep, storedText } from './stored'
import { isDesktop } from './tauri'
import { asChannel, type Channel, discard, stageUpdate } from './updater'

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

/** Which channel this machine follows, written here rather than sent up to the
 *  account: one machine can run the build of main while another stays on the
 *  releases, which is the whole point of the choice. */
const CHANNEL_KEY = 'nib:channel'

/** The choice, written down. It holds for this run whichever way that goes; a
 *  machine that cannot keep it follows the releases again after a restart. */
function keepChannel(channel: Channel) {
  keep(CHANNEL_KEY, channel)
}

/** How long since the last keystroke before the notice may appear. A box that
 *  arrives between two words is a box in the way; the update is in no hurry, so
 *  it waits for the end of the sentence. */
const QUIET = 5000

/** When the app looks for a new version, which stream it looks on, and the notice
 *  that offers what a look found.
 *
 *  Nothing here installs anything: `updater.ts` downloads in the background and
 *  puts the new version in place as the app closes, so the update arrives on
 *  its own. This is only the offer to get there sooner, and dismissing it costs
 *  nothing - what was downloaded is still installed on the way out. */
class Updates {
  /** The version waiting to be installed, once one has been downloaded. Null
   *  when there is nothing new, which is most of the time. */
  ready = $state<string | null>(null)

  /** Which stream of releases this machine follows; see updater.ts. Stable, until
   *  somebody asks for the other one on this machine. */
  /** What was chosen here last, or the stable channel for a machine that has
   *  never chosen - which is also what a machine that cannot remember follows. */
  channel = $state<Channel>(asChannel(storedText(CHANNEL_KEY)))

  /** When the last look happened, so that however many things ask - the timer,
   *  the window being come back to, the menu - nothing looks twice inside one
   *  interval. Zero before the first one. */
  private lookedAt = 0
  /** Whether a look is in flight. A download takes long enough for the window to
   *  be left and come back to while one is running. */
  private looking = false
  /** Which channel the looks belong to, counted up whenever it changes. A look
   *  takes as long as a download, so one can be in flight when the channel is
   *  changed, and what it comes back with is a build from the stream that was
   *  left. */
  private stream = 0
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

    const stream = this.stream
    this.looking = true
    this.lookedAt = Date.now()
    try {
      const found = await stageUpdate(this.channel)
      // The channel changed while this was running, so what it fetched is a build
      // of the stream nobody is following any more.
      if (this.stream !== stream) {
        await discard()
        return
      }

      // Only ever set, never cleared: a second look answers nothing for the
      // version it downloaded on the first, and clearing the notice then would
      // take away the offer while the update sat there waiting.
      if (found) this.offer(found)
    } finally {
      this.looking = false
    }
  }

  /** Follows the other stream from now on, and looks again straight away so that
   *  the choice answers instead of waiting hours for the next look.
   *
   *  Whatever was downloaded from the stream being left is thrown away rather than
   *  installed: a build of main is not what somebody who has just asked for the
   *  releases wants started next time. Nothing is installed the other way round
   *  either - the updater only ever offers a higher version, so a machine on a
   *  build of main that asks for the releases stays on it until a release passes
   *  it, while one on a release is offered the next push. */
  setChannel(channel: Channel) {
    if (channel === this.channel) return

    this.channel = channel
    keepChannel(channel)
    this.stream++
    this.dismiss()
    // Zero, so the look the timer makes is due even if this one cannot be made
    // now: a look that is already in flight belongs to the channel that was left,
    // and `check` turns this one away while it runs.
    this.lookedAt = 0
    void discard().then(() => this.check())
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
