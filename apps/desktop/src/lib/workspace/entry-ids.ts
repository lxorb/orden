/** Sync's ids for what a space holds, by path relative to the space and back (#1068):
 *  what a bookmark is found by when its path names nothing. Sync says how to ask once it
 *  is loaded; until then, and signed out, there are none and a bookmark is its path. A
 *  module of its own so that neither side imports the other. */

export interface EntryIds {
  idOf(root: string, path: string): string | null
  pathOf(root: string, id: string): string | null
}

let said: EntryIds | null = null

export function sayEntryIds(ids: EntryIds | null) {
  said = ids
}

export function entryIds(): EntryIds | null {
  return said
}
