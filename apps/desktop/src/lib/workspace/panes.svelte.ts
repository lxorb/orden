/** Which panes there are, which one has the focus, and what a drag over them
 *  would do. The shape of the tree and every operation on it is next door in
 *  pane-tree.ts; this is the state around it.
 *
 *  The focus is marked quietly, in the tab strip of the pane that has it rather
 *  than by a border around the words: a line around the text someone is writing
 *  is a line they have to read past. Everything a key or a palette command does
 *  happens in the focused pane. */

import { identifier } from '../identifier'
import {
  type Along,
  canSplit,
  clamped,
  EQUAL,
  type Frame,
  nextPane,
  pane,
  type Pane,
  paneIn,
  panesIn,
  withFraction,
  withoutPane,
  withSplit,
} from './pane-tree'

/** Where a dragged tab would land: along the right edge of a pane, along its
 *  bottom edge, or in the pane itself. */
export interface Landing {
  paneId: string
  /** The direction the drop would split in, or null to take the tab in. */
  along: Along | null
}

export class Panes {
  frame = $state<Frame>(pane(identifier()))
  focusedId = $state('')

  /** The divider under a pointer, while one is, so that split follows the finger
   *  instead of easing after it. */
  sliding = $state<string | null>(null)

  /** The tab being dragged out of a strip, while it is. What lights the drop
   *  zones: they are there to be aimed at, and nothing else should show them. */
  dragging = $state<string | null>(null)

  /** The drop zone the dragged tab is over, lit while it is. */
  landing = $state<Landing | null>(null)

  /** Called whenever the arrangement changes, so the session is written down. */
  private readonly changed: () => void

  constructor(changed: () => void) {
    const first = pane(identifier())
    this.frame = first
    this.focusedId = first.id
    this.changed = changed
  }

  readonly all: Pane[] = $derived(panesIn(this.frame))
  readonly count: number = $derived(this.all.length)

  readonly focused: Pane = $derived.by(() => {
    const [first] = this.all
    // A frame always holds at least one pane, so `first` is only ever missing
    // to the compiler. A fresh one keeps the type honest without a cast.
    return paneIn(this.frame, this.focusedId) ?? first ?? pane(this.focusedId)
  })

  at(id: string): Pane | null {
    return paneIn(this.frame, id)
  }

  focus(id: string) {
    if (id === this.focusedId || !paneIn(this.frame, id)) return

    this.focusedId = id
    this.changed()
  }

  /** The next pane round. One key for all of them: with four at most, cycling
   *  is quicker to press than four directions are to remember. */
  focusNext() {
    const next = nextPane(this.frame, this.focusedId)
    if (next) this.focus(next.id)
  }

  splittable(along: Along, id: string = this.focusedId): boolean {
    return canSplit(this.frame, id, along)
  }

  /** Puts a pane beside or below one, and gives it the focus. Answers the new
   *  pane, or null when that one has split as far as it may. */
  split(along: Along, id: string = this.focusedId): Pane | null {
    if (!canSplit(this.frame, id, along)) return null

    const made = pane(identifier())
    this.frame = withSplit(this.frame, id, along, made, identifier())
    this.focusedId = made.id
    this.changed()

    // The pane in the tree, not the one just built: the tree is reactive state,
    // and what it holds is a proxy of what went in.
    return paneIn(this.frame, made.id)
  }

  /** Takes a pane away; its sibling takes the room. The last pane stays, since
   *  a window with no pane has nowhere to put a note. */
  close(id: string): boolean {
    if (this.count < 2) return false

    this.frame = withoutPane(this.frame, id)
    if (!paneIn(this.frame, this.focusedId)) this.focusedId = this.all[0]?.id ?? this.focusedId

    this.changed()
    return true
  }

  /** Follows the divider under the pointer. Not written down on every move: the
   *  drag ends with `settle`. */
  resize(id: string, fraction: number, room: number) {
    this.frame = withFraction(this.frame, id, clamped(fraction, room))
  }

  settle() {
    this.sliding = null
    this.changed()
  }

  /** A double click on a divider: both sides the same again. */
  equalise(id: string) {
    this.frame = withFraction(this.frame, id, EQUAL)
    this.changed()
  }

  /** Whether a pane scrolls with the other one on the same note. Set for both
   *  ends at once by the workspace, which is what knows they are a pair. */
  setLinked(id: string, on: boolean) {
    const one = paneIn(this.frame, id)
    if (!one || one.linked === on) return

    one.linked = on
    this.changed()
  }

  activate(id: string, tabId: string | null) {
    const one = paneIn(this.frame, id)
    if (!one || one.activeTabId === tabId) return

    one.activeTabId = tabId
    this.changed()
  }

  /** One pane again, keeping the focused one. What a phone gets, where there is
   *  no room to put two notes beside each other; the tabs are moved into it by
   *  the workspace, which is what owns them. */
  collapse() {
    if (this.count < 2) return

    const kept = this.focused
    this.frame = pane(kept.id, kept.activeTabId)
    this.focusedId = kept.id
    this.changed()
  }

  /** An arrangement read back from the session or from a saved layout. */
  restore(frame: Frame, focusedId: string) {
    this.frame = frame
    this.focusedId = paneIn(frame, focusedId) ? focusedId : (panesIn(frame)[0]?.id ?? focusedId)
  }
}
