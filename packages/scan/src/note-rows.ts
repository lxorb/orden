import type { Row } from '@orden/bases'
import { type NoteRead, rowsOf } from '@orden/bases/rows'
import { scanRows } from '@orden/bases/scan'
import { type ScannedNote, scanNote } from './scan-note'

export function readOf(note: ScannedNote): NoteRead {
  return {
    path: note.path,
    front: note.front ?? null,
    tasks: note.tasks ?? [],
    stamp: note.stamp ?? null,
    tags: note.tags,
    links: note.links,
  }
}

export function noteRowsOf(space: string, path: string, content: string): Row[] {
  const stamp = { size: content.length, mtime: 0, ctime: 0 }
  return rowsOf(space, readOf({ ...scanNote(path, content), ...scanRows(content), stamp }))
}
