import { freePath } from '@orden/markdown/paths'
import { type EntryKind, heldName, LONGEST_NAME, type Op, type OpResult, shortened } from './wire'

export interface TreeEntry {
  id: string
  kind: EntryKind
  parent: string | null
  name: string
  deleted: boolean
  seq: number
  docSeq: number
  by?: string
  docBy?: string
  deletedIn?: number
  placedSeq?: number
  placedBy?: string
  changesBy?: Record<string, number>
  pos?: string
}

export interface TreeState {
  readonly entries: Map<string, TreeEntry>
  cursor: number
  readonly done: Map<string, OpResult>
}

export interface OpContext {
  role: 'owner' | 'write' | 'read'
  device?: string
}

export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

export function kindOfName(name: string): Exclude<EntryKind, 'folder'> {
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return 'note'
  if (/\.canvas$/i.test(name)) return 'canvas'
  if (/\.pages$/i.test(name)) return 'pages'
  if (/\.(url|webloc)$/i.test(name)) return 'url'
  if (/\.term$/i.test(name)) return 'term'
  if (/\.chat$/i.test(name)) return 'chat'
  return 'file'
}

export function treeState(entries: Iterable<TreeEntry> = [], cursor = 0): TreeState {
  const map = new Map<string, TreeEntry>()
  let highest = cursor
  for (const entry of entries) {
    map.set(entry.id, entry)
    highest = Math.max(highest, entry.seq, entry.docSeq)
  }
  return { entries: map, cursor: highest, done: new Map() }
}

function tick(state: TreeState): number {
  state.cursor += 1
  return state.cursor
}

function takenIn(state: TreeState, parent: string | null, except: string): Set<string> {
  const taken = new Set<string>()
  for (const entry of state.entries.values()) {
    if (entry.deleted || entry.parent !== parent || entry.id === except) continue
    taken.add(nameKey(entry.name))
  }
  return taken
}

function freeName(
  state: TreeState,
  parent: string | null,
  wanted: string,
  kind: EntryKind,
  except: string,
): string {
  const taken = takenIn(state, parent, except)
  const free = (candidate: string) => !taken.has(nameKey(candidate))
  const first = (name: string): string => {
    if (kind !== 'folder') return freePath(name, (candidate) => !free(candidate))
    if (free(name)) return name
    for (let counter = 2; ; counter += 1) {
      const candidate = `${name} ${String(counter)}`
      if (free(candidate)) return candidate
    }
  }

  let name = heldName(wanted)
  for (;;) {
    const found = first(name)
    if (found.length <= LONGEST_NAME) return found
    name = shortened(name, found.length - LONGEST_NAME, kind)
  }
}

function holds(state: TreeState, ancestor: string, id: string | null): boolean {
  const seen = new Set<string>()
  for (let at = id; at !== null;) {
    if (at === ancestor) return true
    if (seen.has(at)) return true
    seen.add(at)
    at = state.entries.get(at)?.parent ?? null
  }
  return false
}

function changed(state: TreeState, entry: TreeEntry, device: string | undefined, seen?: number) {
  stamped(state, entry, device, seen)
  if (device !== undefined) entry.changesBy = { ...entry.changesBy, [device]: entry.seq }
}

function taken(state: TreeState, entry: TreeEntry, device: string | undefined) {
  stamped(state, entry, device)
  delete entry.changesBy
}

function stamped(state: TreeState, entry: TreeEntry, device: string | undefined, seen?: number) {
  const place = placing(entry)
  const unseen =
    seen !== undefined && place.seq > seen && place.by !== undefined && place.by !== device
  entry.seq = tick(state)
  if (unseen) {
    if (place.by !== undefined) entry.by = place.by
    return
  }
  if (device === undefined) delete entry.by
  else entry.by = device
}

function revive(state: TreeState, entry: TreeEntry, device: string | undefined) {
  if (!entry.deleted) return
  entry.name = freeName(state, entry.parent, entry.name, entry.kind, entry.id)
  entry.deleted = false
  delete entry.deletedIn
  changed(state, entry, device)
}

function reviveAbove(state: TreeState, parent: string | null, device: string | undefined) {
  const chain: TreeEntry[] = []
  const seen = new Set<string>()
  for (let at = parent; at !== null && !seen.has(at);) {
    seen.add(at)
    const folder = state.entries.get(at)
    if (!folder) break
    chain.push(folder)
    at = folder.parent
  }
  for (const folder of chain.reverse()) revive(state, folder, device)
}

function isPlace(state: TreeState, parent: string | null): boolean {
  if (parent === null) return true
  return state.entries.get(parent)?.kind === 'folder'
}

function placement(op: Op, entry: TreeEntry): OpResult {
  return { op: op.op, ok: true, id: entry.id, parent: entry.parent, name: entry.name }
}

function under(state: TreeState, folder: string): TreeEntry[] {
  const children = new Map<string, TreeEntry[]>()
  for (const entry of state.entries.values()) {
    if (entry.parent === null) continue
    const list = children.get(entry.parent) ?? []
    list.push(entry)
    children.set(entry.parent, list)
  }

  const out: TreeEntry[] = []
  const seen = new Set<string>([folder])
  const walk = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      if (child.kind === 'folder') walk(child.id)
    }
  }
  walk(folder)
  return out
}

function othersAfter(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  return Object.entries(entry.changesBy ?? {}).some(([by, at]) => by !== device && at > seen)
}

function writtenSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const byOther = (by: string | undefined) => device === undefined || by !== device
  return entry.docSeq > seen && byOther(entry.docBy)
}

function placing(entry: TreeEntry): { seq: number; by: string | undefined } {
  const wordsLast = entry.seq === entry.docSeq && entry.placedSeq !== undefined
  return wordsLast
    ? { seq: entry.placedSeq ?? entry.seq, by: entry.placedBy }
    : { seq: entry.seq, by: entry.by }
}

function changedSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const place = placing(entry)
  const byOther = device === undefined || place.by !== device
  return (
    (place.seq > seen && byOther) ||
    writtenSince(entry, seen, device) ||
    othersAfter(entry, seen, device)
  )
}

function othersSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const place = placing(entry)
  const byOther = place.by !== undefined && (device === undefined || place.by !== device)
  return (
    (place.seq > seen && byOther) ||
    writtenSince(entry, seen, device) ||
    othersAfter(entry, seen, device)
  )
}

class Rules {
  constructor(
    private readonly state: TreeState,
    private readonly device: string | undefined,
  ) {}

  made(
    op: Op,
    id: string,
    kind: EntryKind,
    parent: string | null,
    wanted: string,
    pos?: string,
  ): OpResult {
    const { state, device } = this
    const existing = state.entries.get(id)
    if (existing) return existing.deleted ? { op: op.op, refused: 'gone' } : placement(op, existing)
    if (!isPlace(state, parent)) return { op: op.op, refused: 'gone' }

    reviveAbove(state, parent, device)
    const entry: TreeEntry = {
      id,
      kind,
      parent,
      name: freeName(state, parent, wanted, kind, id),
      deleted: false,
      seq: 0,
      docSeq: 0,
    }
    if (pos !== undefined) entry.pos = pos
    changed(state, entry, device)
    state.entries.set(id, entry)
    return placement(op, entry)
  }

  merged(op: Op & { t: 'create' }): OpResult | null {
    if (!op.mergeable) return null
    const key = nameKey(op.name)
    for (const one of this.state.entries.values()) {
      if (one.deleted || one.parent !== op.parent || one.kind !== op.kind) continue
      if (one.id !== op.id && nameKey(one.name) === key) return { op: op.op, merged: one.id }
    }
    return null
  }

  target(op: Op & { id: string }): TreeEntry | OpResult {
    const entry = this.state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (!entry.deleted) return entry
    if (entry.seq <= op.seen) return { op: op.op, refused: 'gone' }

    reviveAbove(this.state, entry.parent, this.device)
    revive(this.state, entry, this.device)
    return entry
  }

  renamed(op: Op & { t: 'rename' }): OpResult {
    const entry = this.target(op)
    if (!isEntry(entry)) return entry
    const name = freeName(this.state, entry.parent, op.name, entry.kind, entry.id)
    if (name !== entry.name) {
      entry.name = name
      changed(this.state, entry, this.device, op.seen)
    }
    return placement(op, entry)
  }

  moved(op: Op & { t: 'move' }): OpResult {
    const { state, device } = this
    const current = state.entries.get(op.id)
    if (!current || !isPlace(state, op.parent)) return { op: op.op, refused: 'gone' }
    if (current.kind === 'folder' && holds(state, current.id, op.parent)) {
      return { op: op.op, refused: 'cycle' }
    }

    const entry = this.target(op)
    if (!isEntry(entry)) return entry
    reviveAbove(state, op.parent, device)
    const name = freeName(state, op.parent, op.name ?? entry.name, entry.kind, entry.id)
    const pos = op.pos ?? (op.parent === entry.parent ? entry.pos : undefined)
    if (name !== entry.name || op.parent !== entry.parent || pos !== entry.pos) {
      entry.name = name
      entry.parent = op.parent
      if (pos === undefined) delete entry.pos
      else entry.pos = pos
      changed(state, entry, device, op.seen)
    }
    return placement(op, entry)
  }

  placed(op: Op & { t: 'place' }): OpResult {
    const entry = this.state.entries.get(op.id)
    if (!entry || entry.deleted) return { op: op.op, refused: 'gone' }
    if (entry.pos !== op.pos) {
      entry.pos = op.pos
      changed(this.state, entry, this.device, op.seen)
    }
    return placement(op, entry)
  }

  deleted(op: Op & { t: 'delete' }): OpResult {
    const { state, device } = this
    const entry = state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (entry.deleted) return { op: op.op, ok: true }

    if (entry.kind !== 'folder') {
      if (othersSince(entry, op.seen, device)) return { op: op.op, refused: 'edited' }
      entry.deleted = true
      taken(state, entry, device)
      entry.deletedIn = entry.seq
      return { op: op.op, ok: true }
    }

    if (othersSince(entry, op.seen, device)) return { op: op.op, refused: 'edited' }

    const inside = under(state, entry.id).filter((one) => !one.deleted)
    const kept = new Set<string>()
    for (const one of inside) {
      if (!changedSince(one, op.seen, device)) continue
      for (let at: string | null = one.id; at !== null && !kept.has(at);) {
        kept.add(at)
        at = state.entries.get(at)?.parent ?? null
      }
    }

    const batch = state.cursor + 1
    for (const one of inside.reverse()) {
      if (kept.has(one.id)) continue
      one.deleted = true
      one.deletedIn = batch
      taken(state, one, device)
    }

    if (kept.has(entry.id)) return { op: op.op, refused: 'edited' }
    entry.deleted = true
    entry.deletedIn = batch
    taken(state, entry, device)
    return { op: op.op, ok: true }
  }

  restored(op: Op & { t: 'restore' }): OpResult {
    const { state, device } = this
    const entry = state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    if (!entry.deleted) {
      changed(state, entry, device)
      return placement(op, entry)
    }

    const batch = entry.deletedIn
    reviveAbove(state, entry.parent, device)
    revive(state, entry, device)

    if (entry.kind === 'folder' && batch !== undefined) {
      for (const one of under(state, entry.id)) {
        if (one.deleted && one.deletedIn === batch) revive(state, one, device)
      }
    }
    return placement(op, entry)
  }

  applied(op: Op): OpResult {
    switch (op.t) {
      case 'mkdir':
        return this.made(op, op.id, 'folder', op.parent, op.name, op.pos)
      case 'create':
        return this.merged(op) ?? this.made(op, op.id, op.kind, op.parent, op.name, op.pos)
      case 'rename':
        return this.renamed(op)
      case 'move':
        return this.moved(op)
      case 'delete':
        return this.deleted(op)
      case 'restore':
        return this.restored(op)
      case 'place':
        return this.placed(op)
    }
  }
}

function isEntry(value: TreeEntry | OpResult): value is TreeEntry {
  return 'kind' in value
}

export function applyOp(state: TreeState, op: Op, context: OpContext): OpResult {
  const before = state.done.get(op.op)
  if (before) return before

  const result: OpResult =
    context.role === 'read'
      ? { op: op.op, refused: 'role' }
      : new Rules(state, context.device).applied(op)
  state.done.set(op.op, result)
  return result
}

export function contentChanged(state: TreeState, id: string, device?: string): number {
  const entry = state.entries.get(id)
  if (!entry) return state.cursor
  const revived = entry.deleted
  if (revived) {
    reviveAbove(state, entry.parent, device)
    revive(state, entry, device)
  }
  if (entry.seq !== entry.docSeq || entry.placedSeq === undefined) {
    entry.placedSeq = entry.seq
    if (entry.by === undefined || revived) delete entry.placedBy
    else entry.placedBy = entry.by
  }
  changed(state, entry, device)
  entry.docSeq = entry.seq
  if (device === undefined) delete entry.docBy
  else entry.docBy = device
  return entry.seq
}
