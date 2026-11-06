/** The one place a PDF's highlights are read from and written to.
 *
 *  The commands take the PDF's own path and never the sidecar's: where the marks
 *  are kept is settled in `highlights.rs`, so nothing here can point a write at a
 *  file of its own choosing. */

import { log } from '../log'
import { invoke } from '../tauri'
import { frozen, leftAlone, readSheet, type Sheet, writeSheet } from './highlights'

/** What has been marked on a PDF. A PDF nobody has marked, and one whose sidecar
 *  cannot be read, both come back as no marks: a viewer that will not open
 *  because of a file beside the PDF would be worse than one with no highlights.
 *
 *  The crate answers an empty sidecar for a PDF with none, so a read that fails is
 *  a sidecar that is there - too large, or held by another program. Its marks are
 *  not shown and not written over; see `leftAlone`. */
export async function loadHighlights(path: string): Promise<Sheet> {
  const text = await invoke<string>('read_highlights', { path }).catch((error: unknown) => {
    log('warn', `highlights: ${path} - ${String(error)}`)
    return null
  })
  return text === null ? leftAlone() : readSheet(text)
}

/** The change on its way to each PDF's marks. */
const turns = new Map<string, Promise<unknown>>()

/** Changes the marks as they are on the disk when the change runs, one change to a PDF
 *  at a time: the viewer and an agent's calls, several at once, each add to what the
 *  others wrote rather than over it. Answers the sheet written, or null where it was
 *  not: a sheet from a later version of Orden holds fields this one knows nothing
 *  about, and writing back what was understood would throw the rest away. */
export function editHighlights(
  path: string,
  change: (sheet: Sheet) => Sheet,
): Promise<Sheet | null> {
  const turn = (turns.get(path) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const sheet = await loadHighlights(path)
      if (frozen(sheet)) return null
      const next = change(sheet)
      await invoke('write_highlights', { path, content: writeSheet(next) })
      return next
    })
  turns.set(path, turn)
  void turn
    .catch(() => undefined)
    .finally(() => {
      if (turns.get(path) === turn) turns.delete(path)
    })
  return turn
}
