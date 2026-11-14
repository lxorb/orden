import { oneEdit } from '@orden/markdown/edits'
import { freePath } from '@orden/markdown/paths'
import {
  sha256,
  onDisk,
  folderOf,
  isMarkdownPath,
  samePath,
  within,
  invoke,
} from '../platform/src/api'
import { applied, appliedToFile, type Edit, endingsLike } from '@orden/scan/search/replace'
import { links, type Retargeting } from '../link-index.svelte'
import type { HoldCheck } from '@orden/sync-core'
import { keptAway } from '../web/away.svelte'
import type { Entry } from '../workspace.svelte'
import type { Archive } from './archive.svelte'
import type { NoteDoc } from './documents.svelte'
import type { Kind } from './file-ops'
import type { Binning, FileAction, FileActions, Kept } from './undo.svelte'
import type { Bookmark } from './bookmarks.svelte'
import { inFileTurn, readText, writeEdited, writeInTurn } from './in-turn'
import { writeFile } from './write-file'

export interface PutsBack {
  readonly undone: FileActions
  readonly archive: Archive
  openEntry(path: string): Promise<void>
  documentAt(path: string): NoteDoc | null
  entryAt(path: string): Entry | null
  reload(path: string, content: string): void
  retarget(from: string, to: string, how?: Retargeting): Promise<number>
  fileMoved(from: string, to: string, kind: Kind): Promise<void>
  fileGone(path: string, kind: 'file' | 'folder', back?: string): Promise<void>
  fileCame(
    path: string,
    kind: 'file' | 'folder',
    key?: string,
    back?: string,
    putBack?: boolean,
  ): Promise<void>
  undoFileAction(): Promise<void>
  renameOnDisk(from: string, to: string, kind: Kind): Promise<void>
  holdingUnder(path: string, run: () => Promise<void>): Promise<void>
  loadTree(): Promise<void>
  persist(): void
  readonly bookmarks: { put(root: string, list: Bookmark[]): void }
  bin(path: string, isFolder: boolean, how?: Binning): Promise<Kept | null>
}

export async function undoLastFileAction(ws: PutsBack): Promise<void> {
  const action = ws.undone.last
  if (!action) return

  if (action.kind === 'many') {
    const steps = [...action.steps]
    for (let step = steps.at(-1); step; step = steps.at(-1)) {
      if (!(await undoOne(ws, step))) {
        if (steps.length < action.steps.length) action.steps = steps
        await ws.loadTree()
        await refused(ws, action)
        return
      }
      steps.pop()
    }
  } else if (!(await undoOne(ws, action))) {
    await refused(ws, action)
    return
  }

  ws.undone.drop()
  await ws.loadTree()
  ws.persist()
}

async function refused(ws: PutsBack, action: FileAction) {
  const { failed } = await import('../failed.svelte')
  failed.tell(
    () => void ws.undoFileAction(),
    true,
    () => ws.undone.giveUp(action),
  )
}

async function undoOne(ws: PutsBack, action: FileAction): Promise<boolean> {
  try {
    switch (action.kind) {
      case 'delete':
        action.path = await putBack(action)
        await ws.fileCame(
          action.path,
          action.folder ? 'folder' : 'file',
          undefined,
          action.back ?? action.trashId,
          true,
        )
        break
      case 'create': {
        const kept = await ws.bin(action.path, false)
        action.content = kept?.content ?? ''
        if (kept?.trashId) action.trashId = kept.trashId
        else delete action.trashId
        if (kept?.back) action.back = kept.back
        else delete action.back
        await ws.fileGone(action.path, 'file', kept?.trashId ?? kept?.back)
        break
      }
      case 'many':
        for (const step of [...action.steps].reverse()) if (!(await undoOne(ws, step))) return false
        break
      case 'keep': {
        const { moving } = await import('../list-landing.svelte')
        moving(() => ws.bookmarks.put(action.root, action.before))
        break
      }
      case 'merge':
        await unmerge(ws, action)
        break
      case 'split':
      case 'extract':
        await uncarve(ws, action)
        break
      case 'move':
      case 'rename':
        await putName(ws, action)
        break
      case 'replace':
        await putWordsBack(ws, action)
        break
      case 'import':
        await unimport(ws, action)
        break
      case 'copy':
        await uncopy(ws, action)
        break
      case 'archive':
      case 'unarchive':
        await unarchive(ws, action)
        break
      case 'outside':
        if (!__EVEN_PLUGIN__) await (await import('../explorer/src/api')).undoOutside(action)
        break
    }
  } catch {
    return false
  }
  return true
}

async function unimport(ws: PutsBack, action: Extract<FileAction, { kind: 'import' }>) {
  for (const path of action.paths) {
    const wrote = action.wrote[path]
    if (wrote === undefined) {
      const gone = await ws
        .bin(path, false, { madeHere: true })
        .then(() => true)
        .catch(() => false)
      if (gone) await ws.fileGone(path, 'file')
      continue
    }

    const now = await invoke<string>('read_note', { path }).catch(() => null)
    if (now === null || (await sha256(now)) !== wrote) continue

    const gone = await invoke('delete_note', { path })
      .then(() => true)
      .catch(() => false)
    if (gone) await ws.fileGone(path, 'file')
  }
}

async function uncopy(ws: PutsBack, action: Extract<FileAction, { kind: 'copy' }>) {
  for (const { path, folder } of action.made) {
    await ws.bin(path, folder, { madeHere: true })
    await ws.fileGone(path, folder ? 'folder' : 'file')
  }
}

export async function putBack(action: Extract<FileAction, { kind: 'delete' }>): Promise<string> {
  if (!action.trashId && action.notes) {
    await invoke('create_folder', { path: action.path })
    for (const path of action.folders ?? []) await invoke('create_folder', { path })
    for (const note of action.notes) await writeBeside(note.path, note.content)
    return action.path
  }

  if (!action.trashId) {
    if (!action.content && !(isMarkdownPath(action.path) && !action.folder)) {
      throw new Error('there is nothing to put back')
    }

    return writeBeside(action.path, action.content)
  }

  const restored = await invoke<string>('restore_trash', { id: action.trashId }).catch(() => null)

  if (restored !== null)
    return action.trashedAt ? cameOver(action, restored) : restored || action.path
  if (!action.content) throw new Error('the deleted note is no longer in the trash')

  return writeBeside(action.path, action.content)
}

async function cameOver(action: Extract<FileAction, { kind: 'delete' }>, restored: string) {
  const left = action.trashedAt
  const from = restored || left?.path
  if (!left || !from) return action.path
  if (samePath(from, action.path)) {
    delete action.trashedAt
    return from
  }
  const to = await freeBeside(action.path)
  await invoke('create_folder', { path: folderOf(to) }).catch(() => undefined)
  await invoke('rename_note', { from, to })
  for (let up = folderOf(from); within(left.root, up) !== null; up = folderOf(up)) {
    await invoke('remove_empty_folder', { path: up }).catch(() => undefined)
  }
  delete action.trashedAt
  return to
}

async function writeBeside(path: string, content: string): Promise<string> {
  const at = await freeBeside(path)
  await invoke('write_note', { path: at, content })
  return at
}

async function freeBeside(path: string): Promise<string> {
  const found: string[] = []
  for (;;) {
    const at = freePath(path, (candidate) => found.includes(candidate))
    if (!(await onDisk(at))) return at
    found.push(at)
  }
}

async function stillSays(ws: PutsBack, path: string, words: string): Promise<boolean> {
  const open = ws.documentAt(path)
  if (open) open.flush()
  const now = open?.text ?? (await invoke<string>('read_note', { path }).catch(() => null))
  if (now === null) return false
  return now.replace(/\r\n/g, '\n') === words.replace(/\r\n/g, '\n')
}

export async function heldIn(path: string): Promise<Pick<Kept, 'notes' | 'folders'> | null> {
  const away = keptAway.under(path)
  if (away.reduce((all, one) => all + one.size, 0) > HELD) return null
  if (away.length && !(await keptAway.bringBackUnder(path))) return null
  const options = { papers: true, every: true }
  const listed = await invoke<Entry>('read_tree', { root: path, options }).catch(() => null)
  if (!listed) return null

  const notes: { path: string; content: string }[] = []
  const folders: string[] = []
  let size = 0
  const walk = async (entry: Entry): Promise<boolean> => {
    for (const one of entry.children) {
      if (one.is_dir) {
        folders.push(one.path)
        if (!(await walk(one))) return false
        continue
      }
      if (CLUTTER.test(one.name)) continue
      const content = await invoke<string>('read_note', { path: one.path }).catch(() => null)
      if (content === null) return false
      size += content.length
      if (size > HELD) return false
      notes.push({ path: one.path, content })
    }
    return true
  }
  return (await walk(listed)) ? { notes, folders } : null
}

export async function accountHoldsAll(
  path: string,
  holds: (path: string, how: HoldCheck) => Promise<boolean>,
): Promise<boolean> {
  const options = { papers: true, every: true, showHidden: true }
  const listed = await invoke<Entry>('read_tree', { root: path, options }).catch(() => null)
  if (!listed) return false

  const budget = { left: HOLDS_READ }
  const walk = async (entry: Entry): Promise<boolean> => {
    if (entry.unlisted) return false
    for (const one of entry.children) {
      if (one.name.startsWith('.')) return false
      if (one.is_dir) {
        if (!(await walk(one))) return false
      } else if (CLUTTER.test(one.name)) {
        continue
      } else if (!isMarkdownPath(one.name)) {
        return false
      } else if (!(await holds(one.path, { modified: one.modified, budget }))) {
        return false
      }
    }
    return true
  }
  return walk(listed)
}

const HOLDS_READ = 16_000_000

const CLUTTER = /^(~\$.*|thumbs\.db|desktop\.ini|Icon\r)$/i

const HELD = 4_000_000

async function unarchive(
  ws: PutsBack,
  action: Extract<FileAction, { kind: 'archive' | 'unarchive' }>,
) {
  await ws.archive.change(action.root, action.restored, action.archived)
  for (const path of action.closed) await ws.openEntry(path)
}

async function putWordsBack(ws: PutsBack, action: Extract<FileAction, { kind: 'replace' }>) {
  for (const note of action.notes) {
    if (ws.documentAt(note.path)) continue
    const now = await readText(note.path)
    if (now === null) throw new Error(`${note.path} will not read, so nothing is written over it`)
  }

  for (const note of action.notes) {
    const open = ws.documentAt(note.path)
    if (open) {
      open.flush()
      const knew = open.onDisk
      const back = open.take(note.edits, note.after).text
      const written = await writeEdited(open, note.path, back, knew)
      if (written !== null) links.noteSaved(note.path, written)
      continue
    }

    const down = await inFileTurn(note.path, async () => {
      const file = await readText(note.path)
      if (file === null)
        throw new Error(`${note.path} will not read, so nothing is written over it`)
      const now = endingsLike(file, note.after)
      const words = now === note.after ? note.content : carriedPast(note, file, now)
      await writeInTurn(note.path, words, false)
      return words
    })
    links.noteSaved(note.path, down)
  }
}

function carriedPast(
  note: { after: string; edits: readonly Edit[] },
  file: string,
  now: string,
): string {
  const since = oneEdit(note.after, now)
  if (!since) return applied(now, note.edits)

  const grew = since.insert.length - (since.to - since.from)
  const carried = note.edits.flatMap((one) => {
    if (one.to <= since.from) return [one]
    if (one.from >= since.to) return [{ ...one, from: one.from + grew, to: one.to + grew }]
    return []
  })

  return file === now ? applied(now, carried) : appliedToFile(file, carried)
}

async function putName(ws: PutsBack, action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
  if (action.kind === 'move' && action.carries) {
    ;(await import('./moving-space')).followsTo(action.from)
  }
  const kind = ws.entryAt(action.to)?.is_dir === true ? 'folder' : 'file'
  const back =
    action.kind === 'move'
      ? await (await import('./chat-leaving')).chatsCarried(action.to, folderOf(action.from))
      : null

  const { moving: underWay } = await import('./landing')
  await underWay(action.from, () =>
    ws.holdingUnder(action.to, async () => {
      await ws.renameOnDisk(action.to, action.from, kind).catch(async (error: unknown) => {
        await back?.()
        throw error
      })

      if (action.rewrote)
        await ws.retarget(action.to, action.from, { moved: true }).catch(() => undefined)
      await ws.fileMoved(action.to, action.from, kind)
    }),
  )
  if (action.nests) {
    await invoke('remove_empty_folder', { path: folderOf(action.to) }).catch(() => undefined)
  }
  if (action.kind === 'move' && action.carries) {
    await (await import('./moving-space')).tabsFollow(action.from)
  }
}

async function unmerge(ws: PutsBack, action: Extract<FileAction, { kind: 'merge' }>) {
  if (!(await stillSays(ws, action.into, action.intoAfter))) {
    throw new Error(`${action.into} has been written in since the merge`)
  }

  await writeFile(action.into, action.intoContent)
  const from = await freeBeside(action.from)
  await writeFile(from, action.fromContent)
  ws.reload(action.into, action.intoContent)

  const only = action.relinked?.filter(
    (path) => !samePath(path, action.into) && !samePath(path, action.from),
  )
  if (!only || only.length) await ws.retarget(action.into, from, only ? { only } : {})
}

async function uncarve(ws: PutsBack, action: Extract<FileAction, { kind: 'split' | 'extract' }>) {
  if (!(await stillSays(ws, action.from, action.fromAfter))) {
    throw new Error(`${action.from} has been written in since it was carved`)
  }
  const untouched = await stillSays(ws, action.created, action.createdContent)

  await writeFile(action.from, action.fromContent)
  if (untouched) {
    await invoke('delete_note', { path: action.created }).catch(() => undefined)
    await ws.fileGone(action.created, 'file')
  }
  ws.reload(action.from, action.fromContent)
}
