/** Every kind of tab, and what each one is, in one place.
 *
 *  A tab holds a note almost always, and nine other things besides; see `TabKind` in
 *  documents.svelte.ts for what each of them is. What used to be spread over the app
 *  was what each of them does: whether its words are a file's, what a draft of it is
 *  saved as, which mark it wears, whether the pane draws the editor for it, what it
 *  goes out as. Every one of those was a chain of `kind === ...` somewhere, and a new
 *  kind was a hunt through all of them for the ones that needed to hear about it.
 *
 *  So each kind is one entry here, saying all of it, and the places that used to ask
 *  the kind ask its entry. A new kind is a new entry: the type below makes every trait
 *  a required answer, so one that forgets something does not compile.
 *
 *  What is left outside are the questions about one kind by name - is this a web
 *  tab, so its page can be stepped back - which are that kind's own business and no
 *  other's, and the pane's own drawing of each surface (Pane.svelte), where every
 *  kind's component takes different props. */

import type { FileMark } from '../file-mark'

/** What a kind of tab is, trait by trait. */
export interface TabKindTraits {
  /** Whether its words are a file's words: a note, a canvas and a page note, whose
   *  words are the JSON in them. What decides every place words cross between a tab
   *  and a file; see `holdsWords` in documents.svelte.ts. */
  readonly words: boolean
  /** The ending a tab of this kind with no file is saved under, or null for a kind
   *  that is never saved as a file of its own; see drafts.ts. */
  readonly extension: string | null
  /** Whether the bar under the note is drawn over it; see `hasStatusBar` in
   *  regions.ts. A page note keeps it: its bar carries the page counter. */
  readonly statusBar: boolean
  /** The mark it wears where a bar says which document is showing, or null for a tab
   *  that is not a file; see `markOf` in file-mark.ts. */
  readonly mark: FileMark | null
  /** What a tab with no file mark wears in the strip instead: the space's picture or
   *  the AI panel's. Asked only where `mark` is null; see TabMark.svelte. */
  readonly glyph: 'graph' | 'ask' | null
  /** Whether its mark is drawn live, by what is running in it rather than by what it
   *  is: a terminal wears the program in front. See TabMark.svelte. */
  readonly liveMark: boolean
  /** Whether the pane draws the editor for it - the surface with no find bar of its
   *  own - when it is not being read. See `writing` in Pane.svelte. */
  readonly editor: boolean
  /** Whether what is showing takes a dropped note itself rather than the pane opening
   *  it; a terminal types its path. See `ownSurface` in Pane.svelte. */
  readonly takesDrops: boolean
  /** Whether it draws a bar of its own across the top of the pane, which the window's
   *  own controls make room for; see `ownBar` in App.svelte. */
  readonly ownBar: boolean
  /** Whether the document open over its file is that file's words. A view over a
   *  `.base` holds which view it is, and a chat's tab over its `.chat` pointer shows the
   *  account's messages: neither holds the file's words. See `documentAt` in
   *  workspace.svelte.ts. */
  readonly fileDocument: boolean
  /** Whether it is one of the two planes - a canvas and a page note, one format and two
   *  surfaces - which a rename may turn into the other; see `rekind` in open.ts. */
  readonly plane: boolean
  /** What it goes out as; see `exportKindOf` in export/offer.ts, which tells a deck
   *  from a note and a paper with no path from one with one. */
  readonly exports: 'note' | 'canvas' | 'pages' | 'file' | 'none'
  /** What an agent is told is selected inside it, in that kind's own terms, or null for
   *  a kind with nothing to select that nib can see; see `selectionIn` in
   *  agents/workspace/tabs.ts. */
  readonly selection: 'words' | 'drawing' | 'terminal' | 'page' | null
  /** Whether its title is somebody else's words - a page's, or the program a terminal is
   *  running - which an agent is told; see `namedOutside` in agents/workspace/tabs.ts. */
  readonly outsideTitle: boolean
}

/** The kinds, in the order a written session has always listed them. */
export const TAB_KINDS = {
  note: {
    words: true,
    extension: '.md',
    statusBar: true,
    mark: 'note',
    glyph: null,
    liveMark: false,
    editor: true,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'note',
    selection: 'words',
    outsideTitle: false,
  },
  graph: {
    words: false,
    extension: null,
    statusBar: false,
    mark: null,
    glyph: 'graph',
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
  },
  pdf: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'pdf',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'file',
    selection: 'page',
    outsideTitle: false,
  },
  canvas: {
    words: true,
    extension: '.canvas',
    statusBar: false,
    mark: 'canvas',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: true,
    ownBar: true,
    fileDocument: true,
    plane: true,
    exports: 'canvas',
    selection: 'drawing',
    outsideTitle: false,
  },
  pages: {
    words: true,
    extension: '.pages',
    statusBar: true,
    mark: 'pages',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: true,
    fileDocument: true,
    plane: true,
    exports: 'pages',
    selection: 'drawing',
    outsideTitle: false,
  },
  web: {
    words: false,
    extension: '.url',
    statusBar: true,
    mark: 'web',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: true,
  },
  terminal: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'terminal',
    glyph: null,
    liveMark: true,
    editor: false,
    takesDrops: true,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: 'terminal',
    outsideTitle: true,
  },
  view: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'base',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: false,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
  },
  chat: {
    words: false,
    extension: null,
    statusBar: true,
    mark: null,
    glyph: 'ask',
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
  },
  // A channel's pane draws its own surface before the editor is ever asked for, so
  // `editor` only reaches what the pane draws around it. It says what the chain of
  // kinds in Pane.svelte said before this table, which left the channel out.
  channel: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'chat',
    glyph: null,
    liveMark: false,
    editor: true,
    takesDrops: false,
    ownBar: false,
    fileDocument: false,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
  },
} as const satisfies Record<string, TabKindTraits>

/** What a tab holds; see documents.svelte.ts for what each kind is. */
export type TabKind = keyof typeof TAB_KINDS

/** Every kind, in the table's order. */
export const KINDS = Object.keys(TAB_KINDS) as readonly TabKind[]

/** Whether a string names a kind of tab. */
export function isTabKind(value: unknown): value is TabKind {
  return typeof value === 'string' && Object.hasOwn(TAB_KINDS, value)
}

/** One kind's entry. */
export function traitsOf(kind: TabKind): TabKindTraits {
  return TAB_KINDS[kind]
}

/** The kinds a trait holds for, in the table's order. */
export function kindsWhere(trait: (traits: TabKindTraits) => boolean): TabKind[] {
  return KINDS.filter((kind) => trait(TAB_KINDS[kind]))
}
