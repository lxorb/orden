/** One file's words, read into what the index of a space holds of it (#1126): what
 *  the browser's `scan_links` makes of each row - a note's scan with what its rows
 *  ride on, a plane's marks, a website's mark - for a file nobody has to keep the
 *  words of to have it. The account makes it from its own copy for a browser that
 *  keeps no words of the note, and the browser from the words in hand when it lets a
 *  note's words go. Null for a file that is a name beside the notes. */

import { scanRows, type Stamp } from '@orden/bases/scan'
import { isCanvasTarget, isWebTarget } from '@orden/markdown/links'
import { scanCanvas } from './scan-canvas'
import { scanNote, scanShortcut } from './scan-note'
import type { IndexedNote } from './wire'

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** `path` relative to its space, `/`-separated, as a link speaks of it. */
export function indexed(path: string, content: string, stamp: Stamp): IndexedNote | null {
  if (MARKDOWN.test(path)) return { ...scanNote(path, content), ...scanRows(content), stamp }
  if (isCanvasTarget(path)) return scanCanvas(path, content)
  if (isWebTarget(path)) return scanShortcut(path, content)
  return null
}
