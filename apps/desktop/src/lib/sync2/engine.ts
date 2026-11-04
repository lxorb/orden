/** Sync v2's engine: every note, canvas and page note a document this device keeps, the
 *  files their projection, the tree as operations, and the one question asked only when
 *  two sides really wrote two things in one place (docs/sync-v2.md sections 5 and 9).
 *
 *  This is the engine's face: what the app and the simulator both call. The world it
 *  runs in is handed in (world.ts), so the engine the simulator's seeds judge is the one
 *  the window runs. What is behind it, one responsibility a file:
 *
 *  - core.ts - what is held, in memory and in the store, and the one way it is written;
 *  - docs.ts - one document, confirmed and pending;
 *  - places.ts - the tree as shown, and where each entry is on this disk;
 *  - pass.ts - one pass over one space;
 *  - rejoin.ts - pending edits meeting the account's;
 *  - held.ts - the held notes and the three answers;
 *  - project.ts, ingest.ts - the file as the document's projection, and edits made to it
 *    by other programs;
 *  - create.ts - this device's own tree operations;
 *  - migrate.ts - the first v2 pass of a space that v1 kept, and the way back. */

import { foreignCopy, inForeignCopy } from '@orden/sync-core/foreign'
import { repositioned } from '@orden/sync-core/order'
import type { TreeEntry } from '@orden/sync-core/tree'
import type { EngineEvents, Engine as AskedEngine } from './asking.svelte'
import { Core } from './core'
import {
  atOrUnder,
  carried,
  intended,
  made,
  mergeableAfter,
  moved,
  placed as placedRows,
  removed,
  restored,
  unsynced,
} from './create'
import type { Doc } from './docs'
import { HeldList, type Names } from './held'
import { holdsDocument } from './kinds'
import { holderOf } from '../pages/held'
import { waitsForBytes } from './files'
import { foldIn } from './ingest'
import { settle, type SpaceState, windowsPath } from './places'
import { pass, type Passed, resting } from './pass'
import { project, wrote } from './project'
import { keepLosers, rejoin } from './rejoin'
import { againstBytes } from './records'
import { put, type Change, type EntryRow, type LogRow, type SyncStore } from './store'
import type { World } from './world'

type Listeners = { [T in keyof EngineEvents]: Set<(event: EngineEvents[T]) => void> }

export interface Starting {
  /** Device names by id, for the other side of a held note. */
  names?: Names
  /** Whether an answer asks the account for its newest words first. The simulator's
   *  person answers between requests, and says no. */
  freshens?: boolean
}

/** Where a path is: which space, and where in it. */
export interface Placed {
  space: SpaceState
  path: string
}

export class Engine implements AskedEngine {
  readonly held: HeldList
  private readonly listeners: Listeners = {
    resurrected: new Set(),
    pass: new Set(),
    unsynced: new Set(),
    file: new Set(),
  }

  private constructor(
    readonly core: Core,
    names: Names,
  ) {
    this.held = new HeldList(core, names)
    core.events.resurrected = (event) => this.emit('resurrected', event)
    core.events.unsynced = (event) => this.emit('unsynced', event)
    core.events.file = (event) => this.emit('file', event)
    core.events.held = () => {
      void this.held.refresh()
      for (const [id, told] of [...this.unheld]) {
        if (core.isHeld(id)) continue
        this.unheld.delete(id)
        for (const one of told) one()
      }
    }
  }

  /** Who is waiting for a held note to be let go of, by id; see `whenLetGo`. */
  private readonly unheld = new Map<string, Set<() => void>>()

  /** Tells `then` once the note is no longer held: its question answered, whichever
   *  way. Answers how to stop waiting. An open note waits so before it is joined to its
   *  document again; see binding.ts. */
  whenLetGo(id: string, then: () => void): () => void {
    const told = this.unheld.get(id) ?? new Set()
    told.add(then)
    this.unheld.set(id, told)
    return () => {
      told.delete(then)
      if (!told.size) this.unheld.delete(id)
    }
  }

  static async start(world: World, store: SyncStore, how: Starting = {}): Promise<Engine> {
    const core = await Core.open(world, store)
    const engine = new Engine(core, how.names ?? ((device) => Promise.resolve(device ?? '')))
    engine.held.freshens = how.freshens ?? true
    await engine.held.refresh()
    return engine
  }

  get store(): Pick<SyncStore, 'read'> {
    return this.core.store
  }

  on<T extends keyof EngineEvents>(
    type: T,
    listener: (event: EngineEvents[T]) => void,
  ): () => void {
    const listening: Set<(event: EngineEvents[T]) => void> = this.listeners[type]
    listening.add(listener)
    return () => listening.delete(listener)
  }

  private emit<T extends keyof EngineEvents>(type: T, event: EngineEvents[T]) {
    const listening: Set<(event: EngineEvents[T]) => void> = this.listeners[type]
    for (const listener of [...listening]) listener(event)
  }

  // -------------------------------------------------------------------------
  // Passes

  /** A line in the log about one space from beside its passes, where a page's paper not
   *  taken is said (pages/carried.ts), and told to whoever has the log open. */
  async said(spaceId: string, failed: string): Promise<void> {
    const at = this.core.world.now()
    const row: LogRow = { at, space: spaceId, pulled: null, pushed: null, failed }
    await this.core.commit([put('log', row)]).catch(() => undefined)
    this.emit('pass', row)
  }

  /** One pass over one space. Written in the log when it moved anything or failed. */
  async pass(spaceId: string): Promise<Passed | null> {
    const space = this.core.spaces.get(spaceId)
    if (!space) return null
    const began = this.core.world.now()
    let passed: Passed | null = null
    let failed: string | null = null
    try {
      passed = await this.core.use(() => pass(this.core, space))
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      if (failed !== null || (passed && (passed.pulled || passed.pushed))) {
        const row: LogRow = {
          at: began,
          space: space.id,
          pulled: passed?.pulled ?? 0,
          pushed: passed?.pushed ?? 0,
          failed,
        }
        await this.core.commit([put('log', row)]).catch(() => undefined)
        this.emit('pass', row)
      }
      if (this.core.held.size || this.held.notes.length) await this.held.refresh()
    }
    return passed
  }

  /** Whether anything is waiting to go up in a space: what asks for another pass. */
  waiting(spaceId: string): boolean {
    const space = this.core.spaces.get(spaceId)
    if (!space) return false
    // A file waiting for room for its bytes is tried again in a while, not soon.
    if (space.outbox.some((one) => !waitsForBytes(this.core, space, one))) return true
    for (const entry of space.entries.values()) {
      if (
        this.core.hasPending(entry.id) &&
        !this.core.isHeld(entry.id) &&
        !resting(this.core, entry.id)
      )
        return true
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Paths

  /** The space a path on this disk is in, and where in it, with `/` between folders. */
  placed(path: string): Placed | null {
    // The folder spelled like the path first; another spelling only on a disk where it
    // is the same folder. On Linux `Notes` and `notes` are two spaces.
    const spaces = [...this.core.spaces.values()]
    for (const foldsCase of this.core.world.foldsCase ? [false, true] : [false]) {
      for (const space of spaces) {
        const inside = relative(space.row.root, path, foldsCase)
        if (inside !== null) return { space, path: inside }
      }
    }
    return null
  }

  /** The entry a file on this disk is. None for another sync tool's copy, even one the
   *  account has from before Orden knew better: nothing heard about one is sent, and no
   *  tab holding one joins a room (@orden/sync-core/foreign). */
  entryAt(path: string) {
    const placed = this.placed(path)
    if (!placed || inForeignCopy(placed.path)) return null
    return placed.space.at(placed.path)
  }

  /** Another sync tool's copies the account holds, a folder once for everything in it:
   *  what the Sync pane offers to take off. */
  foreignCopies(): { space: SpaceState; entry: EntryRow }[] {
    const found: { space: SpaceState; entry: EntryRow }[] = []
    for (const space of this.core.spaces.values()) {
      for (const entry of space.entries.values()) {
        if (entry.seq === null || !space.isLive(entry.id)) continue
        if (!foreignCopy(entry.name) || (entry.parent && space.foreign(entry.parent))) continue
        found.push({ space, entry })
      }
    }
    return found
  }

  /** Takes every one of them off the account, into its Recently deleted; the files stay.
   *  Answers how many went, which the next pass sends. */
  unsync(): Promise<number> {
    return this.core.use(async () => {
      const copies = this.foreignCopies()
      const changes = copies.flatMap(({ space, entry }) => unsynced(this.core, space, entry))
      await this.core.commit(changes)
      return copies.length
    })
  }

  /** The space a folder on this disk is in, or is the top of, and where in it. */
  private folderPlaced(folder: string): Placed | null {
    for (const foldsCase of this.core.world.foldsCase ? [false, true] : [false]) {
      for (const space of this.core.spaces.values()) {
        if (sameFolder(space.row.root, folder, foldsCase)) return { space, path: '' }
      }
    }
    return this.placed(folder)
  }

  /** The names of a folder's rows somebody put somewhere, in the order their places put
   *  them: what the file list draws a hand-arranged folder by (#1068). Null where the
   *  space's account keeps no places, or nobody put a row of this folder anywhere; the
   *  file list then reads the order it kept before places. */
  placedIn(folder: string): string[] | null {
    const placed = this.folderPlaced(folder)
    if (!placed?.space.ordering.on) return null
    return placed.space.placedNames().get(placed.space.key(placed.path))?.names ?? null
  }

  /** Every folder of the space at `root` with rows somebody put somewhere, by its path in
   *  the space, and their names in order. Empty where the account keeps no places. */
  placedFolders(root: string): Map<string, string[]> {
    const placed = this.folderPlaced(root)
    const out = new Map<string, string[]>()
    if (!placed?.space.ordering.on || placed.path) return out
    for (const { folder, names } of placed.space.placedNames().values()) out.set(folder, names)
    return out
  }

  /** Whether the space a folder is in keeps places, and has the folder in its tree. */
  keepsPlaces(folder: string): boolean {
    const placed = this.folderPlaced(folder)
    return !!placed?.space.ordering.on && placed.space.folderAt(placed.path) !== undefined
  }

  /** A folder's rows drawn in this order from now on: `order` its rows' names as they
   *  are to be drawn, the first `count` of them put there by hand. Each row whose place
   *  has to change for it is given a new one, as few as can be (`repositioned` in
   *  @orden/sync-core/order), and goes up as a `place`. Answers false, sending nothing,
   *  where the account keeps no places or the folder is not in its tree. */
  arrange(folder: string, order: readonly string[], count: number): Promise<boolean> {
    return this.core.use(async () => {
      const placed = this.folderPlaced(folder)
      if (!placed?.space.ordering.on) return false
      const { space } = placed
      const children = space.childrenAt(placed.path)
      if (!children) return false
      const rows: TreeEntry[] = []
      let standing = 0
      for (const [at, name] of order.entries()) {
        const entry = children.get(name)
        if (!entry || rows.includes(entry)) continue
        rows.push(entry)
        if (at < count) standing = rows.length
      }
      await this.core.commit(placedRows(this.core, space, repositioned(rows, standing)))
      return true
    })
  }

  // -------------------------------------------------------------------------
  // This device's own changes

  /** A file or folder that came to be here: a new tab given its place, a file made in
   *  the list, one another program made. Answers its id. */
  created(
    path: string,
    folder: boolean,
    text?: string,
    mergeable?: string,
  ): Promise<string | null> {
    return this.core.use(() => this.make(path, folder, text, mergeable))
  }

  private async make(
    path: string,
    folder: boolean,
    text?: string,
    mergeable?: string,
  ): Promise<string | null> {
    const placed = this.placed(path)
    if (!placed) return null
    const there = placed.space.at(placed.path)
    if (there) {
      // Heard first from the folder's watcher, before the file list said it made it: the
      // same entry, which takes what only the file list knows - a day's note made to be
      // folded into one another device made (#1068).
      if (mergeable !== undefined)
        await this.core.commit(mergeableAfter(placed.space, there, mergeable))
      return null
    }
    if (!folder && (await this.heldPaper(path))) return null
    const { id, changes } = await made(this.core, placed.space, {
      path: placed.path,
      folder,
      ...(text === undefined ? {} : { text }),
      ...(mergeable === undefined ? {} : { mergeable }),
    })
    await this.core.commit(changes)
    await this.settle(placed.space)
    return id
  }

  /** A file or folder that moved here. */
  moved(from: string, to: string): Promise<void> {
    return this.core.use(() => this.move(from, to))
  }

  private async move(from: string, to: string): Promise<void> {
    const was = this.placed(from)
    const now = this.placed(to)
    if (!was || !now) return
    // A PDF that became the paper of a page note is part of the note now, and leaves the
    // tree: it travels with the note, by the note's id (pages/carried.ts).
    if (await this.heldPaper(to)) {
      await this.remove(from)
      return
    }
    if (was.space !== now.space) {
      // Out of one space and into another: gone from the one, made in the other - and a
      // folder with everything in it, since the other space's tree has never heard of
      // any of it. Only the folder used to be made, and another device found it empty
      // (#413). Each made as the kind it was, read before the removal lets them go, so
      // a PDF is not taken for a folder because it does not read as words.
      const inside = atOrUnder(was.space, was.path)
        .map((entry) => ({ kind: entry.kind, rest: entry.local_path.slice(was.path.length) }))
        .sort((a, b) => a.rest.split('/').length - b.rest.split('/').length)
      await this.remove(from)
      // One this tree never knew - made a moment ago - is what is on the disk.
      if (!inside.length) {
        const text = await this.core.world.disk.read(to)
        await this.make(to, text === null, text ?? undefined)
      }
      for (const one of inside) {
        const path = this.core.world.join(now.space.row.root, `${now.path}${one.rest}`)
        if (one.kind === 'folder') await this.make(path, true)
        else if (!holdsDocument(one.kind)) await this.make(path, false)
        else await this.make(path, false, (await this.core.world.disk.read(path)) ?? '')
      }
      return
    }
    await this.core.commit(moved(this.core, was.space, was.path, now.path))
    await this.settle(was.space)
  }

  /** A move or a rename the file list, an agent or an undo makes (#1068): said to the
   *  engine by the id of what is at `from` before the file moves, shown at once and on
   *  its way to the account, with the entry and everything in it held while `run`
   *  moves the file, so neither a pass nor the folder's watcher reads the disk halfway.
   *  Where the file is is written down once `run` is done. A move `run` could not make
   *  goes back where it was, said the same way. Anything the engine does not keep by an
   *  id - another space, a page note's paper - is moved by `run` alone and said after
   *  it, as before. */
  async moving(from: string, to: string, run: () => Promise<void>): Promise<void> {
    const was = this.placed(from)
    const now = this.placed(to)
    const entry = was?.space.at(was.path)
    if (
      !was ||
      !now ||
      !entry ||
      was.space !== now.space ||
      inForeignCopy(now.path) ||
      (await this.heldPaper(to))
    ) {
      await run()
      return
    }
    const { space } = was
    const release = this.handle(atOrUnder(space, was.path), [from, to])
    const name = space.shown().entries.get(entry.id)?.name
    try {
      await this.core.use(() => this.core.commit(intended(this.core, space, entry, now.path)))
      try {
        await run()
      } catch (error) {
        await this.core.use(() =>
          this.core.commit(intended(this.core, space, entry, was.path, name)),
        )
        throw error
      }
      await this.core.use(() => this.core.commit(carried(space, was.path, now.path)))
    } finally {
      release()
    }
    await this.core.use(() => this.settle(space))
  }

  /** A delete the file list, an agent or an undo makes: what is at `path` held while
   *  `run` takes the file away, and then said to the engine at once, with the word it
   *  can be put back by - which `run` may answer, the trash's id for it. */
  async removing(path: string, run: () => Promise<unknown>): Promise<void> {
    const placed = this.placed(path)
    const release = this.handle(placed ? atOrUnder(placed.space, placed.path) : [], [path])
    try {
      const back = await run()
      await this.core.use(() => this.remove(path, typeof back === 'string' ? back : undefined))
    } finally {
      release()
    }
  }

  /** Entries and paths in hand until the answer is called; see `inHand` in core.ts. */
  private handle(entries: readonly EntryRow[], paths: readonly string[]): () => void {
    const { inHand, handPaths } = this.core
    for (const entry of entries) inHand.set(entry.id, (inHand.get(entry.id) ?? 0) + 1)
    const held = paths.map((one) => this.normed(one))
    handPaths.push(...held)
    return () => {
      for (const entry of entries) {
        const left = (inHand.get(entry.id) ?? 1) - 1
        if (left) inHand.set(entry.id, left)
        else inHand.delete(entry.id)
      }
      for (const one of held) {
        const at = handPaths.indexOf(one)
        if (at >= 0) handPaths.splice(at, 1)
      }
    }
  }

  /** A path as `relative` reads it, by the disk of the space it is in. */
  private normed(path: string): string {
    return norm(this.placed(path)?.space.row.root ?? path, path)
  }

  /** Whether what is at a path on this disk, or comes or goes there, is the engine's
   *  own doing still under way, which the folder's watcher has nothing to read in
   *  (#1068): a path the app is moving or deleting a file at this moment (`moving`),
   *  or one where an entry's file is and the tree shows it elsewhere or nowhere, or
   *  where the tree shows an entry whose file is not there yet - a pass between the
   *  one and the other. Read off the tree and the disk as they are, never off how long
   *  ago anything happened. */
  ownWork(path: string): boolean {
    const at = this.normed(path)
    const folded = (one: string) => (this.core.world.foldsCase ? one.toLowerCase() : one)
    for (const one of this.core.handPaths) {
      if (folded(at) === folded(one) || folded(at).startsWith(`${folded(one)}/`)) return true
    }
    const placed = this.placed(path)
    if (!placed) return false
    const { space } = placed
    const key = space.key(placed.path)
    const wanted = space.paths()
    for (const entry of space.entries.values()) {
      const want = wanted.get(entry.id)
      const here = entry.local_path
      if (here && space.key(here) === key && want !== here) return true
      if (want !== undefined && space.key(want) === key && here !== want) return true
    }
    return false
  }

  /** Whether a file is the paper a page note holds: `Lecture.pages.pdf` beside
   *  `Lecture.pages`. Not an entry of its own, because a page note and its paper are one
   *  thing (#551): the paper goes to the account and to other devices as part of the
   *  note, kept by the note's id, so a rename or a move of the note never leaves a file
   *  of the tree behind under the old name. A PDF of that name with no note beside it
   *  is a PDF like any other, which is what `held_paper` in src-tauri/src/paths.rs
   *  says too. */
  private async heldPaper(path: string): Promise<boolean> {
    const holder = holderOf(path)
    return holder !== null && (await this.core.world.disk.read(holder)) !== null
  }

  /** A file or folder deleted here. `back`: the word its trash or its undo keeps to put
   *  it back by (`restored`). */
  removed(path: string, back?: string): Promise<void> {
    return this.core.use(() => this.remove(path, back))
  }

  /** What this device deleted, back at `path` as the entries it was - a folder with what
   *  it held (`restored` in create.ts): the delete said with `back` (`removed`), the word
   *  its trash or its undo keeps. Answers false where it cannot be: no delete of this
   *  space was said with that word, or something else is there; what is there is then a
   *  file made, which the caller says instead. */
  restored(path: string, back: string): Promise<boolean> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      if (!placed) return false
      let id: string | null = null
      for (const [one, went] of placed.space.gone) if (went.back === back) id = one
      if (id === null) return false
      const changes = await restored(this.core, placed.space, id, placed.path)
      if (changes === null) return false
      await this.core.commit(changes)
      await this.settle(placed.space)
      return true
    })
  }

  private async remove(path: string, back?: string): Promise<void> {
    const placed = this.placed(path)
    if (!placed) return
    // Every road to here reads a file not found as gone. On macOS 13 a note iCloud took
    // off this Mac is exactly that, and it would leave the account and every other device.
    if (await this.core.world.disk.evicted(path)) return
    await this.core.commit(removed(this.core, placed.space, placed.path, back))
    await this.settle(placed.space)
    await this.held.refresh()
  }

  /** The disk made to agree with what is shown, after this device changed the tree. */
  private async settle(space: SpaceState) {
    const forgets: Change[] = []
    const changed = await settle(space, {
      disk: this.core.world.disk,
      join: (folder, path) => this.core.world.join(folder, path),
      keeps: (id) => this.core.hasPending(id) || this.core.isHeld(id),
      forget: (id) => forgets.push(...this.core.forgetChanges(id)),
      busy: (id) => this.core.inHand.has(id),
    })
    await this.core.commit([...this.core.entryChanges(changed), ...forgets])
  }

  /** Autosave wrote a document's file: what it wrote is recorded, and what was typed
   *  since the last pause becomes one more pending update, in one write. */
  saved(path: string, text: string): Promise<void> {
    return this.core.use(() => this.wroteDown(path, text))
  }

  private async wroteDown(path: string, text: string): Promise<void> {
    const placed = this.placed(path)
    const entry = this.entryAt(path)
    if (!placed || !entry) return
    const doc = this.core.docs.get(entry.id)
    // A document joined to the note it is: what was typed is in it already.
    if (doc?.live && this.core.pinned.has(entry.id)) {
      const changes: Change[] = []
      if (doc.flush()) changes.push(...this.core.docChanges(doc))
      changes.push(...(await wrote(this.core, entry, text)))
      await this.core.commit(changes)
      return
    }
    // One that is not - a canvas, a note before its document arrived - takes the file's
    // words the way it takes another program's, three ways against Orden's last write.
    await this.core.commit(await foldIn(this.core, placed.space, entry))
  }

  /** The side a small overlap between an open note and its document lost, kept as a
   *  version the way a pass keeps one (rejoin.ts): the rule settled it without asking,
   *  and the words it did not keep are in the history, never gone (binding.ts). */
  keepLost(
    id: string,
    lost: { local: boolean; remote: boolean },
    local: string,
    remote: string,
  ): Promise<void> {
    return this.core.use(async () => {
      const space = this.core.spaceOf(id)
      if (!space) return
      await this.core.commit(keepLosers(this.core, space, id, lost, local, remote))
    })
  }

  /** A note whose words in a tab and in its document both moved past what Orden last
   *  wrote, too far to merge quietly: held, like another program's edit (binding.ts). */
  holdFile(id: string, base: string, local: string): Promise<void> {
    const against = { t: 'file', base, local } as const
    return this.core.commit(
      this.core.holdChanges({
        row: {
          id,
          remote: againstBytes(against),
          remote_sv: new Uint8Array(),
          device: null,
          at: this.core.world.now(),
        },
        against,
      }),
    )
  }

  /** Autosave's pause for the documents no editor holds - words the engine or the
   *  simulator's person put in: into the store, and onto the disk. */
  pause(): Promise<void> {
    return this.core.use(() => this.paused())
  }

  private async paused(): Promise<void> {
    const changes: Change[] = []
    for (const doc of [...this.core.docs.values()]) {
      if (this.core.pinned.has(doc.id) || !doc.flush()) continue
      changes.push(...this.core.docChanges(doc))
      const space = this.core.spaceOf(doc.id)
      const entry = space?.entries.get(doc.id)
      if (space && entry) changes.push(...(await project(this.core, space, entry, doc)))
    }
    await this.core.commit(changes)
  }

  /** A file that another program may have changed: folded in if it did. */
  foreign(path: string): Promise<void> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      const entry = this.entryAt(path)
      if (!placed || !entry) return
      // A file that is not a document is read for its hash by the next pass.
      if (entry.kind === 'file') {
        this.core.touched.add(entry.id)
        return
      }
      await this.core.commit(await foldIn(this.core, placed.space, entry))
    })
  }

  /** When a file was last seen as it is, as the launch scan lists it: what tells the
   *  next scan whether it changed. */
  stamped(path: string, mtime: number, size: number): Promise<void> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      const entry = placed?.space.at(placed.path)
      if (!entry) return
      if (entry.kind === 'file' && this.core.touched.has(entry.id)) {
        this.core.stampWaiting.set(entry.id, { mtime, size })
        return
      }
      entry.mtime = mtime
      entry.size = size
      await this.core.commit(this.core.entryChanges([entry]))
    })
  }

  // -------------------------------------------------------------------------
  // Documents held open

  /** A room met with this device's pending edits (`Carrying` in rooms/door.ts): its
   *  catch-up classified exactly as a push answered `moved` is (rejoin.ts). Answers
   *  whether to meet the room or stay out of it, holding the note. */
  meet(id: string, update: Uint8Array): Promise<'go' | 'hold'> {
    return this.core.use(async () => {
      const doc = this.core.docs.get(id)
      const space = this.core.spaceOf(id)
      if (!doc || !space || this.core.isHeld(id)) return 'hold'
      doc.flush()
      const by = this.core.by.get(id) ?? null
      const met = await rejoin(this.core, space, doc, update, doc.seq, this.core.world.now(), by)
      await this.core.commit(met.changes)
      return met.held ? 'hold' : 'go'
    })
  }

  /** A room's acknowledgement at its settle: what it covers of the pending edits is the
   *  account's now. */
  acked(id: string, seq: number, sv: Uint8Array): Promise<void> {
    return this.core.use(async () => {
      const doc = this.core.docs.get(id)
      if (!doc) return
      doc.flush()
      doc.acked(seq, sv)
      await this.core.commit(this.core.docChanges(doc))
    })
  }

  /** A document something is holding open - a tab, a room - live until it lets go. */
  hold(id: string): Promise<Doc | null> {
    return this.core.use(async () => {
      const doc = await this.core.doc(id)
      if (!doc) return null
      this.core.pinned.add(id)
      doc.open()
      return doc
    })
  }

  /** Lets go of a document: what was typed is written down, and it is closed. */
  letGo(id: string): Promise<void> {
    return this.core.use(async () => {
      this.core.pinned.delete(id)
      const doc = this.core.docs.get(id)
      if (!doc) return
      doc.flush()
      await this.core.commit(this.core.dirtyChanges())
    })
  }

  // -------------------------------------------------------------------------
  // Life

  /** Everything written down, with the session going on: a save. */
  flush(): Promise<void> {
    return this.core.use(() => this.writtenDown())
  }

  /** Everything written down, and the session marked as ended cleanly. */
  quit(): Promise<void> {
    return this.core.use(async () => {
      await this.writtenDown()
      await this.core.endedCleanly()
    })
  }

  private async writtenDown(): Promise<void> {
    for (const doc of this.core.docs.values()) doc.flush()
    await this.core.commit(this.core.dirtyChanges())
  }

  /** Stops at once: anything still in the air finds it is too late. */
  stop() {
    this.core.life += 1
    for (const doc of this.core.docs.values()) doc.close()
  }
}

/** A path with `/` between folders, as the disk `root` is on writes them: `\\` is a
 *  separator on Windows and a character of a name anywhere else. */
function norm(root: string, value: string): string {
  return (windowsPath(root) ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '')
}

/** Whether a folder is the top of a space, as `relative` compares them. */
function sameFolder(root: string, folder: string, foldsCase: boolean): boolean {
  const base = norm(root, root)
  const full = norm(root, folder)
  return foldsCase ? full.toLowerCase() === base.toLowerCase() : full === base
}

/** A path relative to a root, with `/` between folders, or null outside it. */
export function relative(root: string, path: string, foldsCase: boolean): string | null {
  const base = norm(root, root)
  const full = norm(root, path)
  if (full.length <= base.length) return null
  const head = full.slice(0, base.length)
  const same = foldsCase ? head.toLowerCase() === base.toLowerCase() : head === base
  if (!same || full.charAt(base.length) !== '/') return null
  return full.slice(base.length + 1)
}
