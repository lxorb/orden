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

export interface WorkspacePorts {
  readonly 'workspace.notes': WorkspaceNotesPort
}

export const NO_WORKSPACE_NOTES: WorkspaceNotesPort = {
  activeRoot: null,
  documentAt: () => null,
  leftOut: () => [],
  openAt: () => Promise.resolve(),
  toggleTaskAt: () => Promise.resolve(),
}
