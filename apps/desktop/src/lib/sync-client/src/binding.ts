import type { SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { fold } from '@orden/rooms/fold'
import type * as Y from 'yjs'
import type { InkStroke } from '../../canvas/format'
import type { Point } from '../../canvas/geometry'
import type { PlaneSurface } from '../../canvas/shared'
import { bind } from '../../rooms/bind'
import { PlaneBinding } from '../../rooms/plane-bind'
import { MINE, type Doc } from './docs'
import type { Engine } from './engine'
import { writtenOf } from './ingest'
import { judge, mergedOf, turn } from './kinds'

interface Meeting {
  readonly live: Pick<SharedDoc, 'arrived'>
  readonly latest: string
}

export interface Held extends Meeting {
  readonly live: SharedDoc
  onDisk?: string | null
}

function arrive(note: Meeting, from: string, to: string) {
  const change = fold(from, to)
  if (change) note.live.arrived([change])
}

type Met = { shared: string; asked?: never } | { asked: string; shared?: never }

async function agree(
  engine: Engine,
  id: string,
  note: Meeting,
  doc: Doc,
  given?: string,
): Promise<Met> {
  if (note.latest === doc.text()) return { shared: doc.text() }

  const written = given ?? (await writtenOf(engine.core, id))
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
    await engine.holdFile(id, base, mine)
    return { asked: mine }
  }
  const resolution = judged.resolution
  doc.write((live) => turn('words', live, theirs, resolution, MINE))
  arrive(note, mine, resolution)
  const shared = doc.text()
  await engine.keepLost(id, judged.lost, mine, theirs)
  return { shared }
}

const AGREEING = 8

export type Attached = (() => void) & { bound: () => boolean }

const ELSEWHERE = { arrived: () => undefined }

export async function meetWords(engine: Engine, id: string, doc: Doc, mine: string) {
  return (await agree(engine, id, { live: ELSEWHERE, latest: mine }, doc)).asked === undefined
}

export async function attach(
  engine: Engine,
  id: string,
  note: Held,
  holds: () => boolean,
  again?: () => void,
  joined?: () => void,
): Promise<Attached | null> {
  const doc = await engine.hold(id)
  if (!doc?.live || !holds()) {
    if (doc) await engine.letGo(id)
    return null
  }

  let text: Y.Text = doc.live.getText(TEXT)
  let unbind: (() => void) | null = null
  let waiting: (() => void) | null = null
  let parted = false
  const gone = () => parted || !holds()

  const join = () => {
    unbind = bind(note.live, text, holds)
  }
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
        if (met.asked === undefined) {
          join()
          joined?.()
        } else wait(met.asked)
      })()
    })
  }

  const met = await together()
  if (met.asked === undefined) join()
  else wait(met.asked)

  const unheard = engine.on('file', (event) => {
    if (event.id === id && unbind && !gone() && note.latest === event.text) {
      note.onDisk = event.text
    }
  })

  doc.replaced = (fresh) => {
    text = fresh.getText(TEXT)
    if (!unbind) return
    unbind()
    const was = note.latest
    arrive(note, was, text.toJSON())
    join()
    again?.()
  }

  const part = () => {
    parted = true
    unheard()
    unbind?.()
    waiting?.()
    doc.replaced = null
    void engine.letGo(id)
  }
  return Object.assign(part, { bound: () => unbind !== null && !gone() })
}

export interface PlaneJoin {
  part: () => void
  hand: ((at: Point | null, drawing: InkStroke | null) => void) | null
}

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
