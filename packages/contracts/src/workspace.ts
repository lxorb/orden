import type { SyncFileOp } from './sync-client'

export interface TextChange {
  readonly from: number
  readonly to: number
  readonly insert: string
}

export interface OpenNote {
  readonly text: string
  readonly onDisk: string | null
  flush(): void
  edited(changes: readonly TextChange[], text: string): void
  wroteAs(written: string): void
  writeTo(
    path: string,
    words: string,
    knew: string | null,
    first: () => Promise<unknown>,
  ): Promise<string | null>
}

export interface WorkspaceNotesPort {
  readonly activeRoot: string | null
  documentAt(path: string): OpenNote | null
  leftOut(root: string): readonly string[]
  openAt(path: string, line: number): Promise<void>
  toggleTaskAt(path: string, line: number, hash?: string): Promise<void>
}

export interface WorkspaceSpace {
  readonly id: string
  readonly name: string
  readonly root: string
}

export interface WorkspaceTab {
  readonly path: string | null
  readonly note: { readonly key: string }
}

export interface SharedNote {
  readonly id: string
  readonly name: string
  readonly path: string
}

export interface WorkspaceViewPort {
  readonly spaces: readonly WorkspaceSpace[]
  readonly tabs: readonly WorkspaceTab[]
  showSpace(id: string): Promise<void>
  reload(path: string, text: string): void
  openShared(item: SharedNote, text: string): void
  showingShared(id: string): boolean
  closeShared(id: string): void
  follow(follower: (op: SyncFileOp) => unknown): () => void
}

export interface WorkspacePorts {
  readonly 'workspace.notes': WorkspaceNotesPort
  readonly 'workspace.view': WorkspaceViewPort
}

export const NO_WORKSPACE_NOTES: WorkspaceNotesPort = {
  activeRoot: null,
  documentAt: () => null,
  leftOut: () => [],
  openAt: () => Promise.resolve(),
  toggleTaskAt: () => Promise.resolve(),
}

export const NO_WORKSPACE_VIEW: WorkspaceViewPort = {
  spaces: [],
  tabs: [],
  showSpace: () => Promise.resolve(),
  reload: () => undefined,
  openShared: () => undefined,
  showingShared: () => false,
  closeShared: () => undefined,
  follow: () => () => undefined,
}
