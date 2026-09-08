/** The first pass, while it is still the only thing between somebody and their
 *  writing.
 *
 *  Signing in on a machine that has never held the account is the one moment
 *  where the app has nothing of theirs to show and cannot get it in a frame: the
 *  pass has to list the spaces, make the folders and take every note down, and
 *  on a slow connection that is half a minute. For that half minute the corner's
 *  sync light is the whole report, which is no report at all - the screen shows
 *  the welcome note and an empty file list, and the honest reading of that is
 *  that the notes are gone.
 *
 *  So the app says so, over the whole surface, and does not let anybody type into
 *  a note that is half arrived. Every later pass stays quiet: the light is right
 *  for a pass nobody is waiting on, and a screen that greys itself out every few
 *  minutes would be worse than one that never did.
 *
 *  What is not here: any decision about whether a pass is the first one. That
 *  belongs to the loop, which is the thing that knows; see sync.svelte.ts. This
 *  file only holds up the state it is told to hold up, counts, and makes sure
 *  nobody is ever stuck behind it. */

/** How long with nothing arriving before the way out is offered.
 *
 *  A pass that is moving keeps the block, however slow it is: that is the case it
 *  exists for. A pass that has stopped moving may never come back - a radio that
 *  went, a Worker that is not there - and waiting on it forever is a trap. Every
 *  note that lands starts the count again. */
const STUCK = 6000

class Arriving {
  /** Notes this pass has written so far. */
  done = $state(0)
  /** How many it set out to write, once the pass has asked the account. Null
   *  before that, which is why the state says a word rather than a count until
   *  the first listing is in. */
  total = $state<number | null>(null)
  /** Whether the full-surface state is up. */
  showing = $state(false)
  /** Whether the way out is being offered, because nothing has arrived for a
   *  while and this may not be a wait that ends. */
  stuck = $state(false)

  private timer: ReturnType<typeof setTimeout> | null = null

  /** There is a session and nothing of this account's writing here yet. Raised
   *  before the pass has asked the account anything, because the asking is
   *  itself a round trip and a blank screen during it is the whole complaint. */
  begin() {
    this.done = 0
    this.total = null
    this.stuck = false
    this.showing = true
    this.wait()
  }

  /** What the pass now knows it is bringing down. Nothing coming means nothing
   *  to wait for, so the state goes rather than sitting at "0 of 0". */
  expect(notes: number) {
    if (!this.showing) return

    this.total = notes
    if (notes === 0) this.finish()
  }

  /** One note written. */
  arrived() {
    if (!this.showing) return

    this.done += 1
    // Something is moving, so the way out is not needed and the count to it
    // starts again from here.
    this.stuck = false
    this.wait()
  }

  /** The pass ended, however it ended. An errored pass lifts the state too: the
   *  light in the corner says what happened, and there is nothing more coming
   *  that keeping somebody out would be waiting for. */
  settled() {
    if (!this.showing) return

    this.finish()
  }

  /** Carry on with what is here. The pass is left running: it may still land,
   *  and when it does the tree fills in behind them the way any later pass
   *  fills it in. */
  giveUp() {
    this.finish()
  }

  /** Signing out, and switching accounts. Whatever was being waited for is not
   *  this account's business any more. */
  reset() {
    this.finish()
    this.done = 0
    this.total = null
  }

  private finish() {
    this.showing = false
    this.stuck = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private wait() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.stuck = true
    }, STUCK)
  }
}

export const arriving = new Arriving()
