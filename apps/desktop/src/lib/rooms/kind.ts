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

import { isCanvasTarget, isPagesTarget, isWebTarget } from '@nib/markdown/links'

/** The two shapes a room's document comes in, named as the service names them. */
export type RoomKind = 'words' | 'plane'

/** The shape the room for this file has, or null for a file that has no room at all.
 *
 *  A website is the one that has none. It is a shortcut file - an address and a title
 *  and nothing else - so there is no document in it for two people to be in at once,
 *  and what would be shared is a line nobody types. `holdsWords` says the same thing
 *  from the tab's end and is what actually keeps a room from being asked for; this
 *  says it from the file's, which is the end both machines can see, so a website
 *  cannot be talked into a room by a session, a layout or a tab that was opened as
 *  something else.
 *
 *  A file with no name at all - a draft nobody has saved - is words, which is what a
 *  tab with some text in it can always be read as; it has no room either way.
 *
 *  Two extensions are planes and not one. A page note is a canvas with pages on it:
 *  the same objects with the same ids in the same JSON Canvas file, so the shared
 *  document is the same map of objects by id and the settle writes the same bytes.
 *  A third kind here would be a third name for one shape, and the first thing it
 *  would buy is a way for the two ends of a file to disagree about which of two
 *  identical things it is. Which surface opens the file is a different question,
 *  asked of the same name somewhere else; see workspace/session.ts. */
export function roomKind(path: string | null | undefined): RoomKind | null {
  const name = path ?? ''
  if (isWebTarget(name)) return null
  return isCanvasTarget(name) || isPagesTarget(name) ? 'plane' : 'words'
}
