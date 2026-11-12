import {
  foreignCopy,
  inForeignCopy,
  repositioned,
  type ItemMeta,
  type MetaPatch,
  type TreeEntry,
} from '@orden/sync-core'
import type { EngineEvents, Engine as AskedEngine } from './asking.svelte'
import { Core } from './core'
import {
  atOrUnder,
  carried,
  described,
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
import { holderOf } from '../../pages/held'
import { claimed, waitsForBytes } from './files'
import { foldIn } from './ingest'
import { away, awayUnder, keepingChange, type LettingGo, trim, used, usedChanges } from './keeping'
import { isLocal, localPass } from './local'
import { settle, type SpaceState, windowsPath } from './places'
import { pass, type Passed, pullNow, resting } from './pass'
import { project, wrote } from './project'
import { keepLosers, rejoin } from './rejoin'
import { againstBytes } from './records'
import { put, type Change, type EntryRow, type LogRow, type SyncStore } from './store'
import type { World } from './world'

type Listeners = { [T in keyof EngineEvents]: Set<(event: EngineEvents[T]) => void> }

export interface Starting {
  names?: Names
  freshens?: boolean
}

export interface AwayFile {
  id: string
  space: string
  path: string
  relative: string
  size: number
  modified: number
  docSeq: number
}

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
    placed: new Set(),
  }

  private constructor(
    readonly core: Core,
    names: Names,
  ) {
    this.held = new HeldList(core, names)
    core.events.resurrected = (event) => this.emit('resurrected', event)
    core.events.unsynced = (event) => this.emit('unsynced', event)
    core.events.file = (event) => this.emit('file', event)
    core.events.placed = (event) => this.emit('placed', event)
    core.events.held = () => {
      void this.held.refresh()
      for (const [id, told] of [...this.unheld]) {
        if (core.isHeld(id)) continue
        this.unheld.delete(id)
        for (const one of told) one()
      }
    }
  }

  private readonly unheld = new Map<string, Set<() => void>>()

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

  async said(spaceId: string, failed: string): Promise<void> {
    const at = this.core.world.now()
    const row: LogRow = { at, space: spaceId, pulled: null, pushed: null, failed }
    await this.core.commit([put('log', row)]).catch(() => undefined)
    this.emit('pass', row)
  }

  async pass(spaceId: string): Promise<Passed | null> {
    const space = this.core.spaces.get(spaceId)
    if (!space) return null
    const began = this.core.world.now()
    let passed: Passed | null = null
    let failed: string | null = null
    try {
      passed = await this.core.use(() =>
        isLocal(space.id) ? localPass(this.core, space) : pass(this.core, space),
      )
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

  waiting(spaceId: string): boolean {
    const space = this.core.spaces.get(spaceId)
    if (!space) return false
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

  placed(path: string): Placed | null {
    const spaces = [...this.core.spaces.values()]
    for (const foldsCase of this.core.world.foldsCase ? [false, true] : [false]) {
      for (const space of spaces) {
        const inside = relative(space.row.root, path, foldsCase)
        if (inside !== null) return { space, path: inside }
      }
    }
    return null
  }

  entryAt(path: string) {
    const placed = this.placed(path)
    if (!placed || inForeignCopy(placed.path)) return null
    return placed.space.at(placed.path)
  }

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

  unsync(): Promise<number> {
    return this.core.use(async () => {
      const copies = this.foreignCopies()
      const changes = copies.flatMap(({ space, entry }) => unsynced(this.core, space, entry))
      await this.core.commit(changes)
      return copies.length
    })
  }

  private folderPlaced(folder: string): Placed | null {
    for (const foldsCase of this.core.world.foldsCase ? [false, true] : [false]) {
      for (const space of this.core.spaces.values()) {
        if (sameFolder(space.row.root, folder, foldsCase)) return { space, path: '' }
      }
    }
    return this.placed(folder)
  }

  placedIn(folder: string): string[] | null {
    const placed = this.folderPlaced(folder)
    if (!placed?.space.ordering.on) return null
    return placed.space.placedNames().get(placed.space.key(placed.path))?.names ?? null
  }

  placedFolders(root: string): Map<string, string[]> {
    const placed = this.folderPlaced(root)
    const out = new Map<string, string[]>()
    if (!placed?.space.ordering.on || placed.path) return out
    for (const { folder, names } of placed.space.placedNames().values()) out.set(folder, names)
    return out
  }

  keepsPlaces(folder: string): boolean {
    const placed = this.folderPlaced(folder)
    return !!placed?.space.ordering.on && placed.space.folderAt(placed.path) !== undefined
  }

  describedIn(root: string): Record<string, ItemMeta> | null {
    const placed = this.folderPlaced(root)
    if (!placed?.space.ordering.describes || placed.path) return null
    return Object.fromEntries(placed.space.described())
  }

  describe(root: string, patches: Readonly<Record<string, MetaPatch>>): Promise<string[] | null> {
    return this.core.use(async () => {
      const placed = this.folderPlaced(root)
      if (!placed?.space.ordering.describes || placed.path) return null
      const { space } = placed
      const left: string[] = []
      const ids = new Map<string, MetaPatch>()
      for (const [path, patch] of Object.entries(patches)) {
        const entry = space.at(path)
        if (entry && space.isLive(entry.id)) ids.set(entry.id, patch)
        else left.push(path)
      }
      if (ids.size) await this.core.commit(described(this.core, space, ids))
      return left
    })
  }

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

  awayFiles(): AwayFile[] {
    const out: AwayFile[] = []
    for (const space of this.core.spaces.values()) {
      if (!space.keepsFew) continue
      const paths = space.paths()
      for (const entry of space.entries.values()) {
        const at = paths.get(entry.id)
        if (at === undefined || !away(space, entry)) continue
        out.push({
          id: entry.id,
          space: space.id,
          path: this.core.world.join(space.row.root, at),
          relative: at,
          size: entry.size ?? 0,
          modified: entry.mtime ?? 0,
          docSeq: this.core.wanted(space.id).get(entry.id)?.docSeq ?? 0,
        })
      }
    }
    return out
  }

  fetch(path: string): Promise<boolean> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      if (!placed) return false
      const entry = placed.space.at(placed.path)
      if (entry && entry.kind !== 'folder') {
        if (entry.local_path) return true
        if (!away(placed.space, entry)) return false
        return this.bring(placed.space, [entry])
      }
      const left = awayUnder(placed.space, placed.path)
      if (!entry && !left.length) return false
      return this.bring(placed.space, left)
    })
  }

  private async bring(space: SpaceState, entries: readonly EntryRow[]): Promise<boolean> {
    if (!entries.length) return true
    const ids = new Set(entries.map((one) => one.id))
    for (const id of ids) this.core.asked.add(id)
    const life = this.core.life
    if (!(await pullNow(this.core, space, ids, () => this.core.life === life))) return false
    if (entries.some((one) => !one.local_path)) return false
    let kept = false
    for (const one of entries) {
      this.core.asked.delete(one.id)
      const doc = await this.core.doc(one.id)
      kept = used(this.core, space, one.id, doc?.text().length) || kept
    }
    await this.core.commit(kept ? [keepingChange(space)] : [])
    return true
  }

  private async carryAway(was: Placed, now: Placed): Promise<boolean> {
    const left = awayUnder(was.space, was.path)
    if (!left.length) return true
    if (!(await this.bring(was.space, left))) return false
    const { world } = this.core
    for (const one of left) {
      const rest = one.local_path.slice(was.path.length)
      await world.disk.move(
        world.join(was.space.row.root, one.local_path),
        world.join(now.space.row.root, `${now.path}${rest}`),
        'file',
      )
    }
    return true
  }

  keptIds(spaceId: string): string[] {
    const space = this.core.spaces.get(spaceId)
    if (!space?.keepsFew) return []
    return [...space.entries.values()].flatMap((entry) =>
      entry.local_path && this.core.hasDoc(entry.id) ? [entry.id] : [],
    )
  }

  keepingFew(): { id: string; root: string }[] {
    return [...this.core.spaces.values()].flatMap((space) =>
      space.keepsFew ? [{ id: space.id, root: space.row.root }] : [],
    )
  }

  keepWhole(spaceId: string): Promise<void> {
    return this.core.use(async () => {
      const space = this.core.spaces.get(spaceId)
      if (!space || space.keeping.refused) return
      space.keeping.refused = true
      await this.core.commit([keepingChange(space)])
    })
  }

  isLive(id: string): boolean {
    return this.core.spaceOf(id)?.isLive(id) ?? false
  }

  trim(budget: number, how: LettingGo): Promise<number> {
    return this.core.use(() => trim(this.core, budget, how))
  }

  created(
    path: string,
    folder: boolean,
    text?: string,
    mergeable?: string,
  ): Promise<string | null> {
    return this.core.use(() => this.oneAt(path, () => this.make(path, folder, text, mergeable)))
  }

  private readonly making = new Map<string, Promise<unknown>>()

  private async oneAt<T>(path: string, work: () => Promise<T>): Promise<T> {
    const at = path.replace(/\\/g, '/').normalize('NFC')
    const key = this.core.world.foldsCase ? at.toLowerCase() : at
    const mine = (this.making.get(key) ?? Promise.resolve()).then(work)
    const settled = mine.catch(() => undefined)
    this.making.set(key, settled)
    try {
      return await mine
    } finally {
      if (this.making.get(key) === settled) this.making.delete(key)
    }
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
      if (mergeable !== undefined)
        await this.core.commit(mergeableAfter(placed.space, there, mergeable))
      return null
    }
    if (folder && placed.space.folderAt(placed.path) !== undefined) return null
    const awaited = folder ? null : placed.space.awaitedAt(placed.path)
    if (awaited && (await claimed(this.core, placed.space, awaited, placed.path))) return null
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

  moved(from: string, to: string): Promise<void> {
    return this.core.use(() => this.move(from, to))
  }

  private async move(from: string, to: string): Promise<void> {
    const was = this.placed(from)
    const now = this.placed(to)
    if (!was || !now) return
    if (await this.heldPaper(to)) {
      await this.remove(from)
      return
    }
    if (was.space !== now.space) {
      if (!(await this.carryAway(was, now))) {
        const kind = was.space.at(was.path)?.kind === 'folder' ? 'folder' : 'file'
        await this.core.world.disk.move(to, from, kind)
        return
      }
      const inside = atOrUnder(was.space, was.path)
        .map((entry) => ({ kind: entry.kind, rest: entry.local_path.slice(was.path.length) }))
        .sort((a, b) => a.rest.split('/').length - b.rest.split('/').length)
      await this.remove(from)
      if (!inside.length) {
        const text = await this.core.world.disk.read(to)
        await this.make(to, text === null, text ?? undefined)
      }
      for (const one of inside) {
        const path = this.core.world.join(now.space.row.root, `${now.path}${one.rest}`)
        if (one.kind === 'folder') await this.make(path, true)
        else if (!holdsDocument(one.kind)) await this.make(path, false)
        else {
          const text = await this.core.world.disk.read(path)
          if (text !== null) await this.make(path, false, text)
        }
      }
      return
    }
    await this.core.commit(moved(this.core, was.space, was.path, now.path))
    await this.settle(was.space)
  }

  async moving(from: string, to: string, run: () => Promise<void>): Promise<void> {
    const was = this.placed(from)
    const now = this.placed(to)
    if (was && was.space !== now?.space) {
      await this.leaving(was, run)
      return
    }
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

  private async leaving(was: Placed, run: () => Promise<void>): Promise<void> {
    const { space } = was
    const here = await this.core.use(() => this.bring(space, awayUnder(space, was.path)))
    if (!here)
      throw new Error(`${was.path} is not all on this device, and the account could not be reached`)
    const release = this.handle(atOrUnder(space, was.path), [])
    try {
      await run()
    } finally {
      release()
    }
  }

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

  private normed(path: string): string {
    return norm(this.placed(path)?.space.row.root ?? path, path)
  }

  ownWork(path: string): boolean {
    const at = this.normed(path)
    const folded = (one: string) => (this.core.world.foldsCase ? one.toLowerCase() : one)
    for (const one of this.core.handPaths) {
      if (folded(at) === folded(one) || folded(at).startsWith(`${folded(one)}/`)) return true
    }
    const placed = this.placed(path)
    if (!placed) return false
    const { space } = placed
    const wanted = space.paths()
    for (const entry of space.heldAt(placed.path)) {
      if (wanted.get(entry.id) !== entry.local_path) return true
    }
    for (const id of space.wantedAt(placed.path)) {
      const entry = space.entries.get(id)
      if (entry && entry.local_path !== wanted.get(id)) return true
    }
    return false
  }

  private async heldPaper(path: string): Promise<boolean> {
    const holder = holderOf(path)
    return holder !== null && (await this.core.world.disk.read(holder)) !== null
  }

  removed(path: string, back?: string): Promise<void> {
    return this.core.use(() => this.remove(path, back))
  }

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
    if (await this.core.world.disk.evicted(path)) return
    await this.core.commit(removed(this.core, placed.space, placed.path, back))
    await this.settle(placed.space)
    await this.held.refresh()
  }

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
    if (changed.length) this.core.events.placed?.({ moved: changed.length })
  }

  foldWritten(path: string): Promise<void> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      const entry = this.entryAt(path)
      if (placed && entry) await this.core.commit(await foldIn(this.core, placed.space, entry))
    })
  }

  saved(path: string, text: string): Promise<void> {
    return this.core.use(() => this.wroteDown(path, text))
  }

  private async wroteDown(path: string, text: string): Promise<void> {
    const placed = this.placed(path)
    const entry = this.entryAt(path)
    if (!placed || !entry) return
    const doc = this.core.docs.get(entry.id)
    if (doc?.live && this.core.pinned.has(entry.id)) {
      const changes: Change[] = usedChanges(this.core, placed.space, entry.id, text.length)
      if (doc.flush()) changes.push(...this.core.docChanges(doc))
      changes.push(...(await wrote(this.core, entry, text)))
      await this.core.commit(changes)
      return
    }
    await this.core.commit(await foldIn(this.core, placed.space, entry))
  }

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

  foreign(path: string): Promise<void> {
    return this.core.use(async () => {
      const placed = this.placed(path)
      const entry = this.entryAt(path)
      if (!placed || !entry) return
      if (entry.kind === 'file') {
        this.core.touched.add(entry.id)
        return
      }
      await this.core.commit(await foldIn(this.core, placed.space, entry))
    })
  }

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

  acked(id: string, seq: number, sv: Uint8Array): Promise<void> {
    return this.core.use(async () => {
      const doc = this.core.docs.get(id)
      if (!doc) return
      doc.flush()
      doc.acked(seq, sv)
      await this.core.commit(this.core.docChanges(doc))
    })
  }

  hold(id: string): Promise<Doc | null> {
    return this.core.use(async () => {
      const doc = await this.core.doc(id)
      if (!doc) return null
      this.core.pinned.add(id)
      doc.open()
      const space = this.core.spaceOf(id)
      if (space) await this.core.commit(usedChanges(this.core, space, id))
      return doc
    })
  }

  letGo(id: string): Promise<void> {
    return this.core.use(async () => {
      this.core.pinned.delete(id)
      const doc = this.core.docs.get(id)
      if (!doc) return
      doc.flush()
      await this.core.commit(this.core.dirtyChanges())
    })
  }

  flush(): Promise<void> {
    return this.core.use(() => this.writtenDown())
  }

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

  stop() {
    this.core.life += 1
    for (const doc of this.core.docs.values()) doc.close()
  }
}

function norm(root: string, value: string): string {
  return (windowsPath(root) ? value.replace(/\\/g, '/') : value).replace(/\/+$/, '')
}

function sameFolder(root: string, folder: string, foldsCase: boolean): boolean {
  const base = norm(root, root)
  const full = norm(root, folder)
  return foldsCase ? full.toLowerCase() === base.toLowerCase() : full === base
}

export function relative(root: string, path: string, foldsCase: boolean): string | null {
  const base = norm(root, root)
  const full = norm(root, path)
  if (full.length <= base.length) return null
  const head = full.slice(0, base.length)
  const same = foldsCase ? head.toLowerCase() === base.toLowerCase() : head === base
  if (!same || full.charAt(base.length) !== '/') return null
  return full.slice(base.length + 1)
}
