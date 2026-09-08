/** Which mark a file wears in the lists that show it.
 *
 *  A row says what it opens into with a shape rather than with a word, and the
 *  shape has to be the same shape everywhere: the file tree draws one, and the
 *  search results, the bookmarks and the tab strip are all a list of files
 *  waiting for the same mark. One reading of a name, so two lists cannot
 *  disagree about what a file is.
 *
 *  The name alone decides, which is why this is a pure function and not a method
 *  on an entry: a hit in a search and a tab in a strip both know a name and
 *  little else. `FileMark.svelte` draws what it answers. */

import { isCanvasTarget, isImageTarget, isPdfTarget } from '@nib/markdown/links'
import { isMarkdownPath } from './space-paths'

/** The marks there are. `file` is the one for a name this build has no shape
 *  for, so a list can always draw a row.
 *
 *  `picture` and `file` are drawn ahead of anything that would show them: a file
 *  tree holds a note, a PDF and a canvas and nothing else, which is decided in
 *  `src-tauri/src/tree.rs` and, for the browser, in `web/commands.ts`. They are
 *  here so the first list that does show another kind has its mark already. */
export type FileMark = 'note' | 'canvas' | 'pdf' | 'picture' | 'file'

/** The mark a file's name earns it.
 *
 *  Asked in the order the kinds are told apart by: the three a tab can hold
 *  first, since those are the ones the app acts on differently, then a picture,
 *  then a note. A name with no extension is not a note; `Notes.md.bak` is not
 *  one either. Both are files, and the plain sheet says so.
 */
export function fileMark(name: string): FileMark {
  if (isCanvasTarget(name)) return 'canvas'
  if (isPdfTarget(name)) return 'pdf'
  if (isImageTarget(name)) return 'picture'
  if (isMarkdownPath(name)) return 'note'
  return 'file'
}
