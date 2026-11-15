import type { Entry } from '@orden/contracts'
import type { NoteDoc, Tab } from '../documents/src/api'
import type { FileAction } from '../file-undo/src/api'
import type { workspace } from '../workspace.svelte'

type Workspace = typeof workspace

type Outside = Extract<FileAction, { kind: 'outside' }>

type Archiving = Extract<FileAction, { kind: 'archive' | 'unarchive' }>

interface RowsCopied {
  readonly numbersAt: (path: string) => boolean
  readonly withoutIds: (path: string, text: string) => string | null
}

interface PaperFollowing {
  readonly paperMoved: (from: string, to: string) => void
  readonly paperGone: (path: string) => void
}

interface PaperSheets {
  readonly paperRewritten: (path: string) => void
  readonly sheetArrived: (path: string) => void
}

interface PdfPages {
  readonly heldBy: (path: string, root: string | null) => Promise<string | null>
  readonly asItself: (path: string) => Promise<string>
  readonly asPageNote: (
    path: string,
    root: string | null,
    move: (from: string, to: string) => Promise<void>,
  ) => Promise<string>
  readonly adoptBeside: (
    path: string,
    root: string | null,
    move: (from: string, to: string) => Promise<void>,
  ) => Promise<boolean>
  readonly draftPdf: (ws: Workspace, from: string) => Promise<Tab | null>
  readonly keepPaper: (ws: Workspace, note: NoteDoc, path: string) => Promise<void>
}

interface WebSites {
  readonly heldElsewhere: (path: string) => Promise<boolean>
  readonly showElsewhere: (path: string) => Promise<void>
  readonly asShortcut: (ws: Workspace, path: string) => Promise<string | null>
  readonly convertWebsites: (ws: Workspace) => Promise<number>
  readonly webUrlOf: (text: string | null) => Promise<string | null>
  readonly newSite: (ws: Workspace, dir: string, named?: string) => Promise<string>
  readonly aimed: (ws: Workspace, tab: Tab, url: string) => Promise<void>
  readonly zoomStep: (tab: string, step: 'in' | 'out' | 'reset') => Promise<void>
}

interface WebData {
  readonly ownStore: (own: string | null | undefined) => string | null
  readonly freshOwn: () => string
  readonly copyingOut: <T>(own: string, copy: () => Promise<T>) => Promise<T>
}

interface Scratchpad {
  readonly on: boolean
  readonly holds: (path: string) => boolean
  readonly open: () => Promise<void>
  readonly show: (take?: boolean) => void
  readonly hide: () => void
}

export interface WorkspaceServices {
  readonly scratchpad: Scratchpad
  readonly beginSetup: (signedIn: boolean) => Promise<void>
  readonly warmSearch: (root: string) => Promise<void>
  readonly showArchive: (path: string) => void
  readonly archiveAgain: (action: Archiving) => Promise<void>
  readonly undoOutside: (action: Outside) => Promise<void>
  readonly redoOutside: (action: Outside) => Promise<void>
  readonly explorerStep: (tab: Tab, by: -1 | 1) => Promise<void>
  readonly mayEnd: (closing: readonly Tab[], every?: readonly Tab[]) => Promise<boolean>
  readonly terminalMoved: (doc: string, from: string | null, to: string) => Promise<void>
  readonly rowsCopied: () => Promise<RowsCopied>
  readonly chatsCarried: (path: string, folder: string) => Promise<() => Promise<void>>
  readonly papers: () => Promise<PaperFollowing>
  readonly readPapers: (root: string, files: readonly Entry[], tree: Entry | null) => Promise<void>
  readonly sheets: () => Promise<PaperSheets>
  readonly pdfPages: () => Promise<PdfPages>
  readonly sites: WebSites
  readonly webData: () => Promise<WebData>
}

const none = () => Promise.resolve()

const missing = () => Promise.reject(new Error('not served'))

let served: WorkspaceServices = {
  scratchpad: {
    on: false,
    holds: () => false,
    open: none,
    show: () => undefined,
    hide: () => undefined,
  },
  beginSetup: none,
  warmSearch: none,
  showArchive: () => undefined,
  archiveAgain: none,
  undoOutside: none,
  redoOutside: none,
  explorerStep: none,
  mayEnd: () => Promise.resolve(true),
  terminalMoved: none,
  rowsCopied: () => Promise.resolve({ numbersAt: () => false, withoutIds: () => null }),
  chatsCarried: () => Promise.resolve(none),
  papers: () => Promise.resolve({ paperMoved: () => undefined, paperGone: () => undefined }),
  readPapers: none,
  sheets: () => Promise.resolve({ paperRewritten: () => undefined, sheetArrived: () => undefined }),
  pdfPages: missing,
  sites: {
    heldElsewhere: () => Promise.resolve(false),
    showElsewhere: none,
    asShortcut: () => Promise.resolve(null),
    convertWebsites: () => Promise.resolve(0),
    webUrlOf: () => Promise.resolve(null),
    newSite: missing,
    aimed: none,
    zoomStep: none,
  },
  webData: missing,
}

export function serveWorkspace(part: Partial<WorkspaceServices>): void {
  served = { ...served, ...part }
}

export const services = (): WorkspaceServices => served
