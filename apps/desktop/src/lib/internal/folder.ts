import { nameKey } from '@orden/sync-core'
export interface InternalEntry {
  key: string | null
  made: number
  modified: number
  size: number
}

export interface InternalTrashed {
  id: string
  kind: string
  name: string
  from: string
  trashedAt: number
  apart?: boolean
  held: [string, InternalEntry][]
}

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

export interface InternalBytes {
  readText(key: string): Promise<string | null>
  writeText(key: string, text: string): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  write(key: string, bytes: Uint8Array): Promise<void>
  remove(key: string): Promise<void>
  slot(at: 0 | 1): Promise<string | null>
  writeSlot(at: 0 | 1, text: string): Promise<void>
  where(key: string): string
}

export interface InternalWorld {
  now(): number
  key(): string
  foldsCase: boolean
  exclusive?<T>(name: string, then: () => Promise<T>): Promise<T>
  channel?(
    name: string,
    heard: (message: unknown) => void,
  ): { post(message: unknown): void; close(): void }
}

interface Written {
  index: 1
  gen: number
  paths: Record<string, InternalEntry>
  trash: InternalTrashed[]
}

const STAMPS_AFTER = 2000

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
  private paths = new Map<string, { path: string; entry: InternalEntry }>()
  private trashed: InternalTrashed[] = []
  private gen = 0
  private holding: 0 | 1 = 1
  private stale = false
  private readonly listeners = new Set<(changes: InternalChange[]) => void>()
  private stampTimer: ReturnType<typeof setTimeout> | undefined
  private stamps = new Map<string, { modified: number; size: number }>()
  private readonly channel: { post(message: unknown): void; close(): void } | null

  private constructor(
    readonly name: string,
    readonly bytes: InternalBytes,
    private readonly world: InternalWorld,
  ) {
    this.channel =
      world.channel?.(`orden:internal:${name}`, (message) => {
        this.fromAnother(message)
      }) ?? null
  }

  static async open(
    name: string,
    bytes: InternalBytes,
    world: InternalWorld,
  ): Promise<InternalFolder> {
    const folder = new InternalFolder(name, bytes, world)
    await folder.load()
    return folder
  }

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
    for (const [path, stamp] of this.stamps) {
      const at = this.paths.get(this.keyOf(path))
      if (at?.entry.key) at.entry = { ...at.entry, ...stamp }
    }
    this.stale = false
  }

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

  async fresh(): Promise<void> {
    if (this.stale) await this.load()
  }

  heard(listener: (changes: InternalChange[]) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private tell(changes: InternalChange[]) {
    if (!changes.length) return
    for (const listener of [...this.listeners]) listener(changes)
  }

  private async change(change: () => InternalChange[] | null): Promise<void> {
    const run = async () => {
      await this.fresh()
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
    await (this.world.exclusive ? this.world.exclusive(`orden:internal:${this.name}`, run) : run())
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

  private stampSoon() {
    clearTimeout(this.stampTimer)
    this.stampTimer = setTimeout(() => {
      void this.flush()
    }, STAMPS_AFTER)
  }

  async flush(): Promise<void> {
    if (this.stamps.size) await this.change(() => null)
  }

  close() {
    clearTimeout(this.stampTimer)
    this.channel?.close()
    this.listeners.clear()
  }

  async at(path: string): Promise<InternalEntry | null> {
    await this.fresh()
    return this.atNow(path)
  }

  atNow(path: string): InternalEntry | null {
    return this.paths.get(this.keyOf(path))?.entry ?? null
  }

  private spelled(path: string): string {
    return this.paths.get(this.keyOf(path))?.path ?? path
  }

  async holds(path: string): Promise<boolean> {
    await this.fresh()
    if (!path) return true
    if (this.atNow(path)) return true
    const inside = `${this.keyOf(path)}/`
    for (const key of this.paths.keys()) if (key.startsWith(inside)) return true
    return false
  }

  async list(): Promise<{ path: string; entry: InternalEntry }[]> {
    await this.fresh()
    return [...this.paths.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

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

  async write(path: string, what: string | Uint8Array): Promise<void> {
    await this.fresh()
    const there = this.atNow(path)
    if (there && !there.key) throw new Error(`${path} is a folder`)
    const at = this.world.now()
    const size = typeof what === 'string' ? what.length : what.byteLength
    const key = there?.key ?? this.newKey(path)
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
      const changes: InternalChange[] = []
      this.folders(path, at, changes)
      this.paths.set(this.keyOf(path), { path, entry: { key, made: at, modified: at, size } })
      changes.push({ kind: 'created', path, dir: false, size, mtime: at, id: key })
      return changes
    })
  }

  async adopt(path: string, what: Uint8Array | null): Promise<void> {
    await this.fresh()
    const there = this.atNow(path)
    const at = this.world.now()
    if (!what) {
      if (there?.key) throw new Error(`${path} is a file`)
      if (!there) this.folders(`${path}/-`, at, [])
      return
    }
    if (there && !there.key) throw new Error(`${path} is a folder`)
    const key = there?.key ?? this.newKey(path)
    await this.bytes.write(key, what)
    this.folders(path, at, [])
    this.paths.set(this.keyOf(path), {
      path: there ? this.spelled(path) : path,
      entry: { key, made: there?.made ?? at, modified: at, size: what.byteLength },
    })
  }

  save(): Promise<void> {
    return this.change(() => [])
  }

  private newKey(path: string): string {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot).toLowerCase() : ''
    return `${this.world.key()}${/^\.[a-z0-9]{1,8}$/.test(extension) ? extension : ''}`
  }

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
    for (const key of keys) await this.bytes.remove(key).catch(() => undefined)
  }

  async trash(): Promise<InternalTrashed[]> {
    await this.fresh()
    return [...this.trashed]
  }

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
