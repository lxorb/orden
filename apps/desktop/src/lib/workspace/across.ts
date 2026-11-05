import { fold } from '@orden/rooms/fold'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { samePath, within } from '../space-paths'
import { invoke } from '../tauri'
import { afterQuiet, waited } from '../timing'
import { oneWriteAt, type Windows, windows as theWindows } from '../windows'
import { type NoteDoc, unixLines } from './documents.svelte'
import type { FileOp } from './file-ops'

export interface Joined {
  text(): string
  put(to: string): void
}

export interface Desk {
  readonly documents: readonly NoteDoc[]
  tell(op: FileOp): Promise<unknown>
  follow(follower: (op: FileOp) => unknown): void
  loadTree(): Promise<unknown>
  loadSpaces(): Promise<unknown>
  owed(note: NoteDoc): void
  draftOf(note: NoteDoc): void
  joined(note: NoteDoc): Joined | null
  noteSaved(path: string, text: string): void
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  reachable(path: string): Promise<boolean>
  keepVersion(path: string, text: string): Promise<unknown>
  pause(): Promise<unknown>
}

export interface Written {
  words: string
  revision: number
}

const GONE = Symbol('gone')

const RENAME_NEWS = 500

const asText = (note: NoteDoc) => note.kind === 'note'

const isDirty = (note: NoteDoc) => note.dirty

const holdingBack = (note: NoteDoc) => note.live.holdingBack

export class Across {
  private hearing: Promise<unknown> = Promise.resolve()

  private listing = false
  private readonly listAgain = afterQuiet(() => {
    this.listing = true
    void this.desk.loadTree().finally(() => (this.listing = false))
  }, 100)

  listed() {
    if (!this.listing && !this.alone) this.windows.say('list-again')
  }

  constructor(
    private readonly desk: Desk,
    private readonly windows: Windows = theWindows,
  ) {
    desk.follow((op) => {
      if (op.heard) return
      windows.say('file-op', { op: { ...op, key: undefined } })
    })
    windows.hear('list-again', () => this.listAgain())
    windows.hear('spaces-again', () => this.inTurn(() => this.spacesAgain()))
    windows.hear('file-op', ({ op }) => this.inTurn(() => this.heardOp(op as FileOp)))
    windows.hear('words', ({ path, text }) =>
      this.inTurn(() => this.heardWords(String(path), String(text))),
    )
  }

  get alone(): boolean {
    return this.windows.alone
  }

  private inTurn(run: () => Promise<void>) {
    this.hearing = this.hearing.then(run).catch((error: unknown) => {
      log('error', `across: ${String(error)}`)
    })
  }

  owe(note: NoteDoc) {
    this.desk.owed(note)
  }

  heardSoFar(): Promise<unknown> {
    return this.hearing
  }

  async writing(
    note: NoteDoc,
    path: string,
    write: (words: string) => Promise<unknown>,
  ): Promise<Written | null> {
    const first = await oneWriteAt(path, () => this.attempt(note, path, write))
    if (first !== GONE) return first
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
    if (!samePath(note.path, path)) {
      if (note.path !== null) this.desk.owed(note)
      return null
    }
    if (holdingBack(note)) {
      this.desk.owed(note)
      return null
    }
    const words = note.latest
    const revision = note.revision
    await write(words)
    note.onDisk = words
    this.windows.say('words', { path, text: words })
    return { words, revision }
  }

  private async onTheDisk(path: string): Promise<string | null> {
    const read = await this.desk.read(path)
    if (read !== null) return unixLines(read)
    if (await this.desk.exists(path)) {
      throw Object.assign(new Error(`${path} would not read`), { name: 'WillNotRead' })
    }
    return null
  }

  private async takeIn(note: NoteDoc, path: string, disk: string) {
    const base = note.onDisk
    if (base === null || !asText(note)) {
      const stood = await this.desk.read(path)
      const kept = stood !== null && unixLines(stood) === disk ? stood : disk
      await this.desk.keepVersion(path, kept).catch(() => undefined)
      note.onDisk = disk
      return
    }
    const { mergedOn } = await import('@orden/sync-core/merge3')
    const joined = this.desk.joined(note)
    const mine = unixLines(joined ? joined.text() : note.latest)
    const words = mine === base ? disk : mergedOn(base, mine, disk)
    if (words !== mine) {
      if (joined) joined.put(words)
      else this.into(note, mine, words)
    }
    note.onDisk = disk
  }

  private into(note: NoteDoc, mine: string, words: string) {
    try {
      note.took(fold(mine, words), words)
    } catch (error) {
      log('error', `across: ${note.path ?? 'a draft'} took the whole words - ${String(error)}`)
      note.tookWhole(words)
    }
  }

  private async heardWords(path: string, text: string) {
    this.desk.noteSaved(path, text)
    const note = this.desk.documents.find((one) => samePath(one.path, path))
    if (!note) return
    await oneWriteAt(path, async () => {
      if (!samePath(note.path, path)) return
      if (note.live.holdingBack) {
        note.dirty = true
        this.desk.owed(note)
        return
      }
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
        if (isDirty(note)) this.desk.owed(note)
        throw error
      }
      if (note.latest === disk && !holdingBack(note)) {
        note.dirty = false
        return
      }
      note.dirty = true
      this.desk.owed(note)
    })
  }

  private async spacesAgain() {
    await this.desk.loadSpaces()
  }

  private async heardOp(op: FileOp) {
    if (op.op === 'removed') {
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

export async function startAcross(): Promise<Across> {
  const { workspace } = await import('../workspace.svelte')
  const { links } = await import('../link-index.svelte')
  const { sync } = await import('../sync.svelte')
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
