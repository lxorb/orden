import { extracted, merged, type Split, splitAt } from '../composer'
import type { Retargeting } from '../link-index.svelte'
import { folderOf, isMarkdownPath, samePath, withinSpace } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { type Tab, UNTITLED } from './documents.svelte'
import type { FileActions } from './undo.svelte'
import { writeFile } from './write-file'

export interface Composes {
  readonly activeSpace: { root: string } | null
  readonly active: Tab | null
  readonly undone: FileActions
  flush(): void
  reload(path: string, content: string): void
  fileGone(path: string, kind: 'file'): Promise<void>
  retarget(from: string, to: string, how?: Retargeting): Promise<number>
  open(path: string): Promise<void>
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  loadTree(): Promise<void>
  persist(): void
}

export function mergeable(
  root: string | null,
  path: string,
  writable: (path: string) => boolean,
): boolean {
  return root !== null && isMarkdownPath(path) && withinSpace(root, path) !== null && writable(path)
}

export function carvable(path: string, writable: (path: string) => boolean): boolean {
  return isMarkdownPath(path) && writable(path)
}

export async function mergeInto(ws: Composes, from: string, into: string): Promise<void> {
  if (samePath(from, into)) return

  const root = ws.activeSpace?.root ?? null
  const { canWriteAt } = await import('../sharing.svelte')
  if (!mergeable(root, from, canWriteAt) || !mergeable(root, into, canWriteAt)) return

  const [fromContent, intoContent] = await Promise.all([
    invoke<string>('read_note', { path: from }).catch(() => null),
    invoke<string>('read_note', { path: into }).catch(() => null),
  ])
  if (fromContent === null || intoContent === null) return

  const joined = merged(intoContent, fromContent)

  await invoke('snapshot_note', { path: into, content: intoContent }).catch(() => undefined)
  await writeFile(into, joined)
  ws.reload(into, joined)

  const relinked: string[] = []
  await ws.retarget(from, into, { touched: relinked })
  const intoAfter = await invoke<string>('read_note', { path: into }).catch(() => joined)

  await invoke('snapshot_note', { path: from, content: fromContent }).catch(() => undefined)
  await invoke('delete_note', { path: from })
  await ws.fileGone(from, 'file')

  ws.undone.record({
    kind: 'merge',
    from,
    fromContent,
    into,
    intoContent,
    intoAfter,
    relinked,
  })
  await ws.loadTree()
  await ws.open(into)
}

export async function splitAtCaret(ws: Composes, at: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const doc = tab.doc
  await carve(ws, tab.path, doc, (named) => splitAt(doc, at, UNTITLED, named), 'split')
}

export async function extractSelection(ws: Composes, from: number, to: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const doc = tab.doc
  await carve(ws, tab.path, doc, (named) => extracted(doc, from, to, UNTITLED, named), 'extract')
}

async function carve(
  ws: Composes,
  path: string,
  before: string,
  cut: (named?: string) => Split | null,
  kind: 'split' | 'extract',
) {
  const { canWriteAt } = await import('../sharing.svelte')
  if (!carvable(path, canWriteAt)) return

  const wanted = cut()
  if (!wanted) return

  const folder = folderOf(path)
  const file = await ws.freeNameOnDisk(folder, `${wanted.name}.md`)
  const created = joinPath(folder, file)
  const carved = cut(file.replace(/\.md$/, '')) ?? wanted

  await writeFile(created, carved.taken)

  await invoke('snapshot_note', { path, content: before }).catch(() => undefined)
  await writeFile(path, carved.kept)
  ws.reload(path, carved.kept)

  ws.undone.record({
    kind,
    from: path,
    fromContent: before,
    fromAfter: carved.kept,
    created,
    createdContent: carved.taken,
  })
  await ws.loadTree()
  ws.persist()
}
