import type { Row } from '@orden/bases'
import { type NoteRead, rowsOf } from '@orden/bases/rows'
import { scanRows, type Stamp } from '@orden/bases/scan'
import { type ScannedNote, scanNote } from './scan-note'

export const readOf = (note: ScannedNote): NoteRead => ({
  path: note.path,
  front: note.front ?? null,
  tasks: note.tasks ?? [],
  stamp: note.stamp ?? null,
  tags: note.tags,
  links: note.links,
})

export interface NoteHeld {
  stamp?: Stamp
  meta?: Readonly<Record<string, string>> | null | undefined
}

export function noteRowsOf(space: string, path: string, content: string, held: NoteHeld = {}): Row[] {
  const stamp = held.stamp ?? { size: content.length, mtime: 0, ctime: 0 }
  const read = readOf({ ...scanNote(path, content), ...scanRows(content), stamp })
  return rowsOf(space, { ...read, meta: held.meta ?? null })
}
