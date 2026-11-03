/** An open note and its document, kept as one (docs/sync-v2.md section 9.3).
 *
 *  A note opens with its file's words at once - the file is read as it always was - and
 *  the document is read from the store a moment later and joined to it through the
 *  binding a room uses (rooms/bind.ts): a keystroke goes into the document as the
 *  operation it is, and what arrives in the document - a pull, a room, the engine's
 *  own merge - comes back into the note as the edit it is, so no caret moves.
 *
 *  The moment of joining is the one to get right, because the two may not agree:
 *
 *  - the note was typed in during the moment the document took to arrive, or the file
 *    was written by another program while Orden was closed: the note is ahead, and what
 *    it says goes into the document as this device's edits;
 *  - the document has words the file had not been written with yet (another device's,
 *    pulled while this note was closed and its file not yet written): the document is
 *    ahead, and its words go into the note;
 *  - both moved: the three-way rule another program's edit gets, against the words Orden
 *    last wrote (ingest.ts).
 *
 *  A canvas or a page note is joined through the binding a canvas's room uses
 *  (rooms/plane-bind.ts), whose join is the merge two canvas files get: every object
 *  has an id and a time, so both sides are kept whichever is ahead, and what the plane
 *  had that the document did not goes in as this device's. */

import type { SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { fold } from '@orden/rooms/fold'
import type * as Y from 'yjs'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'
import { bind } from '../rooms/bind'
import { PlaneBinding } from '../rooms/plane-bind'
import { MINE, type Doc } from './docs'
import type { Engine } from './engine'
import { writtenOf } from './ingest'
import { judge, mergedOf, turn } from './kinds'

/** The words of a note as its views hold them now. */
export interface Held {
  readonly live: SharedDoc
  readonly latest: string
}

/** Puts `to` into a note that reads `from`, as one edit, keeping every caret. */
function arrive(note: Held, from: string, to: string) {
  const change = fold(from, to)
  if (change) note.live.arrived([change])
}

/** How a meeting of a note and its document ended: one text, or the note held. */
type Met = { shared: string; asked?: never } | { asked: string; shared?: never }

/** Brings a note and its document to one text, as above. Answers the words they shared as
 *  it ended, or, where the two each moved and the rule asks, the words the note said as
 *  the question went up: the note is held, and the next meeting is against those (#543).
 *
 *  `given` is the words both sides last shared, where the caller knows them better than
 *  the file Orden last wrote: after a hold, what the note said when it was asked. */
async function agree(
  engine: Engine,
  id: string,
  note: Held,
  doc: Doc,
  given?: string,
): Promise<Met> {
  if (note.latest === doc.text()) return { shared: doc.text() }

  const written = given ?? (await writtenOf(engine.core, id))
  // Read after that wait, not before: what a pull or a key brought meanwhile is one of
  // the two sides, and a change made from a stale text would take it out.
  const mine = note.latest
  const theirs = doc.text()
  if (mine === theirs) return { shared: theirs }

  const base = written ?? theirs
  if (theirs === base) {
    doc.write((live) => turn('words', live, theirs, mine, MINE))
    return { shared: doc.text() }
  }
  if (mine === base) {
    arrive(note, mine, theirs)
    return { shared: theirs }
  }

  const merged = mergedOf(base, mine, theirs)
  const judged = judge(
    'words',
    base,
    mine,
    theirs,
    { local: Date.now(), remote: doc.pendingAt },
    merged,
  )
  if (judged.resolution === null) {
    // Held like another program's edit: the note keeps what it says here, and the
    // question comes up over it.
    await engine.holdFile(id, base, mine)
    return { asked: mine }
  }
  const resolution = judged.resolution
  // Settled without asking, one side's words in the overlap stand and the other's are
  // kept as a version, as every other meeting of two sides keeps them (ingest.ts,
  // pass.ts). Left out here, what the document said lost was in no version at all.
  // Kept after the two are one, so nothing typed in the meantime falls between them.
  doc.write((live) => turn('words', live, theirs, resolution, MINE))
  arrive(note, mine, resolution)
  const shared = doc.text()
  await engine.keepLost(id, judged.lost, mine, theirs)
  return { shared }
}

/** How many times a note and its document are brought together before they are joined,
 *  for the keys typed while the last time was asked. */
const AGREEING = 8

/** Joins a note to its document. Answers how to part them again. `holds` is whether the
 *  note's view is still on this file (see rooms/bind.ts).
 *
 *  Not while the two are held apart: the note and the document then say different
 *  things, and a keystroke put into the document at the note's place landed inside
 *  another word of it (`wr!itten`), a deletion took out words nobody chose (#543). The
 *  note waits, typed into as a file, until the question is answered, and meets the
 *  document again then - against the words it said as it was asked, so what the answer
 *  kept and what was typed since both stay. */
export async function attach(
  engine: Engine,
  id: string,
  note: Held,
  holds: () => boolean,
  /** Told when the document under the note was made again, once it is joined anew. */
  again?: () => void,
): Promise<(() => void) | null> {
  const doc = await engine.hold(id)
  if (!doc?.live || !holds()) {
    if (doc) await engine.letGo(id)
    return null
  }

  let text: Y.Text = doc.live.getText(TEXT)
  let unbind: (() => void) | null = null
  let waiting: (() => void) | null = null
  let parted = false
  /** Whether the note has been parted from it, or moved on to another file. */
  const gone = () => parted || !holds()

  const join = () => {
    unbind = bind(note.live, text, holds)
  }
  // A key typed while they were being brought together is in the note and not in the
  // document, and every operation after it lands one place off (#543). A pull landed
  // meanwhile is the other way about. So they meet again, against what they last shared,
  // which tells the two apart: neither is taken for the other's deletion. Nothing is
  // awaited between the last look and the join.
  const together = async (given?: string): Promise<Met> => {
    let met = await agree(engine, id, note, doc, given)
    for (let round = 0; round < AGREEING; round++) {
      if (met.shared === undefined || gone() || note.latest === doc.text()) break
      met = await agree(engine, id, note, doc, met.shared)
    }
    return met
  }
  const wait = (asked: string) => {
    waiting = engine.whenLetGo(id, () => {
      waiting = null
      void (async () => {
        if (gone()) return
        const met = await together(asked)
        if (gone()) return
        if (met.asked === undefined) join()
        else wait(met.asked)
      })()
    })
  }

  const met = await together()
  if (met.asked === undefined) join()
  else wait(met.asked)

  // The account's words taken over this device's, or a new epoch: the same note, a new
  // document under it. A note still waiting on its question meets it when that is answered.
  doc.replaced = (fresh) => {
    text = fresh.getText(TEXT)
    if (!unbind) return
    unbind()
    const was = note.latest
    arrive(note, was, text.toJSON())
    join()
    again?.()
  }

  return () => {
    parted = true
    unbind?.()
    waiting?.()
    doc.replaced = null
    void engine.letGo(id)
  }
}

/** A plane joined to its document: how to part them, and where its pointer goes while a
 *  room carries the document. */
export interface PlaneJoin {
  part: () => void
  hand: ((at: Point | null, drawing: InkStroke | null) => void) | null
}

/** Joins a canvas or a page note to its document, as above. The surface pushes its
 *  edits into the document from here on, with the document's undo, room or no room. */
export async function attachPlane(
  engine: Engine,
  id: string,
  surface: PlaneSurface,
  holds: () => boolean,
  again?: () => void,
): Promise<PlaneJoin | null> {
  const doc = await engine.hold(id)
  if (!doc?.live || !holds()) {
    if (doc) await engine.letGo(id)
    return null
  }

  const join: PlaneJoin = { part: () => undefined, hand: null }
  const joined = (live: Y.Doc) => {
    const binding = new PlaneBinding(live, surface, holds, MINE)
    binding.together()
    surface.shared = {
      push: (before, after) => binding.push(before, after),
      undo: () => binding.undo(),
      redo: () => binding.redo(),
      hand: (at, drawing) => join.hand?.(at, drawing),
    }
    return binding
  }
  let binding = joined(doc.live)
  doc.replaced = (fresh) => {
    binding.part()
    binding = joined(fresh)
    again?.()
  }
  join.part = () => {
    binding.part()
    doc.replaced = null
    surface.shared = null
    surface.handsAre([])
    void engine.letGo(id)
  }
  return join
}
