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
