/** The editor state of every note one pane has open.
 *
 *  A pane has one editor and a strip of tabs. Switching used to build a whole
 *  new editor for the note being switched to, which cost the extensions, the
 *  parse and the first layout, and painted the note at its top before the place
 *  it was left at could be put back. Here each tab keeps its state instead, and
 *  a switch is a swap: see held.ts in the editor package.
 *
 *  One of these per pane, because a tab lives in exactly one pane. */

import { HeldState, type SharedDoc, type StateEffect, type StateView } from '@nib/editor'

/** What a state is kept under: the tab, and which note the tab is on.
 *
 *  Almost always the tab alone would do. The exception is the one tab that
 *  previews a note: it moves on to another note without becoming another tab,
 *  and the note it moves to has its own caret and its own place. A rename does
 *  not count, which is why this asks the document how many notes it has held
 *  rather than which path it is on. */
export function noteKey(tab: { id: string; note: { arrivals: number } }): string {
  return `${tab.id} ${tab.note.arrivals}`
}

export class EditorStates {
  private readonly held = new Map<string, HeldState>()
  /** What each state is already configured for; see `fitted`. */
  private readonly stamps = new Map<string, string>()
  /** Which note the view is showing, so a switch knows what to take back. */
  private showing: string | null = null
  /** Whether the note on show has had its place put back. Only the first note a
   *  pane shows can be waiting for that, and putting a place back twice would
   *  scroll a reader who had moved on back to where they came in. */
  private settled = false

  /** How many notes are being kept. What the tests count. */
  get count(): number {
    return this.held.size
  }

  /** Which note is up, or null before the pane has shown one. */
  get current(): string | null {
    return this.showing
  }

  /** The note the pane's view was built on; see `HeldState.shownIn`. `place` is
   *  where that note was last being read, which the first `show` settles. */
  started(key: string, note: SharedDoc, view: StateView, place: StateEffect<unknown> | null) {
    this.held.set(key, HeldState.shownIn(note, view, place))
    this.showing = key
  }

  /** What the state kept for a note is already configured for: the modes, and
   *  the keyboard. Undefined for a note this pane has not shown yet.
   *
   *  Reconfiguring an editor is not free - a fresh markdown language throws the
   *  parse away, and fresh view plugins redraw everything on screen - so a switch
   *  only does it when the answer here is not what the app holds now. */
  fitted(key: string): string | undefined {
    return this.stamps.get(key)
  }

  /** Says a state is now configured for `stamp`. */
  fit(key: string, stamp: string) {
    this.stamps.set(key, stamp)
  }

  /** Shows a note in the pane's view, building its state the first time the pane
   *  shows it. `key` names the note within this pane; see `noteKey`.
   *
   *  `effects` is everything the app has to say about the note that is not in
   *  its state - the modes, the keys, the space's links - and it goes into the
   *  same transaction as the place the note was left at, so one frame shows all
   *  of it. Answers whether the state had to be built, which is the difference
   *  between a warm switch and a cold one. */
  show(
    view: StateView,
    key: string,
    build: () => HeldState,
    effects: readonly StateEffect<unknown>[] = [],
  ): boolean {
    const known = this.held.get(key)
    const next = known ?? build()
    if (!known) this.held.set(key, next)

    if (this.showing === key) {
      // Already up. The first time round the view was built on it and its place
      // has still to be put back, with everything else in the same transaction;
      // after that the place is where the reader left it, and only what the app
      // has to say is news.
      if (this.settled) {
        if (effects.length) view.dispatch({ effects: [...effects] })
      } else next.settle(view, effects)

      this.settled = true
      return !known
    }

    this.held.get(this.showing ?? '')?.take(view)
    this.showing = key
    this.settled = true
    next.give(view, effects)

    return !known
  }

  /** Lets go of every note but these: what is left after a tab has closed, been
   *  dragged to another pane, or moved on to another note. The one on show stays
   *  whatever the list says, since the view is holding it. */
  keepOnly(keys: readonly string[]) {
    for (const [id, state] of this.held) {
      if (id === this.showing || keys.includes(id)) continue

      state.release()
      this.held.delete(id)
      this.stamps.delete(id)
    }
  }

  /** Lets go of all of them: the pane has gone. The one on show belongs to the
   *  view, which is about to be destroyed, so its document lets the view go. */
  releaseAll(view: StateView) {
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
