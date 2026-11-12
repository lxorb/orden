import { holdsCanvas, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { TEXT } from '@orden/rooms'
import { pushPlane, readPlane } from '@orden/rooms/plane'
import {
  diverge,
  divergePlane,
  seedPlane,
  seedUpdate,
  textops,
  type Times,
  type Verdict,
} from '@orden/sync-core'
import * as Y from 'yjs'
import { settleShortcuts } from '../web-tab/settle'

export type Shape = 'words' | 'plane' | 'link'

export function shapeOf(kind: string): Shape | null {
  switch (kind) {
    case 'note':
      return 'words'
    case 'canvas':
    case 'pages':
      return 'plane'
    case 'url':
    case 'term':
    case 'chat':
      return 'link'
    default:
      return null
  }
}

export function holdsDocument(kind: string): boolean {
  return shapeOf(kind) !== null
}

export function joinsAs(tab: string, kind: string): 'views' | 'surface' | null {
  const plane = shapeOf(kind) === 'plane'
  if (tab === 'note') return plane ? null : 'views'
  return plane ? 'surface' : null
}

export function unixLines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function fileOf(shape: Shape, doc: Y.Doc): string {
  return shape === 'plane' ? writeCanvas(readPlane(doc)) : doc.getText(TEXT).toJSON()
}

export function fileOfUpdates(shape: Shape, ...updates: readonly Uint8Array[]): string {
  const doc = new Y.Doc()
  for (const update of updates) Y.applyUpdateV2(doc, update)
  const text = fileOf(shape, doc)
  doc.destroy()
  return text
}

export function seedOf(shape: Shape, id: string, epoch: number, text: string): Uint8Array {
  return shape === 'plane' ? seedPlane(id, epoch, readCanvas(text)) : seedUpdate(id, epoch, text)
}

export function readable(shape: Shape, text: string): boolean {
  return shape !== 'plane' || holdsCanvas(text)
}

export function turn(shape: Shape, doc: Y.Doc, from: string, to: string, origin: unknown): void {
  if (from === to) return
  if (shape === 'plane') {
    doc.transact(() => {
      pushPlane(doc, readCanvas(from), readCanvas(to))
    }, origin)
    return
  }
  const text = doc.getText(TEXT)
  textops(text, wordsOf(text, from), unixLines(to), origin)
}

function wordsOf(text: Y.Text, from: string): string {
  const said = unixLines(from)
  if (text.length === said.length) return said
  if (text.length === from.length) return from
  return text.toJSON()
}

export function mergedOf(base: string, local: string, remote: string): string {
  const seed = new Y.Doc()
  seed.clientID = 1
  seed.getText(TEXT).insert(0, unixLines(base))
  const start = Y.encodeStateAsUpdateV2(seed)
  seed.destroy()

  const side = (client: number, to: string): Uint8Array => {
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, start)
    doc.clientID = client
    const text = doc.getText(TEXT)
    textops(text, text.toJSON(), unixLines(to))
    const update = Y.encodeStateAsUpdateV2(doc)
    doc.destroy()
    return update
  }
  return fileOfUpdates('words', side(2, local), side(3, remote))
}

const LINK = 'web note.url'

export interface Judged {
  verdict: Verdict
  resolution: string | null
  lost: { local: boolean; remote: boolean }
  merged?: string
}

export function judge(
  shape: Shape,
  base: string,
  local: string,
  remote: string,
  times: Times,
  merged?: string,
): Judged {
  if (shape === 'link') {
    const resolution =
      remote === base
        ? local
        : local === base
          ? remote
          : settleShortcuts(LINK, local, remote, times.remote > times.local)
    return {
      verdict: local === remote || remote === base || local === base ? 'clean' : 'minor',
      resolution,
      lost: { local: false, remote: false },
    }
  }

  if (shape === 'plane') {
    const planes = divergePlane(readCanvas(base), readCanvas(local), readCanvas(remote), times)
    return {
      verdict: planes.verdict,
      resolution: planes.resolution ? writeCanvas(planes.resolution) : null,
      lost: {
        local: planes.overlaps.some((one) => one.newer === 'remote'),
        remote: planes.overlaps.some((one) => one.newer === 'local'),
      },
    }
  }

  const both = merged ?? mergedOf(base, local, remote)
  const words = diverge(base, local, remote, times, both)
  const each = words.settled === 'both'
  return {
    merged: both,
    verdict: words.verdict,
    resolution: words.resolution,
    lost: {
      local: each || words.overlaps.some((one) => one.newer === 'remote'),
      remote: each || words.overlaps.some((one) => one.newer === 'local'),
    },
  }
}
