/** The editor state of every note one pane has open.
 *
 *  A pane has one editor and a strip of tabs. Switching used to build a whole
 *  new editor for the note being switched to, which cost the extensions, the
 *  parse and the first layout, and painted the note at its top before the place
 *  it was left at could be put back. Here each tab keeps its state instead, and
 *  a switch is a swap: see held.ts in the editor package.
 *
 *  One of these per pane, because a tab lives in exactly one pane. */

import { type EditorView, HeldState, type SharedDoc, type StateEffect } from '@nib/editor'

export class EditorStates {
  private readonly held = new Map<string, HeldState>()
  /** What each state is already configured for; see `fitted`. */
  private readonly stamps = new Map<string, string>()
  /** Which tab the view is showing, so a switch knows what to take back. */
  private showing: string | null = null
  /** Whether the note on show has had its place put back. Only the first note a
   *  pane shows can be waiting for that, and putting a place back twice would
   *  scroll a reader who had moved on back to where they came in. */
  private settled = false

  /** How many notes are being kept. What the tests count. */
  get count(): number {
    return this.held.size
  }

  /** Which tab is up, or null before the pane has shown one. */
  get current(): string | null {
    return this.showing
  }

  /** The note the pane's view was built on; see `HeldState.shownIn`. `place` is
   *  where that note was last being read, which the first `show` settles. */
  started(tabId: string, note: SharedDoc, view: EditorView, place: StateEffect<unknown> | null) {
    this.held.set(tabId, HeldState.shownIn(note, view, place))
    this.showing = tabId
  }

  /** What the state kept for a tab is already configured for: the modes, and the
   *  keys. Undefined for a note this pane has not shown yet.
   *
   *  Reconfiguring an editor is not free - a fresh markdown language throws the
   *  parse away, and fresh view plugins redraw everything on screen - so a switch
   *  only does it when the answer here is not what the app holds now. */
  fitted(tabId: string): string | undefined {
    return this.stamps.get(tabId)
  }

  /** Says a state is now configured for `stamp`. */
  fit(tabId: string, stamp: string) {
    this.stamps.set(tabId, stamp)
  }

  /** Shows a tab's note in the pane's view, building its state the first time
   *  the pane shows it.
   *
   *  `effects` is everything the app has to say about the note that is not in
   *  its state - the modes, the keys, the space's links - and it goes into the
   *  same transaction as the place the note was left at, so one frame shows all
   *  of it. Answers whether the state had to be built, which is the difference
   *  between a warm switch and a cold one. */
  show(
    view: EditorView,
    tabId: string,
    build: () => HeldState,
    effects: readonly StateEffect<unknown>[] = [],
  ): boolean {
    const known = this.held.get(tabId)
    const next = known ?? build()
    if (!known) this.held.set(tabId, next)

    if (this.showing === tabId) {
      // Already up: the view was built on it. Its place and everything the app
      // has to say still have to go on, and they go on together.
      if (!this.settled) next.settle(view, effects)
      this.settled = true
      return !known
    }

    this.held.get(this.showing ?? '')?.take(view)
    this.showing = tabId
    this.settled = true
    next.give(view, effects)

    return !known
  }

  /** Lets go of every note but these: what is left after a tab has closed, been
   *  dragged to another pane, or taken its note with it. The one on show stays
   *  whatever the list says, since the view is holding it. */
  keepOnly(tabIds: readonly string[]) {
    for (const [id, state] of this.held) {
      if (id === this.showing || tabIds.includes(id)) continue

      state.release()
      this.held.delete(id)
      this.stamps.delete(id)
    }
  }

  /** Lets go of all of them: the pane has gone. The one on show belongs to the
   *  view, which is about to be destroyed, so its document lets the view go. */
  releaseAll(view: EditorView) {
    for (const [id, state] of this.held) {
      if (id === this.showing) state.close(view)
      else state.release()
    }

    this.held.clear()
    this.stamps.clear()
    this.showing = null
    this.settled = false
  }
}
