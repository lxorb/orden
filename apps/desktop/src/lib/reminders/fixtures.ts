/** Rows out of words, for the reminders' tests: a note read the way the rows read one. */

import type { Row } from '@orden/bases'
import { rowsOf } from '@orden/bases/rows'
import { scanNote } from '../scan-note'
import { scanRows } from '@orden/bases/scan'

export function rowsIn(space: string, path: string, content: string): Row[] {
  const note = scanNote(path, content)
  const { front, tasks } = scanRows(content)
  return rowsOf(space, {
    path,
    front,
    tasks,
    stamp: { size: content.length, mtime: 1, ctime: 1 },
    tags: note.tags,
    links: note.links,
  })
}
