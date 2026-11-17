import { merged } from '@orden/markdown/canvas-merge'
import { planeIsEmpty, pushPlane, readPlane, rootsOf } from '@orden/rooms/plane'
import * as Y from 'yjs'
import type { Canvas } from '@orden/markdown/canvas'
import type { PlaneSurface } from '@orden/markdown/plane'
import { moved } from './bind'
import { HERE } from './door'

const JOINED = 'joined'

const STACK = ['stack-item-added', 'stack-item-popped', 'stack-cleared'] as const

export class PlaneBinding {
  private readonly history: Y.UndoManager
  private readonly watched: Y.Map<unknown>[]
  private readonly heard: (events: Y.YEvent<Y.AbstractType<unknown>>[]) => void
  private readonly told: () => void
  private watching = false

  constructor(
    private readonly doc: Y.Doc,
    private readonly surface: PlaneSurface,
    private readonly holds: () => boolean,
    private readonly joinedBy: string = JOINED,
  ) {
    this.watched = rootsOf(doc)

    this.history = new Y.UndoManager(this.watched, {
      trackedOrigins: new Set([HERE]),
      captureTimeout: 0,
    })

    this.told = () => {
      this.surface.historyIs({ undo: this.history.canUndo(), redo: this.history.canRedo() })
    }

    for (const change of STACK) this.history.on(change, this.told)

    this.heard = (events) => {
      if (!this.holds()) {
        moved('a change from another device')
        return
      }

      if (events[0]?.transaction.origin === HERE) return

      const ids = changedIn(events)
      if (ids.size) this.surface.arrived(readPlane(doc, this.surface.canvas, ids))
    }
  }

  together() {
    const mine = this.surface.canvas

    if (planeIsEmpty(this.doc)) {
      this.write(EMPTY, mine)
    } else {
      const theirs = readPlane(this.doc)
      this.write(theirs, unchanged(merged(mine, theirs), theirs))
    }

    for (const map of this.watched) map.observeDeep(this.heard)
    this.watching = true
    this.surface.arrived(readPlane(this.doc))
  }

  push(before: Canvas, after: Canvas) {
    if (!this.holds()) {
      moved('an edit made in it')
      return
    }

    this.doc.transact(() => pushPlane(this.doc, before, after), HERE)
  }

  undo(): boolean {
    if (!this.holds()) {
      moved('an undo')
      return false
    }

    return this.history.undo() !== null
  }

  redo(): boolean {
    if (!this.holds()) {
      moved('a redo')
      return false
    }

    return this.history.redo() !== null
  }

  part() {
    if (this.watching) {
      for (const map of this.watched) map.unobserveDeep(this.heard)
      this.watching = false
    }

    for (const change of STACK) this.history.off(change, this.told)
    this.history.destroy()
  }

  private write(before: Canvas, after: Canvas) {
    this.doc.transact(() => pushPlane(this.doc, before, after), this.joinedBy)
  }
}

function unchanged(together: Canvas, theirs: Canvas): Canvas {
  const held = new Map<string, unknown>()
  for (const thing of [...theirs.nodes, ...theirs.edges, ...theirs.ink]) held.set(thing.id, thing)
  const same = <T extends { id: string }>(thing: T): T => {
    const one = held.get(thing.id)
    return one !== undefined && JSON.stringify(one) === JSON.stringify(thing) ? (one as T) : thing
  }
  return {
    ...together,
    nodes: together.nodes.map(same),
    edges: together.edges.map(same),
    ink: together.ink.map(same),
  }
}

const EMPTY: Canvas = { nodes: [], edges: [], ink: [], at: {}, gone: {} }

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
