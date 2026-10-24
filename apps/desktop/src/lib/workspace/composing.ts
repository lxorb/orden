/** One note out of another, and two notes into one.
 *
 *  Three gestures and they are the same handful of writes in a different order: a
 *  merge appends a note into another and points every link that came to the first
 *  at the second; a split takes everything from the caret on; an extraction takes
 *  the selection. Each leaves a link behind, keeps a snapshot of every note it
 *  touches, tells the index what each says now, and records one entry to undo.
 *
 *  What the words themselves become is composer.ts, which is pure and tested on its
 *  own. What is here is the writing, the links and the undo - which is why it takes
 *  a store rather than a string. */

import { extracted, merged, type Split, splitAt } from '../composer'
import type { Retargeting } from '../link-index.svelte'
import { folderOf, samePath, withinSpace } from '../space-paths'
import { invoke, joinPath } from '../tauri'
import { type Tab, UNTITLED } from './documents.svelte'
import type { FileActions } from './undo.svelte'
import { writeFile } from './write-file'

/** What composing needs of the store the notes are open in. */
export interface Composes {
  readonly activeSpace: { root: string } | null
  readonly active: Tab | null
  readonly undone: FileActions
  flush(): void
  reload(path: string, content: string): void
  /** The note merged away, said the way a delete is; see workspace/file-ops.ts. */
  fileGone(path: string, kind: 'file'): Promise<void>
  retarget(from: string, to: string, how?: Retargeting): Promise<number>
  open(path: string): Promise<void>
  freeNameOnDisk(dir: string, wanted: string): Promise<string>
  loadTree(): Promise<void>
  persist(): void
}

/** Whether a note may take part in a merge, asked of both notes: once before the
 *  palette offers a merge, and again by the merge itself, which can be reached
 *  other ways than the palette.
 *
 *  It has to be writable, since one note is written and the other deleted; that
 *  is what split and extract ask too. And it has to be one of the open space's.
 *  A tab outlives a switch of space while the notes offered to merge into are the
 *  open space's, and the links that are pointed at the note left behind are found
 *  only within the open space: a note of another one would be deleted from under
 *  every link to it, and its words would land in a space it was never in.
 *
 *  Who may write where is sharing.svelte.ts's, handed in rather than imported: it
 *  reaches the workspace through sync, and this file is loaded while the workspace
 *  itself is being made. */
export function mergeable(
  root: string | null,
  path: string,
  writable: (path: string) => boolean,
): boolean {
  return root !== null && withinSpace(root, path) !== null && writable(path)
}

/** Appends this note into another, deletes it, and points every link that came
 *  here at the note it went into. */
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

  // Before the note goes, so the links that pointed at it can still be found.
  const relinked: string[] = []
  await ws.retarget(from, into, { touched: relinked })
  // What the undo checks `into` against, read after the rewrite: a link in `into`
  // that named the folded note was just pointed at `into` itself, so the joined words
  // are no longer what it says, and comparing against them took the merge's own
  // rewrite for typing and refused the undo.
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

/** Everything from the caret on becomes a note of its own, with a link left in
 *  its place. */
export async function splitAtCaret(ws: Composes, at: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const doc = tab.doc
  await carve(ws, tab.path, doc, (named) => splitAt(doc, at, UNTITLED, named), 'split')
}

/** The selection becomes a note of its own, with a link in its place. */
export async function extractSelection(ws: Composes, from: number, to: number): Promise<void> {
  const tab = ws.active
  if (!tab?.path) return
  ws.flush()

  const doc = tab.doc
  await carve(ws, tab.path, doc, (named) => extracted(doc, from, to, UNTITLED, named), 'extract')
}

/** What a split and an extraction both do: write the new note, write what is
 *  left of this one, and remember enough to undo both.
 *
 *  `cut` is asked twice: once for the name the new note reaches for, and again
 *  with the name it was given. The link left behind is written in the second,
 *  because a link built before the name was free would point at the note that
 *  already had it, and nothing would point at the one just made. */
async function carve(
  ws: Composes,
  path: string,
  before: string,
  cut: (named?: string) => Split | null,
  kind: 'split' | 'extract',
) {
  const wanted = cut()
  if (!wanted) return

  // Stepped aside the way every other new name in the app is, through the store's
  // own `freeName`: a copy of the numbering lived here, and it counted only the
  // files, so a carved note could be handed the name of a folder. The disk is
  // asked too, since the tab can be one from a space that is not on screen.
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
