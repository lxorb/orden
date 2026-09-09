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
import {
  BookText,
  File,
  FileText,
  Folder,
  FolderOpen,
  Image,
  type IconNode,
  Workflow,
} from 'lucide'
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

/** Everything a row in the tree can wear: what a file is, and what a folder is
 *  doing. A folder is not decided by its name, which is why it is a mark the tree
 *  asks for rather than one `fileMark` answers. */
export type Mark = FileMark | 'folder' | 'folder-open'

/** The drawing each mark is.
 *
 *  Lucide, so the tree wears an icon set somebody drew rather than five shapes
 *  this app drew for itself, and one set: every mark comes off the same 24 unit
 *  grid at the same weight, which is what makes a list of files read as a list
 *  rather than as a row of unrelated pictures. The same library the space icons
 *  come from; see icons.ts.
 *
 *  Two of them are the page they should be and two are the obvious thing: a page
 *  with writing on it, a plain page, a picture in its frame, a folder that opens.
 *  The other two are choices. A canvas is two cards with a line from one to the
 *  other, which is what a canvas in this app actually is. A PDF is a book rather
 *  than a fourth page: what tells it from a note at 13px has to be its outline
 *  and not something written inside it, and a PDF is the half of the pair that is
 *  read rather than written. */
export const MARKS: Record<Mark, IconNode> = {
  note: FileText,
  canvas: Workflow,
  pdf: BookText,
  picture: Image,
  file: File,
  folder: Folder,
  'folder-open': FolderOpen,
}
