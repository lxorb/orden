import { readCanvas } from '@orden/markdown/canvas'
import { TEXT } from '@orden/rooms'
import { pushPlane } from '@orden/rooms/plane'
import { hash32, seedPlane, seedUpdate, textops } from '@orden/sync-core'
import * as Y from 'yjs'
import { readsAs, type RoomKind } from './kind'

export function snapshotKey(noteId: string): string {
  return `crdt/${noteId}`
}

export function seedOf(kind: RoomKind, noteId: string, epoch: number, text: string): Uint8Array {
  return kind === 'plane'
    ? seedPlane(noteId, epoch, readCanvas(text))
    : seedUpdate(noteId, epoch, text)
}

function accountClient(noteId: string): number {
  return hash32(noteId, 'account')
}

export function ingested(
  kind: RoomKind,
  doc: Y.Doc,
  noteId: string,
  from: string,
  to: string,
): Uint8Array | null {
  if (from === to || !readsAs(kind, to)) return null

  const scratch = new Y.Doc()
  Y.applyUpdateV2(scratch, Y.encodeStateAsUpdateV2(doc))
  scratch.clientID = accountClient(noteId)
  const before = Y.encodeStateVector(scratch)

  if (kind === 'plane') {
    scratch.transact(() => {
      pushPlane(scratch, readCanvas(from), readCanvas(to))
    })
  } else {
    textops(scratch.getText(TEXT), from, to)
  }

  const update = Y.encodeStateAsUpdateV2(scratch, before)
  scratch.destroy()
  return update
}

export function seedsAnything(update: Uint8Array): boolean {
  const doc = new Y.Doc()
  Y.applyUpdateV2(doc, update)
  const held = doc.store.clients.size > 0
  doc.destroy()
  return held
}
