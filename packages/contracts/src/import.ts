export type BrowserId =
  | 'safari'
  | 'firefox'
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'chromium'
  | 'vivaldi'
  | 'opera'
  | 'opera-gx'
  | 'arc'

export type Importer = BrowserId | 'zen'

export type NotesFrom = 'vault' | 'folder' | 'files' | 'apple'

export interface NotesBrought {
  readonly picked: boolean
  readonly trouble: string | null
}

export interface ImportBringPort {
  here(): Promise<ReadonlySet<Importer>>
  browser(importer: Importer): Promise<readonly string[]>
  notes(from: NotesFrom): Promise<NotesBrought>
}

export interface ImportPorts {
  readonly 'import.bring': ImportBringPort
}
