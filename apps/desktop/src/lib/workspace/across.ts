/** What one window does to the notes, heard by the others.
 *
 *  A note stays one document per window, as it does in two windows of VS Code. Without
 *  this, the second window's autosave overwrote the first's with no version, and a note
 *  deleted in one came back when the other typed.
 *
 *  **The disk is the one line of history.** Each document knows the version of its file it
 *  has taken in (`onDisk`). With another window here, whoever writes holds the file's lock,
 *  reads the file, takes in what is new against that version (`merge3`, a meeting keeps both),
 *  and only then reads the note's words and writes them. So every version on the disk
 *  descends from every one before it. What crosses the channel is only that the file has a
 *  new version: a window hearing so does the same under the same lock, whatever order the
 *  news comes in and however late, and news of something already taken in finds nothing new.
 *  Nothing is ever merged twice, because nothing is merged but what lies between the version
 *  a window holds and the one on the disk. A plane's words are JSON, which this merge would
 *  break: the last write stands and what it replaced is kept as a version.
 *
 *  **A file that will not read is not an empty file**: the write is refused and tried again.
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
import { afterQuiet, waited } from '../timing'
import { oneWriteAt, type Windows, windows as theWindows } from '../windows'
import { type NoteDoc, unixLines } from './documents.svelte'
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
  /** Whether the folder a path's space is in answers at all: a share gone offline has no
   *  file at any path, and that says nothing about the file. */
  reachable(path: string): Promise<boolean>
  keepVersion(path: string, text: string): Promise<unknown>
  /** A moment, for news on its way. */
  pause(): Promise<unknown>
}

/** A write that went down: the words, and the note's revision at them. */
export interface Written {
  words: string
  revision: number
}

/** The file is not there, and the note knows it was. */
const GONE = Symbol('gone')

/** How long a file not there is given to turn out to be a rename. */
const RENAME_NEWS = 500

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
    windows.hear('words', ({ path, text }) =>
      this.inTurn(() => this.heardWords(String(path), String(text))),
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

  /** Waits for what has been heard so far. */
  heardSoFar(): Promise<unknown> {
    return this.hearing
  }

  /** Writes a note's words with another window here, as above. Answers the words that went
   *  down and the note's revision at those words, or null where nothing did: the file has
   *  gone, or the note moved on, in which case it is owed again where it is now. */
  async writing(
    note: NoteDoc,
    path: string,
    write: (words: string) => Promise<unknown>,
  ): Promise<Written | null> {
    const first = await oneWriteAt(path, () => this.attempt(note, path, write))
    if (first !== GONE) return first
    // Not there may be a rename whose news is on its way: a moment, and then it is known.
    await this.desk.pause()
    await this.hearing
    if (!samePath(note.path, path)) {
      if (note.path !== null) this.desk.owed(note)
      return null
    }
    const second = await oneWriteAt(path, () => this.attempt(note, path, write))
    if (second !== GONE) return second
    this.desk.draftOf(note)
    return null
  }

  private async attempt(
    note: NoteDoc,
    path: string,
    write: (words: string) => Promise<unknown>,
  ): Promise<Written | typeof GONE | null> {
    if (!samePath(note.path, path)) {
      if (note.path !== null) this.desk.owed(note)
      return null
    }
    // Words a composition is holding back are in nothing yet that could be written, and
    // nothing can be merged with what stands for words that have not arrived.
    if (note.live.holdingBack) {
      this.desk.owed(note)
      return null
    }
    const disk = await this.onTheDisk(path)
    if (disk === null && note.onDisk !== null) {
      if (await this.desk.reachable(path)) return GONE
      throw new Error(`${path} is out of reach`)
    }
    if (disk !== null && disk !== note.onDisk) await this.takeIn(note, path, disk)
    // The read was a round trip: a rename heard in it moved the note, and these words go
    // where it is now.
    if (!samePath(note.path, path)) {
      if (note.path !== null) this.desk.owed(note)
      return null
    }
    if (note.live.holdingBack) {
      this.desk.owed(note)
      return null
    }
    // Read here, inside the turn and after all of that: not when the write was asked for.
    const words = note.latest
    const revision = note.revision
    await write(words)
    note.onDisk = words
    this.windows.say('words', { path, text: words })
    return { words, revision }
  }

  /** The file's words in the editor's line endings; null for a file that is not there. One
   *  that is there and will not read is refused, whatever is asking. */
  private async onTheDisk(path: string): Promise<string | null> {
    const read = await this.desk.read(path)
    if (read !== null) return unixLines(read)
    if (await this.desk.exists(path)) throw new Error(`${path} would not read`)
    return null
  }

  /** What lies between the version this note holds and `disk`, taken in. */
  private async takeIn(note: NoteDoc, path: string, disk: string) {
    const base = note.onDisk
    if (base === null || !asText(note)) {
      // Nothing to merge against, or nothing that merges: what is there is kept.
      await this.desk.keepVersion(path, disk).catch(() => undefined)
      note.onDisk = disk
      return
    }
    const { merge3 } = await import('@orden/sync-core/merge3')
    // From here to the note holding it nothing waits, so no key can land in between.
    const joined = this.desk.joined(note)
    const mine = unixLines(joined ? joined.text() : note.latest)
    const words = mine === base ? disk : merge3(base, mine, disk).text
    if (words !== mine) {
      if (joined) joined.put(words)
      else this.into(note, mine, words)
    }
    note.onDisk = disk
  }

  /** Words brought into a note, as the one span they changed by. One the rope will not take
   *  is words and a rope that have come apart, which nothing here can see the cause of: the
   *  rope is told the whole words instead, since those hold everything the reader has and
   *  every window's write. Better the carets than the note. */
  private into(note: NoteDoc, mine: string, words: string) {
    try {
      note.took(fold(mine, words), words)
    } catch (error) {
      log('error', `across: ${note.path ?? note.name} took the whole words - ${String(error)}`)
      const { dirty, onDisk } = note
      note.replace(words, false)
      note.dirty = dirty
      note.onDisk = onDisk
    }
  }

  /** Another window, or the engine, wrote this file. */
  private async heardWords(path: string, text: string) {
    this.desk.noteSaved(path, text)
    const note = this.desk.documents.find((one) => samePath(one.path, path))
    if (!note) return
    await oneWriteAt(path, async () => {
      if (!samePath(note.path, path)) return
      // Taken in once the composition is over, by the write this asks for.
      if (note.live.holdingBack) {
        note.dirty = true
        this.desk.owed(note)
        return
      }
      // Gone is the file operation's to say, and unreadable is the next word's or write's.
      const disk = await this.onTheDisk(path).catch(() => null)
      if (disk === null || disk === note.onDisk) return
      if (!note.dirty && note.onDisk === null) {
        note.replace(disk, false)
        return
      }
      if (!asText(note) && !note.dirty) {
        note.replace(disk, false)
        return
      }
      try {
        await this.takeIn(note, path, disk)
      } catch (error) {
        // Words of its own that were waiting on this: their write says what is wrong.
        if (note.dirty) this.desk.owed(note)
        throw error
      }
      if (note.latest === disk && !note.live.holdingBack) {
        note.dirty = false
        return
      }
      note.dirty = true
      this.desk.owed(note)
    })
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
  // Signed out in one window is signed out: they share the session, and the store under it.
  const { account } = await import('../account.svelte')
  let told = false
  account.forgetWithSession(() => {
    if (!told) theWindows.say('signed-out')
  })
  theWindows.hear('signed-out', () => {
    told = true
    void account.signOut().finally(() => (told = false))
  })
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
    reachable: (path) => {
      const root = workspace.rootHolding(path)
      return root === null ? Promise.resolve(true) : onDisk(root)
    },
    keepVersion: (path, text) => invoke('snapshot_note', { path, content: text }),
    pause: () => waited(RENAME_NEWS),
  })
  workspace.meetOthers(across)
  return across
}
