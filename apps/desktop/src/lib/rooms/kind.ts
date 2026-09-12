/** Which shape of room a file wants, asked of the file's name.
 *
 *  A note's room holds its words as one text; a canvas's holds the objects on the
 *  plane, one entry each. The two documents are not the same document and cannot be
 *  read as each other: a plane read as words is the empty string, and words read as
 *  a plane are an empty canvas. So the two ends of one file have to agree about
 *  which it is, and the only thing both of them can see is its name.
 *
 *  Which is why this rule is here rather than spelled out at each place that wants
 *  it. The service states the same one in services/sync/src/rooms/kind.ts, where the
 *  door works it out from the path on the row and tells the room in a header; this is
 *  that rule on this side, so a tab, a room and a Durable Object cannot come to
 *  three different conclusions about one file. Nothing else may decide it - not what
 *  a tab was opened as, and not what a session wrote down about it months ago. */

import { isCanvasTarget } from '@nib/markdown/links'

/** The two shapes a room's document comes in, named as the service names them. */
export type RoomKind = 'words' | 'plane'

/** The shape the room for this file has. A file with no name at all - a draft
 *  nobody has saved - is words, which is what a tab with some text in it can always
 *  be read as; it has no room either way. */
export function roomKind(path: string | null | undefined): RoomKind {
  return isCanvasTarget(path ?? '') ? 'plane' : 'words'
}
