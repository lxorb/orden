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

import {
  isApplicationTarget,
  isBaseTarget,
  isCanvasTarget,
  isChatTarget,
  isTermTarget,
  isImageTarget,
  isPagesTarget,
  isPdfTarget,
  isWebTarget,
} from '@orden/markdown/links'
import type { IconNode } from 'lucide'
// One file per shape rather than seven names off the library's index, because the
// index re-exports every icon there is: a static import from it puts the whole set
// - four hundred kilobytes, and the picker's own lazy chunk with it - in front of
// the first paint. Every row of the file list wears one of these, so this module is
// in the first chunk by definition. See canvas/lucide.d.ts, which is where the
// types for these paths are declared, and icons.ts, which loads the index lazily.
import File from 'lucide/dist/esm/icons/file.mjs'
import FileText from 'lucide/dist/esm/icons/file-text.mjs'
import Folder from 'lucide/dist/esm/icons/folder.mjs'
import Globe from 'lucide/dist/esm/icons/globe.mjs'
import Image from 'lucide/dist/esm/icons/image.mjs'
import MessageSquare from 'lucide/dist/esm/icons/message-square.mjs'
import NotebookPen from 'lucide/dist/esm/icons/notebook-pen.mjs'
import Server from 'lucide/dist/esm/icons/server.mjs'
import SquareTerminal from 'lucide/dist/esm/icons/square-terminal.mjs'
import Table from 'lucide/dist/esm/icons/table-2.mjs'
import { isMarkdownPath } from './space-paths'
import { type TabKind, TAB_KINDS } from './workspace/tab-kinds'

/** The canvas: Lucide's `workflow`, on the grid the rest of the set is drawn on.
 *
 *  Every other mark here fills twenty of the twenty-four units - a page is 2 to 22
 *  down, so is the globe, so is the pad - and `workflow` fills eighteen, because
 *  Lucide builds it out of its own eight unit cards. At the size a row draws a mark
 *  that is a tenth of a pixel and nobody can see it. At the size the buttons in an
 *  empty pane draw one, which is twice that, it reads as the canvas being smaller
 *  than the three beside it and sitting oddly in its card - which is what Emil saw,
 *  2026-09-17: *"the icons in these buttons are not properly aligned"*. It shows
 *  worst of all on a pinned tab, which is its mark and nothing else.
 *
 *  So: the same drawing, scaled to the same extent. Two cards of nine with the two
 *  units of air between them the original leaves, the corner and the elbow a quarter
 *  of a card as Lucide drew them, the line still leaving the first card at its
 *  middle and arriving at the middle of the second. Nothing here is a shape this app
 *  invented - it is Lucide's, on the family's grid, so a strip of marks is one size
 *  wherever it is drawn.
 *
 *  Lucide's `image` is the other mark drawn to eighteen, and it is left alone: it is
 *  one full card, and a square that fills a box as far as a circle does reads bigger
 *  than the circle. Two small cards on a diagonal have no such weight to hold back. */
const Workflow: IconNode = [
  ['rect', { width: '9', height: '9', x: '2', y: '2', rx: '2.25' }],
  ['path', { d: 'M6.5 11v4.25a2.25 2.25 0 0 0 2.25 2.25H13' }],
  ['rect', { width: '9', height: '9', x: '13', y: '13', rx: '2.25' }],
]

/** An application: Lucide's `panel-top`, a window with its bar, on the grid the rest of
 *  the set is drawn on. Lucide draws it to eighteen units, from 3 to 21, which in the
 *  empty pane's buttons reads as the application's card sitting smaller and lower than
 *  the note's beside it - the canvas's trouble, above. So the same window, as tall as a
 *  page, 2 to 22: its corner as Lucide drew it and its bar a third of the way down. */
const Window: IconNode = [
  ['rect', { width: '18', height: '20', x: '3', y: '2', rx: '2' }],
  ['path', { d: 'M3 9h18' }],
]

/** The top of Lucide's page - its outline and its folded corner, as `file` draws them -
 *  cut off above the middle, which is where a file type's mark writes its name. */
const PAGE_TOP: IconNode = [
  [
    'path',
    {
      d: 'M4 11V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v3',
    },
  ],
  ['path', { d: 'M14 2v5a1 1 0 0 0 1 1h5' }],
]

/** A file type's own mark: the top of the page, and the type's name under it in
 *  capitals (#676).
 *
 *  Lettered because a reader asked for the word: a PDF drawn as a book was a shape
 *  somebody had to learn, and the three letters are what every other program has
 *  taught them to look for. The letters are strokes at the set's weight, on the row
 *  from 14 to 21 and from 3 to 21 across, three units apart, which is what keeps three
 *  of them apart at the 16px a row draws: each letter four units wide, the gap between
 *  two of them a pixel and a half of clear air once the stroke is drawn. Strokes rather
 *  than type, so the mark takes the colour and the weight of the list it is in, light
 *  or dark, like every other mark here.
 *
 *  A type added later writes its own letters on the same row and is one line here. */
function typeMark(letters: IconNode): IconNode {
  return [...PAGE_TOP, ...letters]
}

const Pdf: IconNode = typeMark([
  // P: a stem, and a bowl on its upper half.
  ['path', { d: 'M3 21v-7h2a2 2 0 0 1 0 4H3' }],
  // D: a stem, and a bowl the height of it.
  ['path', { d: 'M10 14v7h1a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3z' }],
  // F: a stem with its arm, and the bar.
  ['path', { d: 'M21 14h-4v7' }],
  ['path', { d: 'M17 17.5h3' }],
])

/** The marks there are. No row is a folder: a note that holds notes is drawn as the
 *  note, and a folder out of somebody's vault that has no note of its own is drawn as
 *  `file` - a page with nothing written on it, which is exactly what such a row is
 *  until somebody writes in it. See folder-notes.ts and docs/tree.md.
 *
 *  `folder` is what a note that says nothing yet wears where it holds notes, and
 *  `file` where it holds none (#1042): such a row is a place to put things or an empty
 *  page, not a page with writing on. Decided by `sourceMark` in chosen-icon.ts, never
 *  by a name, which is why `fileMark` below never answers it.
 *
 *  `file` is also the mark for a name this build has no shape for, so a list can
 *  always draw a row.
 *
 *  `picture` and `file` are drawn ahead of anything that would show them: a file
 *  tree holds a note, a PDF and a canvas and nothing else, which is decided in
 *  `src-tauri/src/tree.rs` and, for the browser, in `web/commands.ts`. They are
 *  here so the first list that does show another kind has its mark already.
 *
 *  `web` is a website: a shortcut file, `Svelte docs.url`, which is the Windows
 *  Internet Shortcut format that Explorer and every browser already write. It used
 *  to be the one mark a name could not earn - a website was a note with `url:` in
 *  its front matter, and the row had to ask the link index what the file said - and
 *  now it is a name like every other kind here. See web-tab/shortcut.ts. */
export type FileMark =
  | 'note'
  | 'folder'
  | 'canvas'
  | 'pages'
  | 'pdf'
  | 'picture'
  | 'file'
  | 'web'
  | 'terminal'
  | 'remote'
  | 'base'
  | 'chat'
  | 'application'

/** The mark a file's name earns it.
 *
 *  Asked in the order the kinds are told apart by: the three a tab can hold
 *  first, since those are the ones the app acts on differently, then a picture,
 *  then a note. A name with no extension is not a note; `Notes.md.bak` is not
 *  one either. Both are files, and the plain sheet says so.
 */
export function fileMark(name: string): FileMark {
  if (isWebTarget(name)) return 'web'
  if (isCanvasTarget(name)) return 'canvas'
  if (isPagesTarget(name)) return 'pages'
  if (isPdfTarget(name)) return 'pdf'
  if (isBaseTarget(name)) return 'base'
  if (isChatTarget(name)) return 'chat'
  // An online terminal's file wears the terminal its tab is (issue 1055).
  if (isTermTarget(name)) return 'terminal'
  if (isApplicationTarget(name)) return 'application'
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
  return TAB_KINDS[kind].mark
}

/** The drawing each mark is.
 *
 *  Lucide, so the tree wears an icon set somebody drew rather than five shapes
 *  this app drew for itself, and one set: every mark comes off the same 24 unit
 *  grid at the same weight, and fills the same twenty of it, which is what makes a
 *  list of files read as a list rather than as a row of unrelated pictures. The one
 *  mark that did not fill it is the canvas, and what it is instead is above. The
 *  same library the space icons come from; see icons.ts.
 *
 *  Three of them are the obvious thing: a page with writing on it, a plain page,
 *  a picture in its frame. The other two are choices. A canvas is two cards with
 *  a line from one to the other, which is what a canvas in this app actually is.
 *  A PDF is the one mark that says its name: the page with "PDF" written under it,
 *  drawn here on Lucide's page rather than taken from the library, which has none;
 *  see `typeMark`.
 *
 *  The pair that matters most is the first two, because one row turns into the
 *  other: a folder somebody has not written yet is the plain page, and the words
 *  arriving in it make it the page with writing on. */
export const MARKS: Record<FileMark, IconNode> = {
  note: FileText,
  // A note that says nothing and holds notes (#1042): Lucide's folder.
  folder: Folder,
  canvas: Workflow,
  // A pad with a pen on it, which is the one shape in the set that says "paper you
  // write on by hand" rather than "a file with words in it". The nib is what tells
  // it from a PDF's letters at 13px.
  pages: NotebookPen,
  pdf: Pdf,
  picture: Image,
  file: File,
  // A globe, because that is what every browser has meant by the web for thirty
  // years, and because it reads at 16px as a shape rather than as a drawing.
  web: Globe,
  // A prompt in a window, one full card like the picture: no file wears it, only a tab.
  terminal: SquareTerminal,
  // Another machine: the server a remote terminal's tab wears.
  remote: Server,
  // A grid of rows and columns: a base, and a view of rows in a tab, Obsidian's mark
  // for a base and the shape a table, a board and a calendar all share.
  base: Table,
  // A speech bubble: a chat (docs/chats.md).
  chat: MessageSquare,
  // A window with its bar: an application running on one of the reader's devices
  // (docs/apps.md), on the set's grid; see `Window`.
  application: Window,
}

/** What an essential's tile wears: its file's mark, or for a note that chose no icon
 *  its first letter, since a grid of identical pages cannot be read without hovering
 *  every tile. See BookmarkTile.svelte. */
export function faceOf(mark: FileMark, chosen: boolean): 'mark' | 'letter' {
  return mark === 'note' && !chosen ? 'letter' : 'mark'
}

const GRAPHEMES = new Intl.Segmenter()

/** The first letter or digit of a name, one grapheme, in capitals; the first
 *  character of a name with none. */
export function initialOf(name: string): string {
  let first: string | null = null

  for (const { segment } of GRAPHEMES.segment(name.trim())) {
    first ??= segment
    if (/[\p{L}\p{N}]/u.test(segment)) return segment.toLocaleUpperCase()
  }

  return first ?? ''
}
