/** One undo stack for one canvas.
 *
 *  Whole snapshots rather than a list of edits. Every operation in edits.ts
 *  replaces the nodes it touches instead of changing them in place, so a
 *  snapshot is two arrays of references to nodes that mostly have not moved:
 *  keeping sixty of them costs sixty arrays, not sixty copies of the canvas.
 *
 *  A gesture is one step. A drag of nine nodes across the plane is one thing
 *  somebody did, so what is recorded is the canvas as it stood when the pointer
 *  went down, not as it stood on each of the ninety frames since.
 *
 *  Its own stack, deliberately: Ctrl+Z on a canvas is the canvas's own undo and
 *  never the editor's. The two surfaces have nothing to say to each other. */

import type { Canvas } from './format'

/** Far more steps than anyone reaches back through in one sitting. */
export const KEPT = 60

export class CanvasHistory {
  /** Oldest first. The state before each step, so undoing is taking the last
   *  one off. */
  private past: Canvas[] = []
  /** What undoing put aside, newest first. */
  private future: Canvas[] = []

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** Notes the canvas as it stood before an edit. Anything undone is dropped:
   *  a new edit is a new branch, which is what every undo stack does. */
  record(before: Canvas) {
    this.past.push(before)
    if (this.past.length > KEPT) this.past.shift()
    this.future = []
  }

  /** The state to go back to, given the one on screen. Null when there is
   *  nothing behind it. */
  undo(current: Canvas): Canvas | null {
    const before = this.past.pop()
    if (!before) return null

    this.future.unshift(current)
    return before
  }

  redo(current: Canvas): Canvas | null {
    const after = this.future.shift()
    if (!after) return null

    this.past.push(current)
    return after
  }

  /** Everything forgotten, for a canvas that has been replaced under the
   *  surface: a version restored, or a copy a sync brought over. Undoing back
   *  past that would write somebody else's canvas over the one on screen. */
  clear() {
    this.past = []
    this.future = []
  }
}
