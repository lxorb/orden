/** One open canvas: what is on the plane, what is picked, where it is being
 *  looked at from, and what can be taken back.
 *
 *  The file is the document. A canvas tab holds a NoteDoc like a note does, and
 *  its words are the JSON in the file, so the dirty mark, Ctrl+S, the auto-save
 *  setting, the snapshot before a write and the closing question all work here
 *  without knowing a canvas exists. What this adds is a surface on top of those
 *  words instead of an editor.
 *
 *  The document is written at the end of a gesture and never during one. Dragging
 *  nine cards across the plane is one edit, one undo step and one save, not one
 *  per frame: the surface carries the offset while the pointer is down and hands
 *  the result over when it comes up. That is also what keeps a canvas of five
 *  hundred nodes at sixty frames a second, since nothing is serialised in
 *  between.
 *
 *  Every edit stamps the things it touched with the time. Nothing else in the
 *  app has to know that, and it is what lets two devices drawing on one file keep
 *  both drawings; see canvas-merge.ts. */

import { type Camera, clampScale, framingBox } from '../camera'
import {
  type Canvas,
  emptyCanvas,
  merged,
  readCanvas,
  stamped,
  writeCanvas,
} from './format'
import { pickedBox } from './edits'
import { bounds } from './geometry'
import { strokeBox } from './ink'
import { CanvasHistory } from './history'
import type { NoteDoc, Tab } from '../workspace/documents.svelte'

/** Room left around the canvas when it is framed, in pixels. */
const PADDING = 48

export class CanvasStore {
  /** The plane as it stands. Replaced whole by every edit; see edits.ts. */
  canvas = $state<Canvas>(emptyCanvas())

  /** What is picked, by id: nodes, edges and strokes of ink together, since
   *  Delete and the colour dots mean whatever is picked. */
  picked = $state<string[]>([])

  /** The text node being written in, while one is. One at a time: an editor is
   *  mounted only for this node, which is what keeps five hundred cards cheap. */
  editing = $state<string | null>(null)

  private readonly tab: Tab
  private readonly note: NoteDoc
  private readonly history = new CanvasHistory()
  /** Which revision of the document this surface has read. Anything past it came
   *  from somewhere else and has to be taken on; see `follow`. */
  private at = -1

  constructor(tab: Tab) {
    this.tab = tab
    this.note = tab.note
    this.read()
  }

  get camera(): Camera {
    return this.tab.camera ?? { x: 0, y: 0, scale: 1 }
  }

  set camera(next: Camera) {
    this.tab.camera = { ...next, scale: clampScale(next.scale) }
  }

  /** Whether the view has been settled on anything yet, so a canvas frames itself
   *  once and never again.
   *
   *  An empty plane never counts as framed: there is nothing to frame, and the
   *  cards of one a sync is bringing over arrive a moment after the tab does.
   *  Panning an empty plane does count, because that is somebody choosing where
   *  they want to be. */
  get framed(): boolean {
    return this.tab.camera !== undefined
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  /** The box round everything picked, or null. What the handles are drawn on. */
  get box() {
    return pickedBox(this.canvas, this.picked)
  }

  /** An edit: remembered so it can be taken back, stamped with the time so two
   *  devices can be put back together, and written into the document so it can be
   *  saved. Every gesture ends in exactly one of these.
   *
   *  A canvas that comes back identical is not an edit at all, which is what lets
   *  the operations in edits.ts hand back what they were given when there was
   *  nothing to do. */
  edit(next: Canvas) {
    if (next === this.canvas) return

    this.history.record(this.canvas)
    this.canvas = stamped(this.canvas, next, Date.now())
    this.commit()
  }

  undo() {
    const before = this.history.undo(this.canvas)
    if (!before) return

    // Stamped forwards, not restored: taking an edit back is itself an edit, and
    // a card put back with its old time would be deleted again by the next
    // device to see it.
    this.canvas = stamped(this.canvas, before, Date.now())
    this.keepPicked()
    this.commit()
  }

  redo() {
    const after = this.history.redo(this.canvas)
    if (!after) return

    this.canvas = stamped(this.canvas, after, Date.now())
    this.keepPicked()
    this.commit()
  }

  /** Brings the surface up to words that changed under it: a version restored, a
   *  copy a sync brought over, the file undo putting one back.
   *
   *  A plane somebody has been drawing on is merged with what arrived rather
   *  than replaced by it: both drawings are kept, which is the whole point of
   *  giving everything an id. A plane nobody has touched simply takes the new
   *  words, since there is nothing of ours to keep.
   *
   *  What can be taken back is forgotten either way. Undoing past a canvas
   *  somebody else wrote would put ours over theirs, which is the one thing this
   *  must not do.
   *
   *  Answers whether it took anything on, so the caller can tell a canvas that
   *  arrived from elsewhere from one the reader is drawing. */
  follow(): boolean {
    if (this.note.revision === this.at) return false

    const arrived = readCanvas(this.note.text)
    const ours = this.canvas
    const mine = this.history.canUndo || this.note.dirty

    this.at = this.note.revision
    this.history.clear()

    if (!mine) {
      this.canvas = arrived
      this.keepPicked()
      return true
    }

    const together = merged(ours, arrived)
    this.canvas = together
    this.keepPicked()

    // Written back only when the merge actually kept something of ours, so a
    // canvas that arrived unchanged does not start a round of writes.
    if (writeCanvas(together) !== this.note.text) this.commit()
    return true
  }

  private read() {
    this.canvas = readCanvas(this.note.text)
    this.at = this.note.revision
    this.keepPicked()
  }

  /** The canvas into the document, which marks it unsaved and starts the clock
   *  on the auto-save. The revision is noted so `follow` can tell our own write
   *  from somebody else's. */
  private commit() {
    this.note.replace(writeCanvas(this.canvas))
    this.at = this.note.revision
  }

  /** Only the ids that still name something. A card that has gone cannot be
   *  picked, and an undo that brought one back should not leave it selected by
   *  accident either. */
  private keepPicked() {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read within this call and thrown away; nothing renders from it
    const held = new Set([
      ...this.canvas.nodes.map((node) => node.id),
      ...this.canvas.edges.map((edge) => edge.id),
      ...this.canvas.ink.map((stroke) => stroke.id),
    ])

    const kept = this.picked.filter((id) => held.has(id))
    if (kept.length !== this.picked.length) this.picked = kept
    if (this.editing !== null && !held.has(this.editing)) this.editing = null
  }

  isPicked(id: string): boolean {
    return this.picked.includes(id)
  }

  /** A plain click picks one thing; Shift or Ctrl adds to what is picked and
   *  takes an already-picked one out again, the way a file list does. */
  pick(id: string, adding = false) {
    if (!adding) {
      if (this.picked.length !== 1 || this.picked[0] !== id) this.picked = [id]
      return
    }

    this.picked = this.isPicked(id) ? this.picked.filter((one) => one !== id) : [...this.picked, id]
  }

  /** Several at once: what a rubber band caught, or Ctrl+A. Each id once, so a
   *  band that catches something already picked does not pick it twice. */
  pickAll(ids: readonly string[], adding = false) {
    const wanted = adding ? [...this.picked, ...ids] : ids
    const next = wanted.filter((id, index) => wanted.indexOf(id) === index)
    if (next.length === this.picked.length && next.every((id, at) => this.picked[at] === id)) return

    this.picked = next
  }

  clearPicked() {
    if (this.picked.length) this.picked = []
  }

  /** Everything on the plane in view, with room to spare. What Ctrl+0 does, and
   *  what a canvas does the first time it has anything to show.
   *
   *  An empty plane is left exactly where it is. There is nothing to fit, and
   *  leaving the view unset is also what says the canvas has not been framed yet,
   *  so the first cards to arrive are framed when they do. */
  fit(width: number, height: number) {
    const box = bounds(this.canvas.nodes, this.canvas.ink.map(strokeBox))
    if (box) this.camera = framingBox(box, width, height, PADDING)
  }

  /** Just what is picked in view, which is the other half of the same gesture:
   *  one key frames everything, the same key with something picked frames that. */
  frame(width: number, height: number) {
    const box = this.box
    if (box) this.camera = framingBox(box, width, height, PADDING)
    else this.fit(width, height)
  }
}
