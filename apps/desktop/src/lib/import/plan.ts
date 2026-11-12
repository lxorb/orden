export type FormatId =
  | 'notion'
  | 'evernote'
  | 'keep'
  | 'bear'
  | 'logseq'
  | 'roam'
  | 'craft'
  | 'obsidian'
  | 'onenote'
  | 'tomboy'
  | 'apple-notes'
  | 'journal'
  | 'table'
  | 'markdown'
  | 'pandoc'
  | 'pdf-pages'
  | 'todoist'

export type Planned =
  | { kind: 'note'; path: string; text: string }
  | { kind: 'file'; path: string; bytes: Uint8Array; pages?: true }

export interface ImportPlan {
  format: FormatId
  files: Planned[]
  lost: string[]
  inbox?: string
}

export interface Counts {
  notes: number
  files: number
  folders: number
  bytes: number
}

export function counts(plan: ImportPlan): Counts {
  const folders = new Set<string>()
  let notes = 0
  let files = 0
  let bytes = 0

  for (const one of plan.files) {
    const at = one.path.lastIndexOf('/')
    if (at > 0) for (const folder of everyFolder(one.path.slice(0, at))) folders.add(folder)

    if (one.kind === 'note') {
      notes += 1
      bytes += one.text.length
    } else {
      files += 1
      bytes += one.bytes.length
    }
  }

  return { notes, files, folders: folders.size, bytes }
}

function everyFolder(folder: string): string[] {
  const parts = folder.split('/')
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}
