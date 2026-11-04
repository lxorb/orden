/** A space's tree as this device holds it, and where each entry is on this disk.
 *
 *  Two trees are kept in one table. What the account has said - the feed, and the
 *  answers to this device's own ops - is each entry's row. What the person sees is
 *  that, with every op still waiting in the outbox applied on top by the very rules the
 *  account applies them by (`applyOp` in @orden/sync-core/tree), so a rename made offline
 *  is a rename at once and the account's answer only ever corrects it (section 5.9).
 *
 *  Where an entry is on the disk is its `local_path`, relative to the space's root.
 *  Usually that is its names from the top down; a name this platform cannot hold (`CON`,
 *  `a:b`, a trailing dot on Windows) is spelled another way here and nowhere else, so the
 *  account never sees the local spelling. `settle` makes the disk agree with the shown
 *  tree: moves, folders made, and files the account deleted taken away - unless this
 *  device has written in them since, when the edit beats the delete and they stay. */

import { type OpResult, type Op } from '@orden/sync-core/wire'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { hash32 } from '@orden/sync-core/seed'
import { byPosition } from '@orden/sync-core/order'
import { applyOp, nameKey, type TreeEntry, type TreeState, treeState } from '@orden/sync-core/tree'
import { isReserved } from '../naming'
import type { Gone, Ordering, Outgoing } from './records'
import type { EntryRow, OutboxRow, SpaceRow } from './store'
import type { Disk, FileKind, World } from './world'

/** One row of the outbox, read. */
export interface Outboxed {
  row: OutboxRow
  record: Outgoing
}

/** Folder paths join with this, whatever the platform: the world joins them onto a
 *  root in its own spelling. */
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

/** What Windows holds in no name, beside the control characters. */
const FORBIDDEN = '<>:"\\|?*'

/** How a name is spelled on this disk: as the account writes it, unless this platform
 *  cannot hold it. */
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

/** Whether a root is a Windows path, the one place `\\` is a separator. Anywhere else it is
 *  a character of a name. */
export function windowsPath(root: string): boolean {
  return /^[a-zA-Z]:/.test(root) || root.includes('\\')
}

export class SpaceState {
  entries: Map<string, EntryRow>
  outbox: Outboxed[]
  /** Whether the account keeps where each entry was put among the rest of its folder,
   *  and where it has each that somebody put somewhere (#1068; `Ordering` in
   *  records.ts). Off until the feed says so: an account from before positions is sent
   *  none. */
  ordering: Ordering
  /** Where what this device deleted was on this disk (`Gone` in records.ts). */
  gone: Gone = new Map()
  /** When the files held in step here were last checked against what the account
   *  keeps; see `recoverLost` in files.ts. Never, at launch. */
  lostCheckedAt = -Infinity
  private shownCache: TreeState | null = null
  private pathsCache: Map<string, string> | null = null
  private placedCache: Map<string, { folder: string; names: string[] }> | null = null

  constructor(
    public row: SpaceRow,
    entries: readonly EntryRow[],
    outbox: readonly Outboxed[],
    private readonly device: string,
    private readonly world: Pick<World, 'platform' | 'foldsCase'>,
    ordering: Ordering = { on: false, positions: new Map() },
  ) {
    this.entries = new Map(entries.map((entry) => [entry.id, entry]))
    this.outbox = [...outbox]
    this.ordering = ordering
  }

  get id(): string {
    return this.row.space_id
  }

  /** Something about the tree changed: what is shown is worked out again when next
   *  asked. */
  changed() {
    this.shownCache = null
    this.pathsCache = null
    this.placedCache = null
  }

  /** The tree the account has confirmed: every entry it has named, as it named it. */
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
        ...this.positionOf(entry.id),
      })
    }
    return treeState(entries, this.row.cursor)
  }

  private positionOf(id: string): { pos?: string } {
    const pos = this.ordering.positions.get(id)
    return pos === undefined ? {} : { pos }
  }

  /** What the person sees: the confirmed tree with every waiting op applied. A day's
   *  note waiting to be made keeps its own place here even where the account will
   *  merge it into one of the same name: until it answers, both are on the disk. */
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

  /** Where every live entry of the shown tree goes on this disk, relative to the root. */
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
        // Two account names one spelling here: the later id steps aside.
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

  /** The rows somebody put somewhere in each folder, by the folder's path as this disk
   *  compares paths (`key`): the folder's path, and the rows' names on this disk in the
   *  order their places put them (#1068). Only folders with such a row are here. */
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

  /** The live entries of the shown tree in a folder, by their name on this disk. */
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

  /** How a name the account holds is spelled on this disk. */
  spelled(name: string): string {
    return localName(name, this.world.platform)
  }

  /** How this disk compares two paths. */
  key(path: string): string {
    return this.world.foldsCase ? nameKey(path) : path.normalize('NFC')
  }

  /** The entry whose file is at `path` on this disk now. */
  at(path: string): EntryRow | null {
    const wanted = this.key(path)
    for (const entry of this.entries.values()) {
      if (entry.local_path && this.key(entry.local_path) === wanted) return entry
    }
    return null
  }

  /** The folder id a local folder path names: null for the top of the space. Undefined
   *  for a folder this tree does not have. */
  folderAt(path: string): string | null | undefined {
    if (!path) return null
    const entry = this.at(path)
    return entry?.kind === 'folder' && !entry.deleted ? entry.id : undefined
  }

  /** Whether an entry is another sync tool's copy, or inside one: sync v2 never carries
   *  one either way (@orden/sync-core/foreign, docs/sync-v2.md "Other sync tools"). By
   *  where it is shown, else where it last was on this disk. */
  foreign(id: string): boolean {
    const path = this.paths().get(id) ?? this.entries.get(id)?.local_path ?? ''
    return inForeignCopy(path)
  }

  /** Whether an entry is live in what the person sees. */
  isLive(id: string): boolean {
    const entry = this.shown().entries.get(id)
    return entry !== undefined && !entry.deleted
  }

  /** An op this device made, applied to what it sees at once and waiting to go up. */
  queue(one: Outboxed) {
    this.outbox.push(one)
    this.changed()
  }

  /** Where an op the account applied leaves the entry among the rest of its folder.
   *  Answers whether that changed. */
  placedBy(op: Op, before: string | null, after: string | null): boolean {
    const had = this.ordering.positions.get(op.id)
    const pos = positionAfter(op, had, before, after)
    if (pos === had) return false
    if (pos === undefined) this.ordering.positions.delete(op.id)
    else this.ordering.positions.set(op.id, pos)
    this.repositioned = true
    return true
  }

  /** Whether a place changed since the store was last told (`orderingRow`). */
  repositioned = false

  /** What an op the account answered makes of an entry's row: where it ended up, or that
   *  it is gone. Answers the rows that changed. */
  answered(op: Op, result: OpResult): EntryRow[] {
    const touched: EntryRow[] = []
    if ('refused' in result || 'merged' in result) return touched
    const entry = this.entries.get(op.id)
    if (!entry) return touched
    if (op.t === 'delete') {
      entry.deleted = true
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

/** The position an op the account applied leaves its entry with, by the rule the
 *  account applies (`placed` and `moved` in @orden/sync-core/tree): a place or a drop
 *  says where, a rename keeps it, a move to another folder that does not say leaves
 *  it behind. Until the feed says it again, which it does. */
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

/** What settling a space's disk needs besides the disk. */
export interface Settling {
  disk: Disk
  join: (root: string, path: string) => string
  /** Whether this device has written in a document the account no longer shows, or is
   *  holding it: then its file stays, and the push brings it back. */
  keeps: (id: string) => boolean
  /** A document this device will not hear of again: its rows go. */
  forget: (id: string) => void
}

/** A path nothing here uses yet, beside `path`: where a file waits while another takes
 *  its place. Named by a hash of the id, which is whatever the entry's maker sent: spelled
 *  as it came, `../../Private/AGENTS.md` waited in another space. Should two ever meet,
 *  the second move is refused and tried again next pass. */
function aside(path: string, id: string): string {
  return joined(folderOf(path), `.nib-moving-${hash32(id).toString(36)}`)
}

/** Makes the disk agree with what is shown. Answers the entries whose `local_path`
 *  changed, which the caller writes down.
 *
 *  Files the account deleted go first, so a name they held is free; then every move,
 *  shallow before deep, a folder carrying what is in it; then folders that are new. A
 *  move onto a path another entry still holds waits aside under a name of its own until
 *  that entry has moved on. Documents new to this device are written by the pull that
 *  brings their words, not here. */
export async function settle(space: SpaceState, how: Settling): Promise<EntryRow[]> {
  const wanted = space.paths()
  const moved = new Set<EntryRow>()
  const root = space.row.root
  const full = (path: string) => how.join(root, path)
  // A move the disk refuses leaves that one entry where it is, the way a file in the
  // way does, and the rest of the pass goes on; it is tried again next pass. Thrown,
  // it stopped every pass before anything else came or went. Only while the file is
  // still where it was: one that left without being told is not known to be anywhere,
  // and a pass that went on would read it as deleted here.
  const moves = async (from: string, to: string, kind: FileKind) => {
    try {
      await how.disk.move(full(from), full(to), kind)
      return true
    } catch (error) {
      if (await how.disk.exists(full(from))) return false
      throw error
    }
  }
  // The same for a delete the disk refuses, a file another program holds open: it stays
  // known where it is, so the next pass tries again rather than reading it as made here.
  const removes = async (path: string, kind: FileKind) => {
    try {
      await how.disk.remove(full(path), kind)
      return true
    } catch (error) {
      if (await how.disk.exists(full(path))) return false
      throw error
    }
  }
  // And a folder the disk will not make: whatever was going into it waits with it.
  const makes = async (path: string) => {
    try {
      await how.disk.mkdir(full(path))
      return true
    } catch {
      return false
    }
  }

  for (const entry of space.entries.values()) {
    if (!entry.local_path || wanted.has(entry.id)) continue
    if (entry.kind !== 'folder' && how.keeps(entry.id)) continue
    // A folder goes once nothing it holds is staying.
    if (entry.kind === 'folder' && holdsKept(space, entry, how)) continue

    // Another sync tool's copy stays: the account letting go of one is not anybody
    // deleting a file, and the tool that made it would carry a delete to every disk.
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
        return entry.local_path && want !== undefined && entry.local_path !== want
      })
      .sort((a, b) => depth(a.local_path) - depth(b.local_path))
    if (!due.length) break

    // The folders still on their way to a new name. Something going into one of them
    // waits for it: made first, the folder found its own new name taken, and waited
    // on every pass while its notes went one by one.
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
        // Wanted inside where it is now: a new folder took its old name. No disk moves
        // a folder into itself, so it steps aside and goes on in the next round.
        const out = aside(entry.local_path, entry.id)
        if (!(await moves(entry.local_path, out, kind))) continue
        carry(space, entry, out, moved)
        progress += 1
        continue
      }
      const holder = space.at(want)
      if (holder && holder !== entry) {
        // Somebody else is still there: it waits aside, and moves on in its own turn.
        const out = aside(holder.local_path, holder.id)
        const holding = holder.kind === 'folder' ? 'folder' : 'file'
        if (!(await moves(holder.local_path, out, holding))) continue
        carry(space, holder, out, moved)
      } else if (!holder && (await how.disk.exists(full(want)))) {
        // A file this tree does not know about is in the way. Left where it is; the
        // entry stays where it was until that file has become an entry of its own.
        continue
      }
      if (!(await makes(folderOf(want)))) continue
      if (!(await moves(entry.local_path, want, kind))) continue
      carry(space, entry, want, moved)
      progress += 1
      if (entry.kind === 'folder') arriving.delete(space.key(want))
    }
    // Nothing moved, so nothing will: what is left waits on the disk, not on a round.
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

/** An entry now at `to`, and everything under it if it is a folder. */
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

/** Everything under a folder that was taken off the disk is off the disk, and a
 *  document in it is one this device will not hear of again. */
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
