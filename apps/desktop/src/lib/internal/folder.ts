/** A space whose files Orden keeps itself (#1068, step 4c): a folder of its own holding
 *  every file's bytes under a name that never changes, and one index saying where in
 *  the space each one is.
 *
 *  It is a disk, as the engine and every command already know one: paths, folders,
 *  files with words or bytes, a move, a delete. What makes it Orden's own is that the
 *  paths are only the index. A file's bytes are `entries/<key>` from the moment it is
 *  made, a key nobody reads a name off, so a move or a rename is a line of the index
 *  written again and no byte moves; nothing else writes the folder, so nothing there has
 *  to be guessed about; and every change is said, exactly, by what made it (`heard`).
 *
 *  The index is written whole to one of two slots, the older one each time, after that
 *  one is taken away, so a new file is what is written and the crate writes a new file
 *  whole or not at all: a write cut short leaves the other slot, one change behind, and
 *  the next read takes whichever is newest. Every window of the app reads and writes the
 *  same index, so a change is made under a lock all of them share and said to the
 *  others on a channel, and a window that heard of one reads the index again before it
 *  answers anything. When a file was written and how long it is are written down with
 *  the next change to the tree, or a moment after the last write: a crash in that moment
 *  costs those times, never a file. */

import { nameKey } from '@orden/sync-core/tree'

/** What is at one path: a folder, or a file and the key its bytes are kept under. */
export interface InternalEntry {
  /** Null for a folder. */
  key: string | null
  /** When it was made, in milliseconds. */
  made: number
  /** When its bytes were last written; a folder's is when it was made. */
  modified: number
  /** How long it is: characters for words, bytes for bytes. */
  size: number
}

/** Something deleted into this space's trash: what was at a path, with everything under
 *  it, by where each was under it (`''` the thing itself). Its bytes stay where they
 *  were until it is purged, so putting it back is the index written again. */
export interface InternalTrashed {
  id: string
  kind: string
  name: string
  /** Where it was in the space. */
  from: string
  trashedAt: number
  /** Deleted by sync, which leaves a PDF's highlights out of the slot; see trash.rs. */
  apart?: boolean
  held: [string, InternalEntry][]
}

/** One change to the space, as a folder's watcher would hear it (`SpaceChange` in
 *  space-watch.ts), paths relative to the space: what the engine reads in place of a
 *  watcher, since this one is never wrong. `id` is the key, a file's identity. */
export type InternalChange =
  | {
      kind: 'created' | 'modified'
      path: string
      dir: boolean
      size: number
      mtime: number
      id: string | null
    }
  | { kind: 'removed'; path: string; dir: boolean; id: string | null }
  | {
      kind: 'renamed'
      from: string
      path: string
      dir: boolean
      size: number
      mtime: number
      id: string | null
    }

/** The bytes and the index, wherever they are kept: the crate's files on a desktop
 *  (internal/bytes.ts), a map in a test. */
export interface InternalBytes {
  readText(key: string): Promise<string | null>
  writeText(key: string, text: string): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  write(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  /** One of the index's two slots, or null where it is not there or will not read. */
  slot(at: 0 | 1): Promise<string | null>
  /** A slot written as a new file: taken away first, then written whole. */
  writeSlot(at: 0 | 1, text: string): Promise<void>
  /** Where a key's bytes are on this disk, for what reads a file by its own path. */
  where(key: string): string
}

/** What a folder needs besides its bytes. */
export interface InternalWorld {
  now(): number
  /** A key nobody has used: 128 random bits. */
  key(): string
  /** Whether names are compared without case, as the disk the space came from did. */
  foldsCase: boolean
  /** Runs `then` while no other window changes this folder (a Web Lock). */
  exclusive?<T>(name: string, then: () => Promise<T>): Promise<T>
  /** A channel to the other windows (a BroadcastChannel). */
  channel?(
    name: string,
    heard: (message: unknown) => void,
  ): { post(message: unknown): void; close(): void }
}

/** What the index file says, as written. */
interface Written {
  index: 1
  gen: number
  paths: Record<string, InternalEntry>
  trash: InternalTrashed[]
}

/** How long after the last write its time and length wait to be written down. */
const STAMPS_AFTER = 2000

/** The parent of a path relative to the space, `''` for its top. */
function folderOf(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function isEntry(value: unknown): value is InternalEntry {
  if (typeof value !== 'object' || value === null) return false
  const one = value as Record<string, unknown>
  return (
    (one.key === null || typeof one.key === 'string') &&
    typeof one.made === 'number' &&
    typeof one.modified === 'number' &&
    typeof one.size === 'number'
  )
}

/** The index as a slot holds it, or null where it is not one. A bad line costs itself. */
function readIndex(text: string | null): Written | null {
  if (!text) return null
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const said = value as Record<string, unknown>
  if (said.index !== 1 || typeof said.gen !== 'number') return null
  const paths: Record<string, InternalEntry> = {}
  if (typeof said.paths === 'object' && said.paths !== null) {
    for (const [path, entry] of Object.entries(said.paths)) {
      if (path && isEntry(entry)) paths[path] = entry
    }
  }
  const trash: InternalTrashed[] = []
  if (Array.isArray(said.trash)) {
    for (const one of said.trash as unknown[]) {
      if (typeof one !== 'object' || one === null) continue
      const item = one as Record<string, unknown>
      if (typeof item.id !== 'string' || typeof item.kind !== 'string') continue
      if (typeof item.name !== 'string' || typeof item.from !== 'string') continue
      if (typeof item.trashedAt !== 'number' || !Array.isArray(item.held)) continue
      const held = (item.held as unknown[]).filter(
        (pair): pair is [string, InternalEntry] =>
          Array.isArray(pair) && typeof pair[0] === 'string' && isEntry(pair[1]),
      )
      trash.push({
        id: item.id,
        kind: item.kind,
        name: item.name,
        from: item.from,
        trashedAt: item.trashedAt,
        ...(item.apart === true ? { apart: true } : {}),
        held,
      })
    }
  }
  return { index: 1, gen: said.gen, paths, trash }
}

export class InternalFolder {
  /** Every path, by how this disk compares paths, with the path as it is spelled. */
  private paths = new Map<string, { path: string; entry: InternalEntry }>()
  private trashed: InternalTrashed[] = []
  private gen = 0
  /** Which slot holds `gen`. */
  private holding: 0 | 1 = 1
  /** Another window wrote the index since this one read it. */
  private stale = false
  private readonly listeners = new Set<(changes: InternalChange[]) => void>()
  private stampTimer: ReturnType<typeof setTimeout> | undefined
  /** Times and lengths written here and not yet in the index, by path as spelled. */
  private stamps = new Map<string, { modified: number; size: number }>()
  private readonly channel: { post(message: unknown): void; close(): void } | null

  private constructor(
    /** What the lock and the channel are named by: the folder, the same in every window. */
    readonly name: string,
    readonly bytes: InternalBytes,
    private readonly world: InternalWorld,
  ) {
    this.channel =
      world.channel?.(`nib:internal:${name}`, (message) => {
        this.fromAnother(message)
      }) ?? null
  }

  /** Opens the folder named `name`, reading its index. */
  static async open(
    name: string,
    bytes: InternalBytes,
    world: InternalWorld,
  ): Promise<InternalFolder> {
    const folder = new InternalFolder(name, bytes, world)
    await folder.load()
    return folder
  }

  /** How this disk compares two paths. */
  private keyOf(path: string): string {
    return this.world.foldsCase ? nameKey(path) : path.normalize('NFC')
  }

  private async load() {
    const [zero, one] = await Promise.all([this.bytes.slot(0), this.bytes.slot(1)])
    const a = readIndex(zero)
    const b = readIndex(one)
    const newest = a && (!b || a.gen >= b.gen) ? a : b
    this.paths.clear()
    this.trashed = []
    this.gen = newest?.gen ?? 0
    this.holding = newest === a && a ? 0 : 1
    for (const [path, entry] of Object.entries(newest?.paths ?? {})) {
      this.paths.set(this.keyOf(path), { path, entry })
    }
    this.trashed = newest?.trash ?? []
    // Times this window wrote and has not written down stand over what was read.
    for (const [path, stamp] of this.stamps) {
      const at = this.paths.get(this.keyOf(path))
      if (at?.entry.key) at.entry = { ...at.entry, ...stamp }
    }
    this.stale = false
  }

  /** What another window said: the index it wrote, which this one reads again before it
   *  answers anything, or a file it wrote into, whose time and length are only in that
   *  window until they are written down. */
  private fromAnother(message: unknown) {
    if (typeof message !== 'object' || message === null) return
    const said = message as { gen?: unknown; changes?: unknown }
    if (typeof said.gen !== 'number') return
    if (said.gen > this.gen) this.stale = true
    const changes = Array.isArray(said.changes) ? (said.changes as InternalChange[]) : []
    if (!changes.length) return
    void this.fresh().then(() => {
      for (const one of changes) {
        if (one.kind !== 'modified') continue
        const at = this.paths.get(this.keyOf(one.path))
        if (at?.entry.key) at.entry = { ...at.entry, modified: one.mtime, size: one.size }
      }
      this.tell(changes)
    })
  }

  /** The index as it is, read again where another window changed it. */
  async fresh(): Promise<void> {
    if (this.stale) await this.load()
  }

  /** Hears every change to the space, made in this window or another. Answers how to
   *  stop. */
  heard(listener: (changes: InternalChange[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private tell(changes: InternalChange[]) {
    if (!changes.length) return
    for (const listener of [...this.listeners]) listener(changes)
  }

  /** One change to the index, made where no other window is making one, written down
   *  before it is answered, and said. `change` answers what it did, which may be
   *  nothing anybody hears of, or null where it changed nothing. */
  private async change(change: () => InternalChange[] | null): Promise<void> {
    const run = async () => {
      await this.fresh()
      // What was there, put back if the index cannot be written: a change it does not
      // hold did not happen, in this window either.
      const paths = new Map(this.paths)
      const trashed = [...this.trashed]
      const stamps = new Map(this.stamps)
      const changes = change()
      if (changes === null && !this.stamps.size) return
      try {
        await this.persist()
      } catch (error) {
        this.paths = paths
        this.trashed = trashed
        this.stamps = stamps
        throw error
      }
      this.channel?.post({ gen: this.gen, changes: changes ?? [] })
      this.tell(changes ?? [])
    }
    await (this.world.exclusive ? this.world.exclusive(`nib:internal:${this.name}`, run) : run())
  }

  private async persist() {
    clearTimeout(this.stampTimer)
    const written: Written = {
      index: 1,
      gen: this.gen + 1,
      paths: Object.fromEntries([...this.paths.values()].map(({ path, entry }) => [path, entry])),
      trash: this.trashed,
    }
    const into: 0 | 1 = this.holding === 0 ? 1 : 0
    await this.bytes.writeSlot(into, JSON.stringify(written))
    this.gen = written.gen
    this.holding = into
    this.stamps.clear()
  }

  /** Writes the times and lengths of the last writes down a moment after them. */
  private stampSoon() {
    clearTimeout(this.stampTimer)
    this.stampTimer = setTimeout(() => {
      void this.flush()
    }, STAMPS_AFTER)
  }

  /** Everything not yet written down, written down: at a window's close. */
  async flush(): Promise<void> {
    if (this.stamps.size) await this.change(() => null)
  }

  /** Lets go: the channel closed and nothing heard any more. */
  close() {
    clearTimeout(this.stampTimer)
    this.channel?.close()
    this.listeners.clear()
  }

  // ---------------------------------------------------------------------------
  // Reading

  /** What is at `path`, or null. */
  async at(path: string): Promise<InternalEntry | null> {
    await this.fresh()
    return this.atNow(path)
  }

  /** The same, from what this window holds now, without asking: what a path is turned
   *  into a file's place by, where nothing may wait (`assetUrl`). */
  atNow(path: string): InternalEntry | null {
    return this.paths.get(this.keyOf(path))?.entry ?? null
  }

  /** The path as it is spelled here, for one spelled another way this disk calls the
   *  same. */
  private spelled(path: string): string {
    return this.paths.get(this.keyOf(path))?.path ?? path
  }

  /** Whether anything is at `path` or under it. */
  async holds(path: string): Promise<boolean> {
    await this.fresh()
    if (!path) return true
    if (this.atNow(path)) return true
    const inside = `${this.keyOf(path)}/`
    for (const key of this.paths.keys()) if (key.startsWith(inside)) return true
    return false
  }

  /** Every path and what is there, in path order. */
  async list(): Promise<{ path: string; entry: InternalEntry }[]> {
    await this.fresh()
    return [...this.paths.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  /** What is at `path` and under it, by where under it (`''` itself). */
  private under(path: string): { rest: string; key: string; path: string; entry: InternalEntry }[] {
    const own = this.keyOf(path)
    const inside = `${own}/`
    const out: { rest: string; key: string; path: string; entry: InternalEntry }[] = []
    for (const [key, one] of this.paths) {
      if (key === own) out.push({ rest: '', key, ...one })
      else if (key.startsWith(inside)) out.push({ rest: one.path.slice(path.length), key, ...one })
    }
    return out
  }

  async readText(path: string): Promise<string | null> {
    const entry = await this.at(path)
    return entry?.key ? this.bytes.readText(entry.key) : null
  }

  async read(path: string): Promise<Uint8Array | null> {
    const entry = await this.at(path)
    return entry?.key ? this.bytes.read(entry.key) : null
  }

  // ---------------------------------------------------------------------------
  // Writing

  /** The folders above `path` that are not there yet, made, shallow first. Refuses one
   *  where a file is. */
  private folders(path: string, at: number, changes: InternalChange[]) {
    const missing: string[] = []
    for (let folder = folderOf(path); folder; folder = folderOf(folder)) {
      const there = this.atNow(folder)
      if (there?.key) throw new Error(`${folder} is a file`)
      if (there) break
      missing.unshift(folder)
    }
    for (const folder of missing) {
      this.paths.set(this.keyOf(folder), {
        path: folder,
        entry: { key: null, made: at, modified: at, size: 0 },
      })
      changes.push({ kind: 'created', path: folder, dir: true, size: 0, mtime: at, id: null })
    }
  }

  /** A folder, with the folders above it. Nothing where one is already. */
  async mkdir(path: string): Promise<void> {
    if (!path) return
    await this.change(() => {
      const there = this.atNow(path)
      if (there?.key) throw new Error(`${path} is a file`)
      if (there) return null
      const at = this.world.now()
      const changes: InternalChange[] = []
      this.folders(`${path}/-`, at, changes)
      return changes
    })
  }

  /** Words or bytes at `path`: into the file that is there, or a new one made, with the
   *  folders above it. */
  async write(path: string, what: string | Uint8Array): Promise<void> {
    await this.fresh()
    const there = this.atNow(path)
    if (there && !there.key) throw new Error(`${path} is a folder`)
    const at = this.world.now()
    const size = typeof what === 'string' ? what.length : what.byteLength
    const key = there?.key ?? this.newKey(path)
    // The bytes first: an index naming a key with nothing behind it would be a file that
    // reads as nothing, where bytes no index names are only bytes.
    if (typeof what === 'string') await this.bytes.writeText(key, what)
    else await this.bytes.write(key, what)

    if (there) {
      const spelled = this.spelled(path)
      const entry = { ...there, modified: at, size }
      this.paths.set(this.keyOf(path), { path: spelled, entry })
      this.stamps.set(spelled, { modified: at, size })
      const change: InternalChange = {
        kind: 'modified',
        path: spelled,
        dir: false,
        size,
        mtime: at,
        id: key,
      }
      this.channel?.post({ gen: this.gen, changes: [change] })
      this.tell([change])
      this.stampSoon()
      return
    }
    await this.change(() => {
      // Made by another window meanwhile: the file is this one, and what that window
      // wrote is under a key nothing names any more.
      const changes: InternalChange[] = []
      this.folders(path, at, changes)
      this.paths.set(this.keyOf(path), { path, entry: { key, made: at, modified: at, size } })
      changes.push({ kind: 'created', path, dir: false, size, mtime: at, id: key })
      return changes
    })
  }

  /** A key for a new file: random, and the extension of its name, which is all the
   *  system reads a picture's type off where its bytes do not say. */
  private newKey(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot).toLowerCase() : ''
    return `${this.world.key()}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ''}`
  }

  /** `from` and everything under it at `to`: the index, and no bytes. Refuses a move
   *  onto something, into itself, or into a file. */
  async move(from: string, to: string): Promise<void> {
    if (from === to) return
    await this.change(() => {
      const moving = this.under(from)
      if (!moving.length) throw new Error(`nothing is at ${from}`)
      const self = this.keyOf(from)
      const target = this.keyOf(to)
      const caseOnly = self === target
      if (!caseOnly && target.startsWith(`${self}/`))
        throw new Error(`${from} cannot go into itself`)
      if (!caseOnly && this.atNow(to)) throw new Error(`something is at ${to} already`)
      const at = this.world.now()
      const changes: InternalChange[] = []
      this.folders(to, at, changes)
      for (const one of moving) this.paths.delete(one.key)
      for (const one of moving) {
        const path = `${to}${one.rest}`
        this.paths.set(this.keyOf(path), { path, entry: one.entry })
        const stamp = this.stamps.get(one.path)
        if (stamp) {
          this.stamps.delete(one.path)
          this.stamps.set(path, stamp)
        }
      }
      const top = moving.find((one) => one.rest === '')
      if (top) {
        changes.push({
          kind: 'renamed',
          from: top.path,
          path: to,
          dir: !top.entry.key,
          size: top.entry.size,
          mtime: top.entry.modified,
          id: top.entry.key,
        })
      }
      return changes
    })
  }

  /** `path` and everything under it gone, and their bytes with them. */
  async remove(path: string): Promise<void> {
    let keys: string[] = []
    await this.change(() => {
      const going = this.under(path)
      if (!going.length) return null
      for (const one of going) {
        this.paths.delete(one.key)
        this.stamps.delete(one.path)
      }
      keys = going.flatMap((one) => (one.entry.key ? [one.entry.key] : []))
      const top = going.find((one) => one.rest === '')
      return [
        {
          kind: 'removed',
          path: top?.path ?? path,
          dir: !top?.entry.key,
          id: top?.entry.key ?? null,
        },
      ]
    })
    // After the index no longer names them: bytes nothing names are only bytes.
    for (const key of keys) await this.bytes.remove(key).catch(() => undefined)
  }

  // ---------------------------------------------------------------------------
  // The trash

  async trash(): Promise<InternalTrashed[]> {
    await this.fresh()
    return [...this.trashed]
  }

  /** What is at `path`, and under it, into the trash as `item` says, with what is
   *  `beside` it and goes with it - a PDF's highlights, a page note's paper - each a path
   *  that begins with `path`'s. Its bytes stay where they are. Answers false where
   *  nothing is there. */
  async toTrash(
    path: string,
    item: Omit<InternalTrashed, 'held' | 'from'>,
    beside: readonly string[] = [],
  ): Promise<boolean> {
    let taken = false
    await this.change(() => {
      const going = this.under(path)
      const top = going.find((one) => one.rest === '')
      if (!top) return null
      for (const one of beside) {
        if (!one.startsWith(top.path) || one === top.path) continue
        const at = this.paths.get(this.keyOf(one))
        if (at) going.push({ rest: at.path.slice(top.path.length), key: this.keyOf(one), ...at })
      }
      for (const one of going) {
        this.paths.delete(one.key)
        this.stamps.delete(one.path)
      }
      this.trashed.push({
        ...item,
        from: top.path,
        held: going.map((one) => [one.rest, one.entry]),
      })
      taken = true
      return [{ kind: 'removed', path: top.path, dir: !top.entry.key, id: top.entry.key }]
    })
    return taken
  }

  /** Words that never had a file, in the trash as a note deleted from `from` would be. */
  async wordsToTrash(from: string, text: string, item: Omit<InternalTrashed, 'held' | 'from'>) {
    const at = this.world.now()
    const key = this.newKey(from)
    await this.bytes.writeText(key, text)
    await this.change(() => {
      this.trashed.push({
        ...item,
        from,
        held: [['', { key, made: at, modified: at, size: text.length }]],
      })
      return []
    })
  }

  /** One trashed thing back at `to`, under the keys it had. Refuses where something is
   *  at `to`. */
  async fromTrash(id: string, to: string): Promise<void> {
    await this.change(() => {
      const item = this.trashed.find((one) => one.id === id)
      if (!item) throw new Error('nothing to restore')
      if (this.atNow(to)) throw new Error(`something is at ${to} already`)
      const at = this.world.now()
      const changes: InternalChange[] = []
      this.folders(to, at, changes)
      for (const [rest, entry] of [...item.held].sort((a, b) => a[0].length - b[0].length)) {
        const path = `${to}${rest}`
        this.paths.set(this.keyOf(path), { path, entry })
        if (rest === '') {
          changes.push({
            kind: 'created',
            path,
            dir: !entry.key,
            size: entry.size,
            mtime: entry.modified,
            id: entry.key,
          })
        }
      }
      this.trashed = this.trashed.filter((one) => one !== item)
      return changes
    })
  }

  /** One trashed thing gone for good, and its bytes. */
  async purge(id: string): Promise<void> {
    let keys: string[] = []
    await this.change(() => {
      const item = this.trashed.find((one) => one.id === id)
      if (!item) return null
      this.trashed = this.trashed.filter((one) => one !== item)
      keys = item.held.flatMap(([, entry]) => (entry.key ? [entry.key] : []))
      return []
    })
    for (const key of keys) await this.bytes.remove(key).catch(() => undefined)
  }
}
