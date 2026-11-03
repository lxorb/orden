/** What one window does to the notes, heard by the others.
 *
 *  A note stays one document per window, as it does in two windows of VS Code. Between
 *  them what crosses is what happened: a write, as the words it replaced and the words it
 *  left, and a file operation, as `fileOps` said it. Without this, the second window's
 *  autosave overwrote the first's with no version, and a note deleted in one came back when
 *  the other typed.
 *
 *  **Writes are one line.** With another window here, a write holds the file's lock, reads
 *  what is there and, where that is not what this window last knew it to hold, three-way
 *  merges it in first (`merge3`, the sides in a fixed order so two windows reach the same
 *  words, and a meeting keeps both). So every write descends from every other, and hearing
 *  one is the same merge against the words it replaced. Words typed here are never what
 *  gets dropped, and neither are the other window's. A plane's words are JSON, which this
 *  merge would break: the last write stands and what it replaced is kept as a version.
 *
 *  **A file gone is gone.** One deleted elsewhere while words are unwritten here does not
 *  come back on the disk, and does not take those words with it: the tab stays, as a draft.
 *
 *  Fetched at the launch's `rooms` turn. A window alone pays one branch per write. */

import { fold } from '@orden/rooms/fold'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { samePath, within } from '../space-paths'
import { invoke } from '../tauri'
import { afterQuiet } from '../timing'
import { oneWriteAt, type Windows, windows as theWindows } from '../windows'
import type { NoteDoc } from './documents.svelte'
import type { FileOp } from './file-ops'

/** A note's document as the sync engine holds it, joined to its views in this window: what
 *  it takes goes through the document, which brings it to the views itself. */
export interface Joined {
  text(): string
  put(to: string): void
}

/** What this needs of the app. A test gives it a small one. */
export interface Desk {
  readonly documents: readonly NoteDoc[]
  tell(op: FileOp): Promise<unknown>
  follow(follower: (op: FileOp) => unknown): void
  loadTree(): Promise<unknown>
  loadSpaces(): Promise<unknown>
  /** The note's words are owed to its file. */
  owed(note: NoteDoc): void
  /** A note whose file has gone, with words on no disk: a draft from here on. */
  draftOf(note: NoteDoc): void
  /** The engine's document for a note joined to one, in the window that runs the engine. */
  joined(note: NoteDoc): Joined | null
  noteSaved(path: string, text: string): void
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  keepVersion(path: string, text: string): Promise<unknown>
}

/** The editor's line endings, whatever a file has. */
const unixLines = (text: string) => text.replace(/\r\n?/g, '\n')

/** A merge whose answer does not hang on which window is asking. */
async function together(base: string, one: string, other: string): Promise<string> {
  if (one === other) return one
  const { merge3 } = await import('@orden/sync-core/merge3')
  const [local, remote] = one < other ? [one, other] : [other, one]
  return merge3(base, local, remote).text
}

/** How many such meetings a note remembers: one per write of another window's still in
 *  the air, which is never many. */
const MET_KEPT = 8

/** Whether a kind's words merge as text. */
const asText = (note: NoteDoc) => note.kind === 'note'

export class Across {
  /** One thing heard at a time, in the order said: a note moved and then written. */
  private hearing: Promise<unknown> = Promise.resolve()

  /** The list read again for what another window did, which says nothing back. */
  private listing = false
  private readonly listAgain = afterQuiet(() => {
    this.listing = true
    void this.desk.loadTree().finally(() => (this.listing = false))
  }, 100)

  /** This window read its list again, after a file it made, or after anything else:
   *  plenty of what makes a file says nothing but that, and the list here is the one that
   *  knows. The others read theirs. */
  listed() {
    if (!this.listing && !this.alone) this.windows.say('list-again')
  }

  constructor(
    private readonly desk: Desk,
    private readonly windows: Windows = theWindows,
  ) {
    desk.follow((op) => {
      if (op.heard) return
      // A document's key means nothing in another window.
      windows.say('file-op', { op: { ...op, key: undefined } })
    })
    windows.hear('list-again', () => this.listAgain())
    windows.hear('file-op', ({ op }) => this.inTurn(() => this.heardOp(op as FileOp)))
    windows.hear('words', ({ path, base, text }) =>
      this.inTurn(() => this.heardWords(String(path), String(base), String(text))),
    )
  }

  /** Whether any other window is open. */
  get alone(): boolean {
    return this.windows.alone
  }

  private inTurn(run: () => Promise<void>) {
    this.hearing = this.hearing.then(run).catch((error: unknown) => {
      log('error', `across: ${String(error)}`)
    })
  }

  /** Writes a note's words with another window here, as above. Answers the words that went
   *  down, or null where the file has gone and so nothing did. */
  writing(
    note: NoteDoc,
    path: string,
    content: string,
    write: (words: string) => Promise<unknown>,
  ): Promise<string | null> {
    return oneWriteAt(path, async () => {
      const was = await this.desk.read(path)
      if (was === null && note.onDisk !== null && !(await this.desk.exists(path))) {
        this.desk.draftOf(note)
        return null
      }
      const disk = was === null ? null : unixLines(was)
      let words = content
      if (disk !== null && disk !== note.onDisk) {
        if (note.onDisk !== null && asText(note)) {
          words = await together(note.onDisk, content, disk)
          this.brought(note, content, words)
          this.metOnDisk(note, disk)
        } else {
          // Nothing to merge against, or nothing that merges: what is there is kept.
          await this.desk.keepVersion(path, was ?? '').catch(() => undefined)
        }
      }
      await write(words)
      note.onDisk = words
      this.windows.say('words', { path, base: disk ?? '', text: words })
      return words
    })
  }

  /** Words a write met on the disk, whose news is still on its way: heard then, they are
   *  already here, and merged a second time they would be here twice. */
  private readonly met = new WeakMap<NoteDoc, string[]>()

  private metOnDisk(note: NoteDoc, disk: string) {
    this.met.set(note, [...(this.met.get(note) ?? []), disk].slice(-MET_KEPT))
  }

  /** Waits for what has been heard so far. */
  heardSoFar(): Promise<unknown> {
    return this.hearing
  }

  /** Words a merge left, put into the note. */
  private brought(note: NoteDoc, from: string, to: string) {
    if (from === to) return
    const joined = this.desk.joined(note)
    if (joined) joined.put(to)
    else note.took(fold(from, to), to)
  }

  private async heardWords(path: string, base: string, text: string) {
    this.desk.noteSaved(path, text)
    const note = this.desk.documents.find((one) => samePath(one.path, path))
    if (!note) return
    if (note.onDisk === base || note.onDisk === null) note.onDisk = text

    if (!asText(note)) {
      if (!note.dirty) note.replace(text, false)
      else if (text !== note.latest) await this.desk.keepVersion(path, text)
      return
    }
    const met = this.met.get(note)
    if (met?.includes(text)) {
      this.met.set(
        note,
        met.filter((one) => one !== text),
      )
      return
    }
    const joined = this.desk.joined(note)
    const mine = joined ? joined.text() : note.latest
    const words = await together(base, mine, text)
    if (words === mine) {
      if (words === text && !joined) note.dirty = false
      return
    }
    this.brought(note, mine, words)
    if (words === text) {
      note.dirty = false
      return
    }
    note.dirty = true
    this.desk.owed(note)
  }

  private async heardOp(op: FileOp) {
    if (op.op === 'removed') {
      // Unwritten words under what went are this window's only copy of them.
      for (const note of this.desk.documents) {
        if (note.path !== null && note.dirty && within(op.path, note.path) !== null) {
          this.desk.draftOf(note)
        }
      }
    }
    await this.desk.tell({ ...op, heard: true })
    if (op.op !== 'created' && op.kind === 'space') await this.desk.loadSpaces()
    this.listAgain()
  }
}

/** The app's desk. */
export async function startAcross(): Promise<Across> {
  const { workspace } = await import('../workspace.svelte')
  const { links } = await import('../link-index.svelte')
  const { sync } = await import('../sync.svelte')
  const across = new Across({
    get documents() {
      return workspace.documents
    },
    tell: (op) => workspace.fileOps.tell(op),
    follow: (follower) => void workspace.fileOps.follow(follower),
    loadTree: () => workspace.loadTree(),
    loadSpaces: () => workspace.loadSpaces(),
    owed: (note) => workspace.owedWords(note),
    draftOf: (note) => {
      note.home = workspace.spaceOf(note)
      note.path = null
      note.onDisk = null
      note.dirty = true
      workspace.scheduleSession()
    },
    joined: (note) => sync.engine?.joinedOf(note) ?? null,
    noteSaved: (path, text) => links.noteSaved(path, text),
    read: (path) => invoke<string>('read_note', { path }).catch(() => null),
    exists: (path) => onDisk(path),
    keepVersion: (path, text) => invoke('snapshot_note', { path, content: text }),
  })
  workspace.meetOthers(across)
  return across
}
