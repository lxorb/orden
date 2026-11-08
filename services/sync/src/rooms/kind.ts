import { holdsCanvas, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { isCanvasTarget, isPagesTarget } from '@orden/markdown/links'
import { TEXT } from '@orden/rooms'
import { fold } from '@orden/rooms/fold'
import { planeIsEmpty, pushPlane, readPlane, seedExtras, seedPlane } from '@orden/rooms/plane'
import type * as Y from 'yjs'

export type RoomKind = 'words' | 'plane'

export type Lines = 'crlf' | 'lf'

const KINDS: readonly RoomKind[] = ['words', 'plane']

function roomKind(path: string): RoomKind {
  return isCanvasTarget(path) || isPagesTarget(path) ? 'plane' : 'words'
}

export function noteKind(note: {
  path: string
  kind?: string | null | undefined
  epoch?: number | null | undefined
}): RoomKind {
  if ((note.epoch ?? 0) < 1 || !note.kind) return roomKind(note.path)
  return note.kind === 'canvas' || note.kind === 'pages' ? 'plane' : 'words'
}

export function readsAs(kind: RoomKind, text: string): boolean {
  return kind !== 'plane' || holdsCanvas(text)
}

export function isChatPointer(path: string): boolean {
  return /.chat$/i.test(path)
}

export function kindOf(value: unknown): RoomKind {
  return KINDS.find((kind) => kind === value) ?? 'words'
}

export function writesOf(value: unknown): boolean {
  return value === 'yes'
}

export function fill(kind: RoomKind, doc: Y.Doc, stored: string) {
  if (kind === 'plane') {
    const canvas = readCanvas(stored)
    seedPlane(doc, canvas)
    seedExtras(doc, canvas)
    return
  }

  if (stored) doc.getText(TEXT).insert(0, unixLines(stored))
}

export function unixLines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

export function linesOf(text: string): Lines {
  return text.includes('\r\n') && asWritten('crlf', unixLines(text)) === text ? 'crlf' : 'lf'
}

export function asWritten(lines: Lines | undefined, words: string): string {
  return lines === 'crlf' ? words.replace(/\n/g, '\r\n') : words
}

export function unixWords(doc: Y.Doc, origin: unknown): void {
  const text = doc.getText(TEXT)
  const words = text.toJSON()
  if (!words.includes('\r')) return

  const delta: { retain?: number; delete?: number; insert?: string }[] = []
  let from = 0
  for (let at = words.indexOf('\r'); at >= 0; at = words.indexOf('\r', at + 1)) {
    if (at > from) delta.push({ retain: at - from })
    delta.push({ delete: 1 })
    if (words[at + 1] !== '\n') delta.push({ insert: '\n' })
    from = at + 1
  }

  doc.transact(() => text.applyDelta(delta), origin)
}

export function takeInto(kind: RoomKind, doc: Y.Doc, held: string, file: string) {
  if (kind === 'plane') {
    pushPlane(doc, readCanvas(held), readCanvas(file))
    return
  }

  const change = fold(held, file)
  if (!change) return

  const text = doc.getText(TEXT)
  doc.transact(() => {
    text.delete(change.from, change.to - change.from)
    text.insert(change.from, change.insert)
  })
}

export function leavesAPlane(kind: RoomKind, doc: Y.Doc): boolean {
  return kind === 'words' && !planeIsEmpty(doc)
}

export function neverHeld(doc: Y.Doc): boolean {
  return doc.store.clients.size === 0
}

export function fileOf(kind: RoomKind, doc: Y.Doc): string {
  return kind === 'plane' ? writeCanvas(readPlane(doc)) : doc.getText(TEXT).toJSON()
}
