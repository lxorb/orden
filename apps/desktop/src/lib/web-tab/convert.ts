import { links } from '../link-index.svelte'
import {
  onDisk,
  shownName,
  folderOf,
  isMarkdownPath,
  nameOf,
  withoutExtension,
  invoke,
  joinPath,
} from '../platform/src/api'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { Entry, Space } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { keptBody, webTitleOf, webUrlOf } from './note'
import { sameSite } from './settle'
import { readWebFile, writeShortcut } from '@orden/scan/shortcut'

export interface Converts {
  readonly notes: readonly Entry[]
  readonly activeSpace: Space | null
  entryAt(path: string): Entry | null
  documentAt(path: string): NoteDoc | null
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  fileGone(path: string, kind: 'file'): Promise<void>
  loadTree(): Promise<void>
  bin(path: string, isFolder: boolean): Promise<unknown>
}

export async function asShortcut(ws: Converts, path: string): Promise<string | null> {
  if (ws.documentAt(path)) return null

  const text = await invoke<string>('read_note', { path }).catch(() => null)
  const url = webUrlOf(text)
  if (text === null || url === null) return null

  const title = webTitleOf(text) ?? shownName(nameOf(path))
  const written = writeShortcut(url, title, new Date())
  const shortcut = `${withoutExtension(path)}.url`

  const taken = ws.entryAt(shortcut) !== null || (await onDisk(shortcut))
  const there = taken
    ? await invoke<string>('read_note', { path: shortcut }).catch(() => null)
    : null
  const said = there === null ? null : readWebFile(shortcut, there)
  const already = said !== null && sameSite(said.home ?? said.url, url)
  const free = taken && !already ? await ws.freeNameOnDisk(folderOf(path), nameOf(shortcut)) : null
  const target = free === null ? shortcut : joinPath(folderOf(path), free)

  if (!already) {
    ws.showEntry(ws.freshEntry(target, false))
    await writeFile(target, written)
  }

  const kept = keptBody(text)
  if (kept === null) {
    await oldNoteGone(ws, path)
    await ws.fileGone(path, 'file')
  } else await writeFile(path, kept).catch(() => undefined)

  await ws.loadTree()
  return target
}

async function oldNoteGone(ws: Converts, path: string) {
  try {
    await ws.bin(path, false)
  } catch {
    // Said above: a note that stays is a note beside a shortcut, and harmless.
  }
}

export async function convertWebsites(ws: Converts): Promise<number> {
  if (!ws.activeSpace) return 0

  const notes = ws.notes.filter((one) => isMarkdownPath(one.name) && links.urlOf(one.path) !== null)

  let done = 0
  for (const note of notes) {
    if ((await asShortcut(ws, note.path)) !== null) done += 1
  }

  if (done) await ws.loadTree()
  return done
}
