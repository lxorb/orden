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
 *  So the app says so. Over the whole surface for exactly as long as it has
 *  nothing to say anything about, and no longer: the first thing the pass learns
 *  is the *names* - the spaces and what is in them, one request each and no
 *  bodies - so the file list can be right within a second of signing in while the
 *  writing itself is still coming down behind it. A row whose body has not landed
 *  is a row like any other; clicking it says so. What is left of the full-surface
 *  state after that is a count in the panel's foot, which is what somebody who
 *  can already see their notes actually wants to know.
 *
 *  Every later pass stays quiet: the light is right for a pass nobody is waiting
 *  on, and a screen that greys itself out every few minutes would be worse than
 *  one that never did.
 *
 *  What is not here: any decision about whether a pass is the first one. That
 *  belongs to the loop, which is the thing that knows; see sync.svelte.ts. This
 *  file only holds up the state it is told to hold up, counts, and makes sure
 *  nobody is ever stuck behind it. */

import { SvelteSet } from 'svelte/reactivity'
import { t } from './i18n.svelte'

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

  /** Notes the account has named that this machine has not written yet, by the
   *  path they will have here.
   *
   *  The file list draws them as rows, so a space is listed as soon as the pass
   *  has its listing rather than once every body has come down; see `withComing`
   *  in tree-edits.ts. A set, because a page of changes can name a note twice
   *  over two passes and a row is a row either way. */
  private readonly onTheWay = new SvelteSet<string>()

  private timer: ReturnType<typeof setTimeout> | null = null

  /** What the pass has to say about itself, in as few words as it can. A count
   *  once it knows one, and the app's own word for this until then: two things
   *  saying one thing is one too many. */
  readonly said = $derived(
    this.total === null || this.total === 0
      ? t('Syncing')
      : t('{done} of {total}', {
          done: Math.min(this.done, this.total),
          total: this.total,
        }),
  )

  /** Rows for notes whose bodies are still coming. */
  get coming(): ReadonlySet<string> {
    return this.onTheWay
  }

  /** There is a session and nothing of this account's writing here yet. Raised
   *  before the pass has asked the account anything, because the asking is
   *  itself a round trip and a blank screen during it is the whole complaint. */
  begin() {
    this.done = 0
    this.total = null
    this.stuck = false
    this.showing = true
    this.onTheWay.clear()
    this.wait()
  }

  /** Names the pass has read out of a page of changes, before it has fetched a
   *  single body. Absolute paths, because that is what a row in the list is.
   *
   *  Kept whether or not the state is showing: a later pass bringing a note this
   *  machine has never had is a row worth showing the same way, and it costs one
   *  string until the body lands a moment later. */
  listing(paths: readonly string[]) {
    for (const path of paths) this.onTheWay.add(path)
  }

  /** One note written, by the path it landed at. Counted, and no longer coming. */
  landed(path: string) {
    this.onTheWay.delete(path)
    this.arrived()
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
    this.onTheWay.clear()
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
