import type { Entry, ItemMeta, MetaPatch } from './item'
import type { SpaceRole } from './user'

export interface SyncHostPort {
  readonly isNative: boolean
  readonly isDesktop: boolean
  platform(): string
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  joinPath(dir: string, relative: string): string
}

export interface SyncStoragePort {
  text(key: string): string | null
  json(key: string): unknown
  keepText(key: string, value: string): boolean
  keepJson(key: string, value: unknown): boolean
  forget(key: string): void
}

export interface SyncClockPort {
  now(): number
  waited(ms?: number): Promise<void>
}

export interface SyncRemoteSpace {
  readonly id: string
  readonly name: string
  readonly role: SpaceRole
}

export interface SyncUser {
  readonly id: string
}

export interface SyncAccountPort {
  readonly token: string | null
  readonly user: SyncUser | null
  readonly spaces: readonly SyncRemoteSpace[]
  readonly signedIn: boolean
  loadSpaces(): Promise<unknown>
  recheck(): Promise<void>
  signedOutBy(error: unknown): boolean
  forgetWithSession(clear: (kept: boolean) => void): void
  askBeforeLeaving(ask: () => Promise<boolean>): void
}

export interface SyncRemoteNote {
  readonly id: string
  readonly path: string
  readonly seq: number
  readonly version: number
  readonly updatedAt: number
  readonly deleted: boolean
  readonly size: number
  readonly hash: string
}

export interface SyncApiPort {
  readonly base: string
  readonly bytesWithin: number
  fetchInTime(input: string | Request, init?: RequestInit, within?: number): Promise<Response>
  listSpaces(token: string): Promise<{ spaces: readonly SyncRemoteSpace[] }>
  changes(
    token: string,
    spaceId: string,
    since: number,
  ): Promise<{ notes: readonly SyncRemoteNote[]; cursor: number; more: boolean }>
  noteVersions(token: string, id: string): Promise<{ versions: readonly { at: number }[] }>
  noteVersion(token: string, id: string, at: number): Promise<{ at: number; content: string }>
  devices(token: string): Promise<{ devices?: readonly { id: string; name: string }[] }>
  statusOf(error: unknown): number | null
  saidByServer(error: unknown): boolean
}

export type SyncFileKind = 'file' | 'folder' | 'space'

export type SyncFileOp = (
  | {
      op: 'created'
      path: string
      kind: Exclude<SyncFileKind, 'space'>
      root: string | null
      key?: string
      back?: string
      putBack?: true
    }
  | {
      op: 'moved'
      from: string
      to: string
      kind: SyncFileKind
      root: string | null
      into?: string | null
    }
  | {
      op: 'removed'
      path: string
      kind: SyncFileKind
      root: string | null
      back?: string
    }
) & {
  heard?: true
}

export type SyncFileDoer = (op: SyncFileOp, run: () => Promise<unknown>) => Promise<void>

export interface SyncPositioned {
  namesIn(root: string, folder: string): readonly string[] | null
  folders(root: string): ReadonlyMap<string, readonly string[]>
  arrange(
    root: string,
    folder: string,
    names: readonly string[],
  ): { drawn: readonly string[]; done: Promise<unknown> } | null
}

export interface SyncDescribing {
  describedIn(root: string): Readonly<Record<string, ItemMeta>> | null
  describe(root: string, patches: Readonly<Record<string, MetaPatch>>): Promise<string[] | null>
}

export interface SyncWriteHearing {
  there(path: string): Promise<boolean>
  made(path: string): Promise<void>
  wrote(path: string, content: string): void
}

export interface SyncSpace {
  readonly id: string
  readonly name: string
  readonly root: string
}

export interface SyncRootMove {
  readonly from: string
  readonly to: string
}

export interface SyncNote {
  readonly key: string
  readonly path: string | null
  readonly kind: string
  readonly shared: string | null
  readonly latest: string
  readonly live: object
  readonly arrivals: number
  reads: boolean
}

export interface SyncOpenNote<Note extends SyncNote = SyncNote> {
  readonly key: string
  readonly path: string
  readonly note: Note
}

export interface SyncWorkspacePort<Note extends SyncNote = SyncNote> {
  readonly spaces: readonly SyncSpace[]
  readonly shownSpaces: readonly SyncSpace[]
  readonly tree: Entry | null
  readonly activeSpace: SyncSpace | null
  readonly activePath: string | null
  readonly documents: readonly Note[]
  readonly openNotes: readonly SyncOpenNote<Note>[]
  entryAt(path: string): Entry | null
  rootHolding(path: string | null): string | null
  locked(path: string): boolean
  copied(from: string, to: string, root: string | null, into: string | null): void
  open(path: string): Promise<unknown>
  openBehind(path: string): Promise<unknown>
  dropSpace(id: string): Promise<unknown>
  loadTree(): Promise<unknown>
  writeNow(): Promise<unknown>
  writesSettled(): Promise<unknown>
  arrived(path: string): Promise<unknown>
  fileCame(path: string, kind: Exclude<SyncFileKind, 'space'>): Promise<void>
  fileWritten(path: string): void
  fileMoved(from: string, to: string, kind: SyncFileKind): Promise<unknown>
  fileGone(path: string, kind: SyncFileKind, back?: string): Promise<unknown>
  heardMove(from: string, to: string): void
  heardGone(path: string): void
  undoneMoved(from: string, to: string): Promise<unknown>
  holdingWrites<T>(path: string, run: () => Promise<T>, stalled: () => Promise<T>): Promise<T>
  doneBy(doer: SyncFileDoer): () => void
  placeBy(positioned: SyncPositioned): () => void
  placesFrom(root: string): void
  repositioned(): void
  describeBy(describing: SyncDescribing): () => void
  describes(root: string): boolean
  metaFromEngine(root: string): Promise<unknown>
  notesDescribed(root: string): Promise<void>
  spaceUnpaired(root: string): Promise<void>
  hearWrites(hearing: SyncWriteHearing): () => void
  rootMoves(): readonly SyncRootMove[]
  forgetRootMoves(): void
}

export interface SyncPorts {
  readonly 'sync.host': SyncHostPort
  readonly 'sync.storage': SyncStoragePort
  readonly 'sync.clock': SyncClockPort
  readonly 'sync.account': SyncAccountPort
  readonly 'sync.api': SyncApiPort
  readonly 'sync.workspace': SyncWorkspacePort
}
