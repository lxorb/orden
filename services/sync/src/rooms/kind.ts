/** What a room's shared document holds, and how it becomes a file again.
 *
 *  A room is one Durable Object per file, and the two kinds of file that are
 *  written in together want different shapes. A note is prose, so its document is
 *  one `Y.Text` and two people typing in a paragraph get their letters
 *  interleaved. A canvas is not prose: everything on it has an id, and two people
 *  drawing want both drawings whole, so its document is a map of objects by id;
 *  see plane.ts in @nib/rooms.
 *
 *  Which shape a room has is the file's name and nothing else, so the door can say
 *  it in one header and a room woken from a sleep can read it back out of its own
 *  storage. Everything else about a room - the sockets, the snapshot, the log, the
 *  settle on an alarm - is the same either way, which is why there is one object
 *  class rather than two.
 *
 *  This file is that difference and nothing more: what fills an empty document,
 *  and what the settle writes. */

import { readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { isCanvasTarget } from '@nib/markdown/links'
import { TEXT } from '@nib/rooms'
import { readPlane, seedPlane } from '@nib/rooms/plane'
import type * as Y from 'yjs'

/** The two shapes a room's document comes in. */
export type RoomKind = 'words' | 'plane'

const KINDS: readonly RoomKind[] = ['words', 'plane']

/** Which shape the room for a file has. */
export function roomKind(path: string): RoomKind {
  return isCanvasTarget(path) ? 'plane' : 'words'
}

/** A kind that came off a header or out of storage, which is to say a kind that
 *  has not been checked yet. Anything unrecognised is words: that is what a room
 *  about a file this build has never heard of can always be read as. */
export function kindOf(value: unknown): RoomKind {
  return KINDS.find((kind) => kind === value) ?? 'words'
}

/** The room's first content, out of the file as the store holds it. */
export function fill(kind: RoomKind, doc: Y.Doc, stored: string) {
  if (kind === 'plane') {
    seedPlane(doc, readCanvas(stored))
    return
  }

  if (stored) doc.getText(TEXT).insert(0, stored)
}

/** The room's content as the file it settles into. Byte for byte the file the app
 *  would have written from the same content, so everything downstream of a
 *  settle - the file sync, publishing, the connector, exports, Obsidian - reads it
 *  as an ordinary edit made somewhere else. */
export function fileOf(kind: RoomKind, doc: Y.Doc): string {
  return kind === 'plane' ? writeCanvas(readPlane(doc)) : doc.getText(TEXT).toJSON()
}
