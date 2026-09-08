/** The canvas on screen and the canvas in the room, kept as one.
 *
 *  The note's binding is a translation between two descriptions of one edit; this
 *  is the same idea one level up. An edit on the plane replaces the objects it
 *  touched and hands back the very same objects for everything else, so what
 *  changed is a handful of identity comparisons and what goes into the room is the
 *  card that moved or the stroke the pen just finished. Nothing anywhere serialises
 *  the plane to find out what happened.
 *
 *  Coming the other way it is the same in reverse. What the room says changed names
 *  the ids; everything else on the plane comes back as the object it already was, so
 *  a stroke arriving from another device does not invalidate the traced outline of
 *  the five thousand strokes that were already there.
 *
 *  **Undo stays yours.** A `Y.UndoManager` watching only this device's own
 *  transactions is the whole of it: pressing undo takes back the last thing you did
 *  and never the last thing that happened. Joining is not one of those things, so
 *  the merge that brings the two together is marked as neither device's and is not a
 *  step to take back.
 *
 *  **Joining.** A note asks which side is ahead and folds one way; a canvas does not
 *  have to ask. Everything on a plane has an id and a time, so the room's plane and
 *  this device's file are merged - the same symmetric merge two files get, in
 *  canvas-merge.ts - and both drawings are kept whichever device was away. Nothing
 *  is watched until that has happened: a plane somebody has been drawing on must not
 *  be replaced by the room's before the two have been compared. */

import { merged } from '@nib/markdown/canvas-merge'
import { planeIsEmpty, pushPlane, readPlane, rootsOf } from '@nib/rooms/plane'
import * as Y from 'yjs'
import type { Canvas } from '../canvas/format'
import type { PlaneSurface } from '../canvas/shared'
import { HERE } from './door'

/** Where the merge that joins the two is marked as having come from: neither this
 *  device nor the room, so it is nobody's to undo. */
const JOINED = 'joined'

export class PlaneBinding {
  private readonly history: Y.UndoManager
  /** The two root maps the plane lives in; see plane.ts in @nib/rooms. Watched
   *  together, so one gesture that moved a card and deleted another is one step. */
  private readonly watched: Y.Map<unknown>[]
  private readonly heard: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void
  private watching = false

  constructor(
    private readonly doc: Y.Doc,
    private readonly surface: PlaneSurface,
  ) {
    this.watched = rootsOf(doc)

    // Only this device's own edits, which is the whole of "undo stays yours". No
    // capture window either: a gesture is one edit and one step, and two strokes
    // drawn a moment apart are two things somebody did.
    this.history = new Y.UndoManager(this.watched, {
      trackedOrigins: new Set([HERE]),
      captureTimeout: 0,
    })

    this.heard = (events) => {
      const ids = changedIn(events)
      if (ids.size) this.surface.arrived(readPlane(doc, this.surface.canvas, ids))
    }
  }

  /** The room's plane and this device's file, brought together, and the surface
   *  joined to the room from here on.
   *
   *  A room with nothing in it is a room this device is the first into, and its own
   *  plane is the whole answer. Otherwise the two are merged, and whatever the merge
   *  kept of ours goes into the room as the edit it is. */
  together() {
    const mine = this.surface.canvas

    if (planeIsEmpty(this.doc)) {
      this.write(EMPTY, mine)
    } else {
      const theirs = readPlane(this.doc)
      this.write(theirs, merged(mine, theirs))
    }

    for (const map of this.watched) map.observeDeep(this.heard)
    this.watching = true
    this.surface.arrived(readPlane(this.doc))
  }

  /** An edit made here, on its way into the room. `after` is already stamped, so
   *  its times are the ones the room writes down. */
  push(before: Canvas, after: Canvas) {
    this.doc.transact(() => pushPlane(this.doc, before, after), HERE)
  }

  get canUndo(): boolean {
    return this.history.canUndo()
  }

  get canRedo(): boolean {
    return this.history.canRedo()
  }

  /** Answers whether there was anything to take back. The change lands in the
   *  document and comes back through the observer like any other, so the surface,
   *  the other devices and the file all hear about it the one way. */
  undo(): boolean {
    return this.history.undo() !== null
  }

  redo(): boolean {
    return this.history.redo() !== null
  }

  part() {
    if (this.watching) {
      for (const map of this.watched) map.unobserveDeep(this.heard)
      this.watching = false
    }

    this.history.destroy()
  }

  private write(before: Canvas, after: Canvas) {
    this.doc.transact(() => pushPlane(this.doc, before, after), JOINED)
  }
}

/** A canvas with nothing on it, for the first device into a room. */
const EMPTY: Canvas = { nodes: [], edges: [], ink: [], at: {}, gone: {} }

/** Which ids a batch of events touched.
 *
 *  An event on one of the two root maps names the ids in its own changed keys; an
 *  event on an object's own map is about the object it hangs on, which is the first
 *  step of the path down from the root. */
function changedIn(events: readonly Y.YEvent<Y.AbstractType<unknown>>[]): Set<string> {
  const ids = new Set<string>()

  for (const event of events) {
    const [first] = event.path

    if (typeof first === 'string') {
      ids.add(first)
      continue
    }

    for (const key of event.changes.keys.keys()) ids.add(key)
  }

  return ids
}
