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
 *  between. */

import { type Camera, clampScale, framingBox } from '../camera'
import { type Canvas, emptyCanvas, readCanvas, writeCanvas } from './format'
import { bounds } from './geometry'
import { CanvasHistory } from './history'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { Tab } from '../workspace/documents.svelte'

/** Room left around the canvas when it is framed, in pixels. */
const PADDING = 48

export class CanvasStore {
  /** The plane as it stands. Replaced whole by every edit; see edits.ts. */
  canvas = $state<Canvas>(emptyCanvas())

  /** What is picked, by id: nodes and edges together, since Delete and the
   *  colour dots mean whatever is picked. */
  picked = $state<string[]>([])

  /** The text node being written in, while one is. One at a time: an editor is
   *  mounted only for this node, which is what keeps five hundred cards cheap. */
  editing = $state<string | null>(null)

  /** The group or edge whose label is being typed, while one is. */
  labelling = $state<string | null>(null)

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

  /** An edit: remembered so it can be taken back, and written into the document
   *  so it can be saved. Every gesture ends in exactly one of these.
   *
   *  A canvas that comes back identical is not an edit at all, which is what lets
   *  the operations in edits.ts hand back what they were given when there was
   *  nothing to do. */
  edit(next: Canvas) {
    if (next === this.canvas) return

    this.history.record(this.canvas)
    this.canvas = next
    this.commit()
  }

  undo() {
    const before = this.history.undo(this.canvas)
    if (!before) return

    this.canvas = before
    this.keepPicked()
    this.commit()
  }

  redo() {
    const after = this.history.redo(this.canvas)
    if (!after) return

    this.canvas = after
    this.keepPicked()
    this.commit()
  }

  /** Brings the surface up to words that changed under it: a version restored, a
   *  copy a sync brought over, the file undo putting one back. Called from the
   *  component, which is what watches the document.
   *
   *  What can be taken back goes with it. Undoing past a canvas somebody else
   *  wrote would put ours over theirs, which is the one thing this must not do. */
  follow() {
    if (this.note.revision === this.at) return

    this.read()
    this.history.clear()
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
    ])

    const kept = this.picked.filter((id) => held.has(id))
    if (kept.length !== this.picked.length) this.picked = kept
    if (this.editing !== null && !held.has(this.editing)) this.editing = null
    if (this.labelling !== null && !held.has(this.labelling)) this.labelling = null
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
    this.picked = wanted.filter((id, index) => wanted.indexOf(id) === index)
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
    const box = bounds(this.canvas.nodes)
    if (box) this.camera = framingBox(box, width, height, PADDING)
  }
}
