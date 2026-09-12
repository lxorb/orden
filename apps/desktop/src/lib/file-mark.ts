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
import { BookText, File, FileText, Globe, Image, type IconNode, Workflow } from 'lucide'
import { isMarkdownPath } from './space-paths'
import type { TabKind } from './workspace/documents.svelte'

/** The marks there are, and there is no folder among them, because no row is a
 *  folder: a note that holds notes is drawn as the note, and a folder out of
 *  somebody's vault that has no note of its own is drawn as `file` - a page with
 *  nothing written on it, which is exactly what such a row is until somebody
 *  writes in it. See folder-notes.ts and docs/tree.md.
 *
 *  `file` is also the mark for a name this build has no shape for, so a list can
 *  always draw a row.
 *
 *  `picture` and `file` are drawn ahead of anything that would show them: a file
 *  tree holds a note, a PDF and a canvas and nothing else, which is decided in
 *  `src-tauri/src/tree.rs` and, for the browser, in `web/commands.ts`. They are
 *  here so the first list that does show another kind has its mark already.
 *
 *  `web` is the one mark a name cannot earn. A website in the space is a note whose
 *  front matter says `url:`, so the file is called `Svelte docs.md` like any other
 *  and only the line inside it tells them apart; the index is asked for that, once,
 *  by the component that draws the mark. See web-tab/note.ts, which says why the
 *  file is a note rather than an extension of its own, and `FileMark.svelte`. */
export type FileMark = 'note' | 'canvas' | 'pdf' | 'picture' | 'file' | 'web'

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

/** The mark the document open in a tab wears, where a bar says which document is
 *  showing rather than listing several: the phone and tablet title bar.
 *
 *  Asked of the kind rather than of the name, because a tab knows outright what
 *  it holds while a list has only a name to read - and because an unnamed note is
 *  still a note. The graph wears none: it is a picture drawn from the space, not
 *  a file in it. */
export function markOf(kind: TabKind): FileMark | null {
  return kind === 'graph' ? null : kind
}

/** The drawing each mark is.
 *
 *  Lucide, so the tree wears an icon set somebody drew rather than five shapes
 *  this app drew for itself, and one set: every mark comes off the same 24 unit
 *  grid at the same weight, which is what makes a list of files read as a list
 *  rather than as a row of unrelated pictures. The same library the space icons
 *  come from; see icons.ts.
 *
 *  Three of them are the obvious thing: a page with writing on it, a plain page,
 *  a picture in its frame. The other two are choices. A canvas is two cards with
 *  a line from one to the other, which is what a canvas in this app actually is.
 *  A PDF is a book rather than a fourth page: what tells it from a note at 13px
 *  has to be its outline and not something written inside it, and a PDF is the
 *  half of the pair that is read rather than written.
 *
 *  The pair that matters most is the first two, because one row turns into the
 *  other: a folder somebody has not written yet is the plain page, and the words
 *  arriving in it make it the page with writing on. */
export const MARKS: Record<FileMark, IconNode> = {
  note: FileText,
  canvas: Workflow,
  pdf: BookText,
  picture: Image,
  file: File,
  // A globe, because that is what every browser has meant by the web for thirty
  // years, and because it reads at 16px as a shape rather than as a drawing.
  web: Globe,
}
