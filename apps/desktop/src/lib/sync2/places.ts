import { type OpResult, type Op } from '@orden/sync-core/wire'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { hash32 } from '@orden/sync-core/seed'
import { type ItemMeta, type MetaPatch, patched, sameMeta } from '@orden/sync-core/meta'
import { byPosition } from '@orden/sync-core/order'
import { applyOp, nameKey, type TreeEntry, type TreeState, treeState } from '@orden/sync-core/tree'
import { isReserved } from '../naming'
import { holdsDocument } from './kinds'
import { emptyKeeping } from './keeping'
import { emptyOrdering, type Gone, type Keeping, type Ordering, type Outgoing } from './records'
import type { EntryRow, OutboxRow, SpaceRow } from './store'
import type { Disk, FileKind, World } from './world'

export interface Outboxed {
  row: OutboxRow
  record: Outgoing
}

export const SEP = '/'

export function folderOf(path: string): string {
  const at = path.lastIndexOf(SEP)
  return at < 0 ? '' : path.slice(0, at)
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf(SEP) + 1)
}

export function joined(folder: string, name: string): string {
  return folder ? `${folder}${SEP}${name}` : name
}

const FORBIDDEN = '<>:"\\|?*'

function localName(name: string, platform: World['platform']): string {
  if (platform === 'windows') {
    let out = Array.from(name, (char) =>
      char < ' ' || FORBIDDEN.includes(char) ? '_' : char,
    ).join('')
    if (isReserved(out)) out = `_${out}`
    return out.replace(/[. ]+$/, (tail) => '_'.repeat(tail.length))
  }
  if (platform === 'mac') return name.replace(/:/g, '_')
  return name
}

export function windowsPath(root: string): boolean {
  return /^[a-zA-Z]:/.test(root) || root.includes('\\')
}

export class SpaceState {
  entries: Map<string, EntryRow>
  outbox: Outboxed[]
  ordering: Ordering
  gone: Gone = new Map()
  keeping: Keeping = emptyKeeping()
  lostCheckedAt = -Infinity
  private shownCache: TreeState | null = null
  private pathsCache: Map<string, string> | null = null
  private placedCache: Map<string, { folder: string; names: string[] }> | null = null
  private readonly holding = new Map<string, Set<string>>()
  private heldIds: string[] = []
  private heldPaths: string[] = []
  private readonly keys = new Map<string, string>()
  private shownAt: { paths: Map<string, string>; keys: Map<string, string[]> } | null = null

  constructor(
    public row: SpaceRow,
    entries: readonly EntryRow[],
    outbox: readonly Outboxed[],
    private readonly device: string,
    private readonly world: Pick<World, 'platform' | 'foldsCase' | 'lazy'>,
    ordering: Ordering = emptyOrdering(),
    private readonly lastByMe: (id: string) => boolean = () => false,
  ) {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]))
    this.outbox = [...outbox]
    this.ordering = ordering
  }

  get id(): string {
    return this.row.space_id
  }

  changed() {
    this.shownCache = null
    this.pathsCache = null
    this.placedCache = null
  }

  confirmed(): TreeState {
    const entries: TreeEntry[] = []
    for (const entry of this.entries.values()) {
      if (entry.seq === null) continue
      entries.push({
        id: entry.id,
        kind: entry.kind as TreeEntry['kind'],
        parent: entry.parent,
        name: entry.name,
        deleted: entry.deleted,
        seq: entry.seq,
        docSeq: 0,
        ...(this.lastByMe(entry.id) ? { by: this.device } : {}),
        ...this.positionOf(entry.id),
        ...this.metaOf(entry.id),
      })
    }
    return treeState(entries, this.row.cursor)
  }

  private positionOf(id: string): { pos?: string } {
    const pos = this.ordering.positions.get(id)
    return pos === undefined ? {} : { pos }
  }

  private metaOf(id: string): { meta?: ItemMeta } {
    const meta = this.ordering.meta.get(id)
    return meta === undefined ? {} : { meta }
  }

  described(): Map<string, ItemMeta> {
    const paths = this.paths()
    const out = new Map<string, ItemMeta>()
    for (const entry of this.shown().entries.values()) {
      const path = paths.get(entry.id)
      if (entry.deleted || entry.meta === undefined || path === undefined) continue
      out.set(path, entry.meta)
    }
    return out
  }

  shown(): TreeState {
    if (this.shownCache) return this.shownCache
    const state = this.confirmed()
    for (const one of this.outbox) {
      if (one.record.t !== 'op') continue
      const op: Op = { ...one.record.op }
      if (op.t === 'create') delete op.mergeable
      applyOp(state, op, { role: 'owner', device: this.device })
    }
    this.shownCache = state
    return state
  }

  paths(): Map<string, string> {
    if (this.pathsCache) return this.pathsCache
    const shown = this.shown()
    const children = new Map<string | null, TreeEntry[]>()
    for (const entry of shown.entries.values()) {
      if (entry.deleted) continue
      const list = children.get(entry.parent) ?? []
      list.push(entry)
      children.set(entry.parent, list)
    }

    const out = new Map<string, string>()
    const walk = (parent: string | null, folder: string) => {
      const siblings = (children.get(parent) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1))
      const taken = new Set<string>()
      for (const entry of siblings) {
        let name = localName(entry.name, this.world.platform)
        for (let counter = 2; taken.has(this.key(name)); counter += 1) {
          name = numbered(localName(entry.name, this.world.platform), counter)
        }
        taken.add(this.key(name))
        const path = joined(folder, name)
        out.set(entry.id, path)
        if (entry.kind === 'folder') walk(entry.id, path)
      }
    }
    walk(null, '')
    this.pathsCache = out
    return out
  }

  placedNames(): Map<string, { folder: string; names: string[] }> {
    if (this.placedCache) return this.placedCache
    const shown = this.shown()
    const paths = this.paths()
    const groups = new Map<string, { folder: string; rows: TreeEntry[] }>()
    for (const entry of shown.entries.values()) {
      if (entry.deleted || entry.pos === undefined || !paths.has(entry.id)) continue
      const folder = entry.parent === null ? '' : paths.get(entry.parent)
      if (folder === undefined) continue
      const group = groups.get(this.key(folder)) ?? { folder, rows: [] }
      group.rows.push(entry)
      groups.set(this.key(folder), group)
    }
    const out = new Map<string, { folder: string; names: string[] }>()
    for (const [key, { folder, rows }] of groups) {
      const names = rows.sort(byPosition).map((entry) => nameOf(paths.get(entry.id) ?? ''))
      out.set(key, { folder, names })
    }
    this.placedCache = out
    return out
  }

  childrenAt(folder: string): Map<string, TreeEntry> | null {
    const parent = this.folderAt(folder)
    if (parent === undefined) return null
    const paths = this.paths()
    const out = new Map<string, TreeEntry>()
    for (const entry of this.shown().entries.values()) {
      const path = paths.get(entry.id)
      if (entry.deleted || entry.parent !== parent || path === undefined) continue
      out.set(nameOf(path), entry)
    }
    return out
  }

  spelled(name: string): string {
    return localName(name, this.world.platform)
  }

  key(path: string): string {
    return this.world.foldsCase ? nameKey(path) : path.normalize('NFC')
  }

  get keepsFew(): boolean {
    return this.world.lazy === true && this.keeping.on && !this.keeping.refused
  }

  at(path: string): EntryRow | null {
    const wanted = this.key(path)
    const held = this.holders().get(wanted)
    if (held?.size === 1) {
      const [id] = held
      const entry = id === undefined ? undefined : this.entries.get(id)
      if (entry) return entry
    } else if (held) {
      for (const entry of this.entries.values()) {
        if (entry.local_path && this.key(entry.local_path) === wanted) return entry
      }
    }
    if (!this.keepsFew) return null
    for (const id of this.shownKeys().get(wanted) ?? []) {
      const entry = this.entries.get(id)
      if (entry && !entry.local_path && entry.seq !== null && holdsDocument(entry.kind))
        return entry
    }
    return null
  }

  private holders(): Map<string, Set<string>> {
    let at = 0
    for (const entry of this.entries.values()) {
      if (this.heldIds[at] !== entry.id) return this.heldAgain()
      const was = this.heldPaths[at] ?? ''
      if (was !== entry.local_path) {
        this.unhold(entry.id, was)
        this.hold(entry.id, entry.local_path)
        this.heldPaths[at] = entry.local_path
      }
      at += 1
    }
    return at === this.heldIds.length ? this.holding : this.heldAgain()
  }

  private heldAgain(): Map<string, Set<string>> {
    this.holding.clear()
    if (this.keys.size > this.entries.size * 4) this.keys.clear()
    this.heldIds = []
    this.heldPaths = []
    for (const entry of this.entries.values()) {
      this.heldIds.push(entry.id)
      this.heldPaths.push(entry.local_path)
      this.hold(entry.id, entry.local_path)
    }
    return this.holding
  }

  private keyOf(path: string): string {
    let key = this.keys.get(path)
    if (key === undefined) {
      key = this.key(path)
      this.keys.set(path, key)
    }
    return key
  }

  private hold(id: string, path: string) {
    if (!path) return
    const key = this.keyOf(path)
    const ids = this.holding.get(key) ?? new Set<string>()
    ids.add(id)
    this.holding.set(key, ids)
  }

  private unhold(id: string, path: string) {
    if (!path) return
    const key = this.keyOf(path)
    const ids = this.holding.get(key)
    ids?.delete(id)
    if (ids?.size === 0) this.holding.delete(key)
  }

  private shownKeys(): Map<string, string[]> {
    const paths = this.paths()
    if (this.shownAt?.paths === paths) return this.shownAt.keys
    const keys = new Map<string, string[]>()
    for (const [id, shown] of paths) {
      const key = this.keyOf(shown)
      const ids = keys.get(key)
      if (ids) ids.push(id)
      else keys.set(key, [id])
    }
    this.shownAt = { paths, keys }
    return keys
  }

  folderAt(path: string): string | null | undefined {
    if (!path) return null
    const entry = this.at(path)
    if (entry) return entry.kind === 'folder' && !entry.deleted ? entry.id : undefined
    for (const id of this.shownKeys().get(this.key(path)) ?? []) {
      const one = this.entries.get(id)
      if (one?.kind === 'folder' && !one.local_path && this.isLive(id)) return id
    }
    return undefined
  }

  foreign(id: string): boolean {
    const path = this.paths().get(id) ?? this.entries.get(id)?.local_path ?? ''
    return inForeignCopy(path)
  }

  isLive(id: string): boolean {
    const entry = this.shown().entries.get(id)
    return entry !== undefined && !entry.deleted
  }

  queue(one: Outboxed) {
    this.outbox.push(one)
    this.changed()
  }

  placedBy(op: Op, before: string | null, after: string | null): boolean {
    const had = this.ordering.positions.get(op.id)
    const pos = positionAfter(op, had, before, after)
    if (pos === had) return false
    if (pos === undefined) this.ordering.positions.delete(op.id)
    else this.ordering.positions.set(op.id, pos)
    this.repositioned = true
    return true
  }

  repositioned = false

  describedBy(id: string, patch: MetaPatch) {
    const had = this.ordering.meta.get(id)
    const meta = patched(had, patch)
    if (sameMeta(had, meta)) return
    if (meta === undefined) this.ordering.meta.delete(id)
    else this.ordering.meta.set(id, meta)
    this.repositioned = true
  }

  heardMeta(id: string, meta: ItemMeta | undefined) {
    const had = this.ordering.meta.get(id)
    if (sameMeta(had, meta)) return
    if (meta === undefined) this.ordering.meta.delete(id)
    else this.ordering.meta.set(id, meta)
    this.repositioned = true
  }

  answered(op: Op, result: OpResult): EntryRow[] {
    const touched: EntryRow[] = []
    if ('refused' in result || 'merged' in result) return touched
    const entry = this.entries.get(op.id)
    if (!entry) return touched
    if (op.t === 'delete') {
      entry.deleted = true
    } else if (op.t === 'meta') {
      this.describedBy(op.id, op.meta)
    } else if ('parent' in result) {
      this.placedBy(op, entry.parent, result.parent)
      entry.parent = result.parent
      entry.name = result.name
      entry.deleted = false
    }
    entry.seq ??= 0
    touched.push(entry)
    this.changed()
    return touched
  }
}

function positionAfter(
  op: Op,
  had: string | undefined,
  before: string | null,
  after: string | null,
) {
  if (op.t === 'place') return op.pos
  if ((op.t === 'move' || op.t === 'mkdir' || op.t === 'create') && op.pos !== undefined) {
    return op.pos
  }
  if (op.t === 'move' && before !== after) return undefined
  return had
}

function numbered(name: string, counter: number): string {
  const dot = name.lastIndexOf('.')
  return dot > 0
    ? `${name.slice(0, dot)} ${String(counter)}${name.slice(dot)}`
    : `${name} ${String(counter)}`
}

export interface Settling {
  disk: Disk
  join: (root: string, path: string) => string
  keeps: (id: string) => boolean
  forget: (id: string) => void
  busy?: (id: string) => boolean
}

function aside(path: string, id: string): string {
  return joined(folderOf(path), `.nib-moving-${hash32(id).toString(36)}`)
}

export async function settle(space: SpaceState, how: Settling): Promise<EntryRow[]> {
  const wanted = space.paths()
  const moved = new Set<EntryRow>()
  const root = space.row.root
  const full = (path: string) => how.join(root, path)
  const moves = async (from: string, to: string, kind: FileKind) => {
    try {
      await how.disk.move(full(from), full(to), kind)
      return true
    } catch (error) {
      if (await how.disk.exists(full(from))) return false
      throw error
    }
  }
  const removes = async (path: string, kind: FileKind) => {
    try {
      await how.disk.remove(full(path), kind)
      return true
    } catch (error) {
      if (await how.disk.exists(full(path))) return false
      throw error
    }
  }
  const makes = async (path: string) => {
    try {
      await how.disk.mkdir(full(path))
      return true
    } catch {
      return false
    }
  }

  const busy = how.busy ?? (() => false)
  for (const entry of space.entries.values()) {
    if (!entry.local_path || wanted.has(entry.id) || busy(entry.id)) continue
    if (entry.kind !== 'folder' && how.keeps(entry.id)) continue
    if (entry.kind === 'folder' && holdsKept(space, entry, how)) continue

    if (!inForeignCopy(entry.local_path) && (await how.disk.exists(full(entry.local_path)))) {
      const kind = entry.kind === 'folder' ? 'folder' : 'file'
      if (!(await removes(entry.local_path, kind))) continue
    }
    if (entry.kind === 'folder') forgetUnder(space, entry.local_path, moved, how)
    entry.local_path = ''
    moved.add(entry)
    if (entry.kind !== 'folder') how.forget(entry.id)
  }

  for (let round = 0; round <= space.entries.size; round += 1) {
    const due = [...space.entries.values()]
      .filter((entry) => {
        const want = wanted.get(entry.id)
        if (busy(entry.id)) return false
        return entry.local_path && want !== undefined && entry.local_path !== want
      })
      .sort((a, b) => depth(a.local_path) - depth(b.local_path))
    if (!due.length) break

    const arriving = new Set(
      due.filter((one) => one.kind === 'folder').map((one) => space.key(wanted.get(one.id) ?? '')),
    )
    const waits = (want: string) => {
      for (let at = folderOf(want); at; at = folderOf(at)) {
        if (arriving.has(space.key(at))) return true
      }
      return false
    }
    let progress = 0

    for (const entry of due) {
      const want = wanted.get(entry.id)
      if (want === undefined || entry.local_path === want) continue
      if (waits(want)) continue
      const kind = entry.kind === 'folder' ? 'folder' : 'file'
      if (space.key(want).startsWith(space.key(`${entry.local_path}${SEP}`))) {
        const out = aside(entry.local_path, entry.id)
        if (!(await moves(entry.local_path, out, kind))) continue
        carry(space, entry, out, moved)
        progress += 1
        continue
      }
      const holder = space.at(want)
      if (holder && holder !== entry && busy(holder.id)) continue
      if (holder && holder !== entry) {
        const out = aside(holder.local_path, holder.id)
        const holding = holder.kind === 'folder' ? 'folder' : 'file'
        if (!(await moves(holder.local_path, out, holding))) continue
        carry(space, holder, out, moved)
      } else if (!holder && (await how.disk.exists(full(want)))) {
        continue
      }
      if (!(await makes(folderOf(want)))) continue
      if (!(await moves(entry.local_path, want, kind))) continue
      carry(space, entry, want, moved)
      progress += 1
      if (entry.kind === 'folder') arriving.delete(space.key(want))
    }
    if (!progress) break
  }

  for (const [id, want] of wanted) {
    const entry = space.entries.get(id)
    if (entry?.kind !== 'folder' || entry.local_path) continue
    if (!(await makes(want))) continue
    entry.local_path = want
    moved.add(entry)
  }

  if (moved.size) space.changed()
  return [...moved]
}

function depth(path: string): number {
  return path.split(SEP).length
}

function carry(space: SpaceState, entry: EntryRow, to: string, moved: Set<EntryRow>) {
  const from = entry.local_path
  if (entry.kind === 'folder') {
    const inside = space.key(`${from}${SEP}`)
    for (const one of space.entries.values()) {
      if (one === entry || !one.local_path) continue
      if (!space.key(one.local_path).startsWith(inside)) continue
      one.local_path = `${to}${one.local_path.slice(from.length)}`
      moved.add(one)
    }
  }
  entry.local_path = to
  moved.add(entry)
}

function forgetUnder(space: SpaceState, folder: string, moved: Set<EntryRow>, how: Settling) {
  const inside = space.key(`${folder}${SEP}`)
  for (const one of space.entries.values()) {
    if (!one.local_path || !space.key(one.local_path).startsWith(inside)) continue
    one.local_path = ''
    moved.add(one)
    if (one.kind !== 'folder') how.forget(one.id)
  }
}

function holdsKept(space: SpaceState, folder: EntryRow, how: Settling): boolean {
  const inside = space.key(`${folder.local_path}${SEP}`)
  for (const one of space.entries.values()) {
    if (!one.local_path || !space.key(one.local_path).startsWith(inside)) continue
    if (one.kind !== 'folder' && how.keeps(one.id)) return true
  }
  return false
}
