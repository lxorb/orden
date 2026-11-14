import { isPdfTarget } from '@orden/markdown/links'
import { folderNote, isFolderNote } from '../folder-notes'
import type { Picked } from '../import/sources'
import { readsWords } from '../link-index.svelte'
import { copiesInto } from '../move-targets'
import { copyName, isMarkdownPath, nameOf, invoke, joinPath } from '../platform/src/api'
import type { Entry } from '../workspace.svelte'
import type { Protection } from '../protect/src/api'
import type { ItemMetaStore } from './item-meta.svelte'
import type { Copied, FileActions } from './undo.svelte'
import { copyPath, writeBytes, writeFile } from './write-file'

export interface Copies {
  readonly undone: FileActions
  readonly protection: Pick<Protection, 'copied'>
  rootHolding(path: string | null): string | null
  readonly itemMeta: Pick<ItemMetaStore, 'copied' | 'moved' | 'set'>
  entryAt(path: string): Entry | null
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
  pageNoteForPdf(path: string): Promise<string | null>
}

export interface Copying {
  from: string
  into: string
}

async function copyNameIn(
  ws: Pick<Copies, 'freeNameOnDisk'>,
  dir: string,
  name: string,
  folder: boolean,
): Promise<string> {
  if ((await ws.freeNameOnDisk(dir, name)) === name) return name
  return ws.freeNameOnDisk(dir, folder ? `${name} copy` : copyName(name))
}

function ownNoteRenamed(entry: Entry, to: string): { from: string; to: string } | null {
  const own = folderNote(entry)
  if (!own || !isFolderNote(own.path)) return null

  const ending = /\.[^.]+$/.exec(own.name)?.[0] ?? '.md'
  const renamed = `${nameOf(to)}${ending}`
  if (renamed === own.name) return null

  return { from: joinPath(to, own.name), to: joinPath(to, renamed) }
}

export async function copyRows(ws: Copies, rows: readonly Copying[]): Promise<string[]> {
  const made: Copied[] = []

  for (const { from, into } of rows) {
    const entry = ws.entryAt(from)
    if (!entry || !copiesInto([from], into)) continue

    const path = joinPath(into, await copyNameIn(ws, into, entry.name, entry.is_dir))
    if (await copyEntry(ws, entry, path)) made.push({ path, folder: entry.is_dir, from })
  }

  if (made.length) ws.undone.record({ kind: 'copy', made })
  return made.map((one) => one.path)
}

export async function copyAgain(ws: Copies, made: readonly Copied[]): Promise<void> {
  const again: Copied[] = []

  for (const one of made) {
    const entry = one.from === undefined ? null : ws.entryAt(one.from)
    if (entry && (await copyEntry(ws, entry, one.path))) again.push(one)
  }

  if (again.length) ws.undone.record({ kind: 'copy', made: again })
}

async function copyEntry(ws: Copies, entry: Entry, path: string): Promise<boolean> {
  ws.showEntry(ws.freshEntry(path, entry.is_dir))

  const landed = await copyPath(entry.path, path)
    .then(() => true)
    .catch(() => false)
  if (!landed) return false
  await idsLeftBehind(entry, path)
  ws.itemMeta.copied(entry.path, path)
  ws.protection.copied(entry.path, path, ws.rootHolding(entry.path), ws.rootHolding(path))

  const own = ownNoteRenamed(entry, path)
  const renamed =
    own !== null &&
    (await invoke('rename_note', own).then(
      () => true,
      () => false,
    ))
  if (own && renamed) ws.itemMeta.moved(own.from, own.to)
  await ws.fileCame(path, entry.is_dir ? 'folder' : 'file')

  return true
}

function notesIn(entry: Entry): Entry[] {
  if (!entry.is_dir) return isMarkdownPath(entry.name) ? [entry] : []
  return entry.children.flatMap(notesIn)
}

async function idsLeftBehind(entry: Entry, path: string) {
  const { numbersAt, withoutIds } = await import('../views/copied')
  if (!numbersAt(path)) return
  for (const note of notesIn(entry)) {
    const at = path + note.path.slice(entry.path.length)
    const text = await invoke<string | null>('read_note', { path: at }).catch(() => null)
    const words = text === null ? null : withoutIds(at, text)
    if (words !== null)
      await invoke('write_note', { path: at, content: words }).catch(() => undefined)
  }
}

function partsOf(file: Picked): string[] {
  const inside = (file.webkitRelativePath ?? '').trim()
  return (inside.length ? inside : file.name)
    .split(/[\\/]/)
    .filter((part) => part && part !== '.' && part !== '..')
}

export async function bringIn(
  ws: Copies,
  files: readonly Picked[],
  into: string,
): Promise<string[]> {
  const landed = new Map<string, Copied>()

  try {
    for (const file of files) {
      const [top, ...rest] = partsOf(file)
      if (top === undefined) continue

      let at = landed.get(top)
      if (!at) {
        const folder = rest.length > 0
        at = { path: joinPath(into, await ws.freeNameOnDisk(into, top)), folder }
        landed.set(top, at)
        ws.showEntry(ws.freshEntry(at.path, folder))
      }

      const path = rest.length ? joinPath(at.path, rest.join('/')) : at.path
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (readsWords(path)) await wordsIn(path, new TextDecoder().decode(bytes))
      else await writeBytes(path, bytes)

      if (!rest.length && isPdfTarget(path)) {
        at.path = (await ws.pageNoteForPdf(path)) ?? path
      }
    }
  } finally {
    if (landed.size) ws.undone.record({ kind: 'copy', made: [...landed.values()] })
  }

  return [...landed.values()].map((one) => one.path)
}

async function wordsIn(path: string, words: string): Promise<void> {
  await writeFile(path, words)
}
