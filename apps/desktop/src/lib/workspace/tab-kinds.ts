/** Every kind of tab and what it does, one entry each: the places that used to ask
 *  `kind === ...` ask the entry, and a new kind is a new entry that must answer every
 *  trait. Questions about one kind by name stay with that kind's own code. */

import type { FileMark } from '../file-mark'

export interface TabKindTraits {
  /** Its words are a file's words (`holdsWords`). */
  readonly words: boolean
  /** The ending a draft of it is saved under, if any (drafts.ts). */
  readonly extension: string | null
  /** The bar under the note is drawn over it (`hasStatusBar`). */
  readonly statusBar: boolean
  /** The file mark it wears, null for no file (`markOf`). */
  readonly mark: FileMark | null
  /** The glyph worn where `mark` is null (TabMark.svelte). */
  readonly glyph: 'graph' | 'ask' | null
  /** Its mark is drawn by what runs in it (TabMark.svelte). */
  readonly liveMark: boolean
  /** The pane draws the editor for it (`writing` in Pane.svelte). */
  readonly editor: boolean
  /** It takes a dropped note itself (`ownSurface` in Pane.svelte). */
  readonly takesDrops: boolean
  /** It has its own bar with a way to add (`ownBar` in App.svelte). */
  readonly ownBar: boolean
  /** The document over its file is the file's words (`documentAt`). */
  readonly fileDocument: boolean
  /** One of the two planes, canvas and page note (`rekind` in open.ts). */
  readonly plane: boolean
  /** What it goes out as (`exportKindOf`). */
  readonly exports: 'note' | 'canvas' | 'pages' | 'file' | 'none'
  /** What an agent is told is selected in it (`selectionIn`). */
  readonly selection: 'words' | 'drawing' | 'terminal' | 'page' | null
  /** Its title is somebody else's words (`namedOutside`). */
  readonly outsideTitle: boolean
  /** How the tab overview draws its window while it is not in front (#331; see
   *  overview/WindowFace.svelte): `reading`, its words as they are now through the
   *  reading renderer, from the line it was left at, sharp at any zoom; `scrollback`, the
   *  last of its screen as written down (terminal/history.ts); `photograph`, the
   *  engine's picture of a page nothing else can draw again; `picture`, what it last
   *  drew, kept (overview/faces.ts), until it has a way of its own to be drawn from
   *  what it holds. */
  readonly preview: 'reading' | 'scrollback' | 'photograph' | 'picture'
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
    preview: 'reading',
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
    preview: 'picture',
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
    preview: 'picture',
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
    preview: 'picture',
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
    preview: 'picture',
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
    preview: 'photograph',
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
    preview: 'scrollback',
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
    preview: 'picture',
  },
  chat: {
    words: false,
    extension: null,
    statusBar: true,
    mark: null,
    glyph: 'ask',
    liveMark: false,
    editor: false,
    takesDrops: true,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
    preview: 'picture',
  },
  channel: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'chat',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: true,
    ownBar: false,
    fileDocument: false,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
    preview: 'picture',
  },
  /** An application running on one of the reader's devices, by its `.application` file
   *  (docs/apps.md). */
  application: {
    words: false,
    extension: null,
    statusBar: true,
    mark: 'application',
    glyph: null,
    liveMark: false,
    editor: false,
    takesDrops: false,
    ownBar: false,
    fileDocument: true,
    plane: false,
    exports: 'none',
    selection: null,
    outsideTitle: false,
    // What it last drew, kept: the application's state and who holds it. The picture
    // the host streams (step 4) is a video frame nothing here can draw again.
    preview: 'picture',
  },
} as const satisfies Record<string, TabKindTraits>

/** What a tab holds; see documents.svelte.ts for what each kind is. */
export type TabKind = keyof typeof TAB_KINDS

/** Every kind, in the table's order. */
const KINDS = Object.keys(TAB_KINDS) as readonly TabKind[]

/** Whether a string names a kind of tab. */
export function isTabKind(value: unknown): value is TabKind {
  return typeof value === 'string' && Object.hasOwn(TAB_KINDS, value)
}

/** The kinds a trait holds for, in the table's order. */
export function kindsWhere(trait: (traits: TabKindTraits) => boolean): TabKind[] {
  return KINDS.filter((kind) => trait(TAB_KINDS[kind]))
}
