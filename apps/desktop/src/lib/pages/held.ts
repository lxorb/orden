/** The paper a page note holds.
 *
 *  A PDF brought into a space becomes one thing, a page note, and its bytes move into
 *  the note's keeping: `Lecture 4.pdf` becomes `Lecture 4.pages`, and the paper under
 *  its pages is `Lecture 4.pages.pdf` beside it - the note's own name with `.pdf`
 *  after it, the way a PDF's highlights are its own name with their suffix after it.
 *  The file list shows the note and not the paper; a rename, a move, a copy and a
 *  delete take the paper with the note (`move_held` in src-tauri/src/paths.rs, and
 *  `renameNote` in web/commands.ts); and sync carries it as the file it is. See
 *  docs/pages.md.
 *
 *  Pure, so the browser build, the paper reader and the export ask the same thing. */

import { isPagesTarget } from '@nib/markdown/links'
import { placesOf, samePath } from '../space-paths'

/** The paper the page note at `pages` holds, whether or not there is one. */
export function paperOf(pages: string): string {
  return `${pages}.pdf`
}

/** The page note a paper belongs to by its name - `Lecture.pages` for
 *  `Lecture.pages.pdf` - or null for any other path. Whether the note is there is the
 *  caller's question: a paper whose note has gone is a PDF again. */
export function holderOf(path: string): string | null {
  return /\.pages\.pdf$/i.test(path) ? path.slice(0, -'.pdf'.length) : null
}

/** Where the paper a page names may be, in the order to try them.
 *
 *  The note's own paper first. A page note made from a PDF names that paper on
 *  every page by its name at the time, and the note can be renamed since - the paper
 *  is renamed with it, the pages are not rewritten - so the note's own paper is the
 *  one answer that is never stale. Then where the page's name points, as a JSON
 *  Canvas file node is read: from the note's folder, then from the space; see
 *  `placesOf`. That is a page note somebody wrote by hand, and one an older build
 *  made beside its PDF.
 *
 *  Nothing for a page that names no paper: a blank sheet has nothing behind it, and
 *  the note's own paper is not every sheet's. */
export function paperPlaces(file: string, note: string | null, root: string | null): string[] {
  const named = placesOf(file, note, root)
  if (!named.length || !note || !isPagesTarget(note)) return named

  const own = paperOf(note)
  return [own, ...named.filter((one) => !samePath(one, own))]
}
