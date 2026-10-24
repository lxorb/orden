/** Putting the last file operation back.
 *
 *  Seven kinds of operation and seven ways back, each of them a write or two and then
 *  the operation said the way every file operation is: once, to everything kept by
 *  path (see workspace/file-ops.ts), with a document open on a file taking the words
 *  it says now. What is on the stack and how long it stays there is
 *  workspace/undo.svelte.ts; this is what one entry means when somebody asks for it
 *  back; redoing.ts is the way forward again.
 *
 *  Its own module because none of it is about the workspace's own state. Every one
 *  of these reads a recorded action and writes the disk, which is why it can be
 *  tested by handing it a stand-in store rather than a workspace. */

import { oneEdit } from '@nib/markdown/edits'
import { freePath } from '@nib/markdown/paths'
import { sha256 } from '../bytes'
import { applied, type Edit } from '../search/replace'
import type { Retargeting } from '../link-index.svelte'
import { onDisk } from '../on-disk'
import { folderOf, samePath } from '../space-paths'
import { invoke } from '../tauri'
import type { Entry } from '../workspace.svelte'
import type { Archive } from './archive.svelte'
import type { NoteDoc } from './documents.svelte'
import type { Kind } from './file-ops'
import type { FileAction, FileActions, Kept } from './undo.svelte'
import type { Bookmark } from './bookmarks.svelte'
import { writeFile } from './write-file'

/** What putting a file operation back needs of the store holding it. */
export interface PutsBack {
  readonly undone: FileActions
  readonly archive: Archive
  openEntry(path: string): Promise<void>
  /** The document a file is open as; see workspace/open.ts. */
  documentAt(path: string): NoteDoc | null
  entryAt(path: string): Entry | null
  reload(path: string, content: string): void
  retarget(from: string, to: string, how?: Retargeting): Promise<number>
  /** A file operation, said once to everything kept by path; see `fileMoved` in
   *  workspace.svelte.ts. A rename put back is a rename, a delete put back is a file
   *  come back, and an import or a copy taken back is files gone. */
  fileMoved(from: string, to: string, kind: Kind): Promise<void>
  fileGone(path: string, kind: 'file' | 'folder'): Promise<void>
  fileCame(path: string, kind: 'file' | 'folder'): Promise<void>
  /** One file operation on everything open at or under a path, after whatever write
   *  of any of it is in the air; see `holdingUnder` in workspace/saving.svelte.ts. */
  holdingUnder(path: string, run: () => Promise<void>): Promise<void>
  loadTree(): Promise<void>
  persist(): void
  readonly bookmarks: { put(root: string, list: Bookmark[]): void }
  /** A file deleted without a step to undo it; see `bin` in workspace.svelte.ts. */
  bin(path: string, isFolder: boolean): Promise<Kept | null>
}

/** Puts the last file operation back. */
export async function undoLastFileAction(ws: PutsBack): Promise<void> {
  const action = ws.undone.last
  if (!action) return

  if (action.kind === 'many') {
    // The steps of one gesture, newest first. One that will not go back leaves those
    // before it on the stack as the step, to be asked for again.
    const steps = [...action.steps]
    for (let step = steps.at(-1); step; step = steps.at(-1)) {
      if (!(await undoOne(ws, step))) {
        if (steps.length < action.steps.length) action.steps = steps
        await ws.loadTree()
        return
      }
      steps.pop()
    }
  } else if (!(await undoOne(ws, action))) return

  ws.undone.drop()
  await ws.loadTree()
  ws.persist()
}

/** Puts one operation back; false where it would not go. */
async function undoOne(ws: PutsBack, action: FileAction): Promise<boolean> {
  try {
    switch (action.kind) {
      case 'delete':
        // And the index reads it again, so the links to it resolve at once.
        await ws.fileCame(await putBack(action), action.folder ? 'folder' : 'file')
        break
      case 'create': {
        // Into Recently deleted, and what that kept goes on the step for a redo.
        const kept = await ws.bin(action.path, false)
        action.content = kept?.content ?? ''
        if (kept?.trashId) action.trashId = kept.trashId
        else delete action.trashId
        await ws.fileGone(action.path, 'file')
        break
      }
      case 'many':
        for (const step of [...action.steps].reverse()) if (!(await undoOne(ws, step))) return false
        break
      case 'keep': {
        // The rows sliding as they go, the way the drop that kept them slid them.
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
    }
  } catch {
    // Something else has since changed the file; leave what is there alone.
    // The action stays on the stack, so the same undo can be tried again
    // once whatever is in the way has been dealt with.
    return false
  }
  return true
}

/** An import taken back: the files it wrote, gone again.
 *
 *  Outright rather than into the trash, for a note that still says what the import
 *  wrote. That was never a note anybody kept, and putting three thousand rows into
 *  Recently deleted would bury whatever is actually in there. A tab that is open on
 *  one of them is closed, the way a deleted note's is.
 *
 *  A note written in since is somebody's writing, and taking it away outright lost
 *  it for good, so it stays where it is. What has no hash to compare - a paper, a
 *  picture, a page note - goes to Recently deleted the way a note made here does
 *  when that is undone, since nothing can say it has not changed.
 *
 *  A file that will not go is stepped over rather than stopping the undo: the
 *  rest of the import still goes, and what is left is what somebody has since
 *  taken an interest in. */
async function unimport(ws: PutsBack, action: Extract<FileAction, { kind: 'import' }>) {
  for (const path of action.paths) {
    const wrote = action.wrote[path]
    if (wrote === undefined) {
      const gone = await ws
        .bin(path, false)
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

/** A copy taken back: what it made, gone again, into Recently deleted the way a note
 *  made here goes when that is undone. A copy is a note somebody can go on writing in
 *  before asking for it back, and taken off the disk outright that writing was gone
 *  for good. A tab open on anything in it closes as it goes. */
async function uncopy(ws: PutsBack, action: Extract<FileAction, { kind: 'copy' }>) {
  for (const { path, folder } of action.made) {
    await ws.bin(path, folder)
    await ws.fileGone(path, folder ? 'folder' : 'file')
  }
}

/** A deleted note back where it was, answering with where that is. Out of the
 *  device's trash when it went there - which moves it aside when something has
 *  taken its name meanwhile - and from the snapshot taken on the way out otherwise,
 *  which steps aside the same way; see `writeBeside`.
 *
 *  The trash can refuse: the sweep runs daily and clears anything past its
 *  fourteen days, and Recently deleted can purge an entry by hand. The
 *  snapshot is still here either way, so it stands in rather than leaving
 *  the note gone with nothing said. */
export async function putBack(action: Extract<FileAction, { kind: 'delete' }>): Promise<string> {
  if (!action.trashId && action.notes) {
    // A folder deleted signed in: the folders it held, and its notes' words.
    await invoke('create_folder', { path: action.path })
    for (const path of action.folders ?? []) await invoke('create_folder', { path })
    // Beside a note made at the same name since, as a note's own delete does.
    for (const note of action.notes) await writeBeside(note.path, note.content)
    return action.path
  }

  if (!action.trashId) {
    // Nothing kept and nothing in the trash, which is what a PDF deleted while
    // signed in looks like. Writing nothing would leave an empty file where the
    // paper was, so this says so instead.
    if (!action.content) throw new Error('there is nothing to put back')

    return writeBeside(action.path, action.content)
  }

  const restored = await invoke<string>('restore_trash', { id: action.trashId }).catch(() => null)

  if (restored !== null) return restored || action.path
  if (!action.content) throw new Error('the deleted note is no longer in the trash')

  return writeBeside(action.path, action.content)
}

/** Words written back at `path`, or beside it where something is there now, answering
 *  with where they went - the way the trash puts a note back.
 *
 *  A note can be made at a deleted note's name before the delete is undone, and the
 *  undo used to write over it: the words typed into the new one were gone, and with
 *  no version of them kept, since nothing had been asked to keep one. So the disk is
 *  asked first, and a name with a file at it steps aside as a new note's does. */
async function writeBeside(path: string, content: string): Promise<string> {
  const at = await freeBeside(path)
  await invoke('write_note', { path: at, content })
  return at
}

/** `path`, or the first spelling beside it with nothing on the disk at it. */
async function freeBeside(path: string): Promise<string> {
  const found: string[] = []
  for (;;) {
    const at = freePath(path, (candidate) => found.includes(candidate))
    if (!(await onDisk(at))) return at
    found.push(at)
  }
}

/** Whether a note still says what an operation left it saying: the document open on
 *  it where there is one, since what is typed there may not have reached the file
 *  yet, and the file otherwise. Either line ending, because a file that had Windows
 *  ones keeps them whenever the app writes it; see `as_written` in notes.rs. A file
 *  that will not read cannot say it is unchanged. */
async function stillSays(ws: PutsBack, path: string, words: string): Promise<boolean> {
  const open = ws.documentAt(path)
  if (open) open.flush()
  const now = open?.text ?? (await invoke<string>('read_note', { path }).catch(() => null))
  if (now === null) return false
  return now.replace(/\r\n/g, '\n') === words.replace(/\r\n/g, '\n')
}

/** What a folder about to be deleted signed in holds: the folders under it and the
 *  words of every file in it, read off the disk, so an undo can write them again.
 *  Null when that is not the whole folder - a picture, a PDF, anything that is not
 *  words - or more than is worth holding, which leaves the deletion to Recently
 *  deleted. The file list leaves those out, and an undo read from it gave back the
 *  notes without them, saying nothing. */
export async function heldIn(path: string): Promise<Pick<Kept, 'notes' | 'folders'> | null> {
  // Dotfiles and a system's own clutter are left out, as sync leaves them: the
  // account keeps no copy of them either, and a Finder's .DS_Store is not words.
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

/** What sync leaves alone besides dotfiles; see `ignored` in space_watch/walk.rs. */
const CLUTTER = /^(~\$.*|thumbs\.db|desktop\.ini|Icon\r)$/i

/** As much of a folder's words as a deletion holds: a few megabytes, past which the
 *  step is not worth the memory and Recently deleted is the way back. */
const HELD = 4_000_000

/** Puts an archiving back, either way round, and opens the tabs it closed. */
async function unarchive(
  ws: PutsBack,
  action: Extract<FileAction, { kind: 'archive' | 'unarchive' }>,
) {
  await ws.archive.change(action.root, action.restored, action.archived)
  for (const path of action.closed) await ws.openEntry(path)
}

/** Puts a replacement back: every note that was touched says what it said, with
 *  whatever has been typed into it since the replacement kept.
 *
 *  The edits that take it back were worked out against the words the replacement
 *  left, and the reader may have gone on writing. So a note open in a pane takes
 *  them carried onto the words it holds now, through everything the document
 *  remembers changing - the same road the replacement itself took (see `writeOpen`
 *  in workspace/note-text.ts) - and keeps its caret; and a note nobody has open
 *  takes them carried past the one span its file has changed by since, an edit
 *  that falls inside that span being the reader's writing and left alone. */
async function putWordsBack(ws: PutsBack, action: Extract<FileAction, { kind: 'replace' }>) {
  // Every closed note read before any is written. A read that fails - a file another
  // program rewrote in an encoding that is not UTF-8, or deleted - cannot say the
  // note is unchanged, and taking it for one wrote the old words over that file or
  // brought a deleted note back. So it leaves the whole replacement where it is, on
  // the stack, rather than half of it put back.
  const read = new Map<string, string>()
  for (const note of action.notes) {
    if (ws.documentAt(note.path)) continue
    const now = await invoke<string>('read_note', { path: note.path }).catch(() => null)
    if (now === null) throw new Error(`${note.path} will not read, so nothing is written over it`)
    read.set(note.path, now)
  }

  for (const note of action.notes) {
    const open = ws.documentAt(note.path)
    if (open) {
      open.flush()
      const edits = open.live.carried(note.edits, note.after, true) ?? note.edits
      const back = applied(open.text, edits)
      open.edited(edits, back)
      await writeFile(note.path, back)
      continue
    }

    const now = read.get(note.path) ?? note.after
    await writeFile(note.path, now === note.after ? note.content : carriedPast(note, now))
  }
}

/** The edits that take a replacement back, applied to a file that has changed since
 *  by one span: those before it as they were, those after it moved by what it grew
 *  or shrank by, and those it overlaps left out. */
function carriedPast(note: { after: string; edits: readonly Edit[] }, now: string): string {
  const since = oneEdit(note.after, now)
  if (!since) return applied(now, note.edits)

  const grew = since.insert.length - (since.to - since.from)
  const carried = note.edits.flatMap((one) => {
    if (one.to <= since.from) return [one]
    if (one.from >= since.to) return [{ ...one, from: one.from + grew, to: one.to + grew }]
    return []
  })

  return applied(now, carried)
}

/** Puts a rename or a move back: the file where it was, and the links that
 *  followed it pointed at the old name again. */
async function putName(ws: PutsBack, action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
  const kind = ws.entryAt(action.to)?.is_dir === true ? 'folder' : 'file'
  // A move back into another space takes its chats back first, as the move did, and
  // the account refusing keeps the step to be asked for again; see chat-leaving.ts.
  const back =
    action.kind === 'move'
      ? await (await import('./chat-leaving')).chatsCarried(action.to, folderOf(action.from))
      : null

  // A move like the one it undoes, so it waits for the writes of what is open in it
  // the same way; see `move` in workspace.svelte.ts.
  await ws.holdingUnder(action.to, async () => {
    await invoke('rename_note', { from: action.to, to: action.from }).catch(
      async (error: unknown) => {
        await back?.()
        throw error
      },
    )

    // The rename rewrote every link that pointed at the note; putting the name
    // back has to put those back too, which is the same rewrite the other way
    // round - and, again, before anything is told the note moved.
    if (action.rewrote) await ws.retarget(action.to, action.from, { moved: true })
    await ws.fileMoved(action.to, action.from, kind)
  })
  // A nesting made the folder; refused where something else is in it now.
  if (action.nests) {
    await invoke('remove_empty_folder', { path: folderOf(action.to) }).catch(() => undefined)
  }
}

/** Puts a merge back: both notes as they were, and the note that was folded
 *  in written again where it was.
 *
 *  Only while the note it went into still says what the merge left. The merge opens
 *  that note and the reader goes on typing in it, and writing its old words back over
 *  that took the typing with no version of it kept; so a note written in since leaves
 *  the merge where it is, on the stack, the way any undo something is in the way of
 *  does. And the folded note's name was free once it went: a note made there since,
 *  synced in or written by an agent, stays, and the old words step aside beside it as
 *  a deleted note's do when it comes back; see `writeBeside`. */
async function unmerge(ws: PutsBack, action: Extract<FileAction, { kind: 'merge' }>) {
  if (!(await stillSays(ws, action.into, action.intoAfter))) {
    throw new Error(`${action.into} has been written in since the merge`)
  }

  await writeFile(action.into, action.intoContent)
  const from = await freeBeside(action.from)
  await writeFile(from, action.fromContent)
  ws.reload(action.into, action.intoContent)

  // Links to the note that went away were pointed at the note it went into: put
  // back in the notes the merge rewrote, and only there, since a link that always
  // named the note it went into still means that note. The two notes themselves
  // were just written back whole. A merge recorded before this was kept has no
  // list, and is put back across the space as it used to be.
  //
  // They point at wherever the folded note landed, which is its old name unless
  // something has arrived there since.
  const only = action.relinked?.filter(
    (path) => !samePath(path, action.into) && !samePath(path, action.from),
  )
  if (!only || only.length) await ws.retarget(action.into, from, only ? { only } : {})
}

/** Puts a split or an extraction back: the note whole again, and the note that
 *  was carved out of it gone.
 *
 *  Guarded the way a merge is, and for the same reason. A note written in since the
 *  carve leaves the carve where it is rather than losing the typing under the words
 *  it had before. A carved note written in since stays: what was typed into it is in
 *  no other file, and the note whole again already holds everything it was carved
 *  with. */
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
