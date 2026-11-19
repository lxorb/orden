export type BrowserId =
  'safari' | 'firefox' | 'chrome' | 'edge' | 'brave' | 'chromium' | 'vivaldi' | 'opera' | 'opera-gx' | 'arc'

export type Importer = BrowserId | 'zen'

export type NotesFrom = 'vault' | 'folder' | 'files' | 'apple'

export interface NotesBrought {
  readonly picked: boolean
  readonly trouble: string | null
}

export interface SharedItem {
  readonly name: string
  readonly mime: string
  readonly size: number
  readonly text: string | null
}

export interface Arrived {
  readonly action: string
  readonly subject: string
  readonly items: readonly SharedItem[]
}

export interface Shared extends Arrived {
  readonly title: string
  readonly words: string
  readonly markdown: string
  readonly task: string
  readonly fitsInNote: boolean
}

export interface ImportBringPort {
  here(): Promise<ReadonlySet<Importer>>
  browser(importer: Importer): Promise<readonly string[]>
  notes(from: NotesFrom): Promise<NotesBrought>
  shared(json: string): Promise<Shared | null>
  landShared(
    shared: Shared,
    bytes: ReadonlyMap<number, Uint8Array>,
    root: string,
    folder: string,
  ): Promise<string | null>
}

export interface ImportPorts {
  readonly 'import.bring': ImportBringPort
}
