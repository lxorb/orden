/** A space's tree, and the rules every tree operation is applied by.
 *
 *  In sync v2 folders are rows with ids, and renaming or moving something is an
 *  operation on its id rather than a delete of one path and a create of another, so
 *  a note keeps its history, its document and its place in everybody's tabs however
 *  it is renamed while apart (docs/sync-v2.md section 5.9, road 6 in section 1).
 *  The account applies operations in the order they arrive and answers each with
 *  what became of it; devices apply the account's feed in the same order and so
 *  converge on it. A device also applies its own operations at once, optimistically,
 *  with this same function, so what it shows and what the account will decide are
 *  the same rules.
 *
 *  The rules, in the order they come up:
 *
 *  - **Names are unique per folder**, compared as Windows and macOS compare them:
 *    after NFC normalisation and without case (`nameKey`). A name that is taken is
 *    numbered the way the file list numbers a duplicate, `Plan 2.md`.
 *  - **A mergeable create** ("this note, if it is not there yet": the append action,
 *    the journal) that lands on a live note of the same name is answered `merged`
 *    with that note's id, and the device merges its words into it.
 *  - **An edit beats a delete, and so does anything else the deleting device had not
 *    seen.** A delete takes only what its device had seen: a note another device wrote
 *    in, restored, renamed or moved after the delete's `seen` is not deleted (`edited`),
 *    and a folder delete leaves what was made, moved in, renamed, restored or written in
 *    since, which keeps the folder. A restore is a person asking for the note back; a
 *    delete that never knew of it does not undo that (#1068).
 *    A content change landing on a deleted note brings it back.
 *  - **A move or a create into a deleted folder brings the folder back**, with its
 *    ancestors.
 *  - **A move that would put a folder inside itself** is refused (`cycle`): with the
 *    account serialising, refusing the second of two crossing moves is enough.
 *  - **Tree operations are last-writer-wins by arrival**: the later of two renames
 *    stands, and a rename or move of something deleted after its device last looked
 *    brings it back, as a delete after a rename deletes it.
 *
 *  Nothing here reads a clock or a disk. The state is plain data the Worker loads for
 *  a batch and writes back, and the only numbers that move are the space's cursor. */

import { freePath } from '@orden/markdown/paths'
import { type EntryKind, heldName, LONGEST_NAME, type Op, type OpResult, shortened } from './wire'

export interface TreeEntry {
  id: string
  kind: EntryKind
  /** The folder it is in, or null at the top of the space. */
  parent: string | null
  name: string
  deleted: boolean
  /** The space's cursor at its latest change of any sort. */
  seq: number
  /** The cursor at its latest content change, 0 for none. */
  docSeq: number
  /** The devices that made its latest change of any sort, and its latest content
   *  change. A device's own writing never stands against its own delete: it had
   *  seen it, whatever its cursor says. */
  by?: string
  docBy?: string
  /** The cursor of the delete that took it, so a folder restored brings back what
   *  was deleted with it and nothing that was deleted before. */
  deletedIn?: number
  /** Where its latest change was to its words: the cursor and the device of the change
   *  before them that was to its place - made, renamed, moved, deleted or restored - so a
   *  folder delete can tell who put it where it is from who wrote in it last (#1068).
   *  Nothing where its latest change was to its place, which `seq` and `by` then say. */
  placedSeq?: number
  placedBy?: string
  /** The cursor of each device's latest change to it, a delete aside, kept until a
   *  delete takes it. `by` names only the last of them, and a device's own change since
   *  must not hide another's from its delete (#1068). */
  changesBy?: Record<string, number>
  /** Where somebody put it among the others in its folder, by hand (order.ts); nothing
   *  where nobody has, and then it stands after every entry that has one. */
  pos?: string
}

export interface TreeState {
  readonly entries: Map<string, TreeEntry>
  /** The space's cursor: every change takes the next number. */
  cursor: number
  /** What each op id was answered with: an op seen before answers the same again. */
  readonly done: Map<string, OpResult>
}

/** Who is asking, which is all the rules need to know about them. */
export interface OpContext {
  role: 'owner' | 'write' | 'read'
  /** The device the op came from. */
  device?: string
}

/** A name as a folder compares it: NFC, and without case. Two names with one key
 *  cannot both live in one folder on Windows or on a Mac, so they cannot on the
 *  account either. */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

/** What an entry is, read off its name: the one rule the app and the account both
 *  read a name by, so a file made on one is the same kind on the other. Anything that
 *  is not one of the document kinds, an online terminal's `.term` or a chat's `.chat`,
 *  is a file. A chat is found by the id its pointer's words name, never by this entry
 *  (docs/chats.md 4.2): the kind only says what the file is. */
export function kindOfName(name: string): Exclude<EntryKind, 'folder'> {
  if (/\.(md|markdown|mdown|mkd)$/i.test(name)) return 'note'
  if (/\.canvas$/i.test(name)) return 'canvas'
  if (/\.pages$/i.test(name)) return 'pages'
  if (/\.(url|webloc)$/i.test(name)) return 'url'
  if (/\.term$/i.test(name)) return 'term'
  if (/\.chat$/i.test(name)) return 'chat'
  return 'file'
}

/** A tree to apply operations to: the entries a space holds, and its cursor. */
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

/** The names already taken in a folder, as keys, leaving out one entry: the one being
 *  placed, which never collides with itself. */
function takenIn(state: TreeState, parent: string | null, except: string): Set<string> {
  const taken = new Set<string>()
  for (const entry of state.entries.values()) {
    if (entry.deleted || entry.parent !== parent || entry.id === except) continue
    taken.add(nameKey(entry.name))
  }
  return taken
}

/** The first spelling of `wanted` free in a folder. A file steps aside the way the
 *  file list steps it, the number before the extension (`freePath`); a folder has no
 *  extension, so a dot in its name is a dot. */
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

/** Whether `ancestor` is `id` or holds it, however deep. Deleted folders count: a
 *  parent pointer is a parent pointer, and a cycle through a deleted folder is still
 *  a cycle the day it is restored. */
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

/** One change to an entry: it takes the next cursor, and says which device made it.
 *
 *  Unless the device made it without having seen the change before it, which another
 *  device made after `seen`: then that device's word stands. `by` is what tells a
 *  folder delete that an entry is the deleting device's own to take, and a rename made
 *  offline of a note another device had meanwhile moved into a folder took that over -
 *  the folder deleted next, from the same device that never saw the note in it, took the
 *  note and its words (#514). */
function changed(state: TreeState, entry: TreeEntry, device: string | undefined, seen?: number) {
  stamped(state, entry, device, seen)
  if (device !== undefined) entry.changesBy = { ...entry.changesBy, [device]: entry.seq }
}

/** A delete that stands: it had seen every change it takes, so none of them stands
 *  against the next delete once something brings the entry back. */
function taken(state: TreeState, entry: TreeEntry, device: string | undefined) {
  stamped(state, entry, device)
  delete entry.changesBy
}

function stamped(state: TreeState, entry: TreeEntry, device: string | undefined, seen?: number) {
  // Its place as its placer left it: words written in since do not make their writer the
  // one whose move this device had seen (#1068).
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

/** Brings an entry back where it was, renumbered if its name was taken meanwhile. */
function revive(state: TreeState, entry: TreeEntry, device: string | undefined) {
  if (!entry.deleted) return
  entry.name = freeName(state, entry.parent, entry.name, entry.kind, entry.id)
  entry.deleted = false
  delete entry.deletedIn
  changed(state, entry, device)
}

/** Brings back every deleted folder above a place, top first, so each is named among
 *  siblings that are already back. */
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

/** Whether a place can hold things: the top of the space, or a folder the account
 *  has (deleted or not: a deleted one comes back). */
function isPlace(state: TreeState, parent: string | null): boolean {
  if (parent === null) return true
  return state.entries.get(parent)?.kind === 'folder'
}

function placement(op: Op, entry: TreeEntry): OpResult {
  return { op: op.op, ok: true, id: entry.id, parent: entry.parent, name: entry.name }
}

/** Everything under a folder, however deep, in tree order: parents before children. */
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

/** Whether a device other than the deleting one changed the entry after `seen`, even
 *  where a change of the deleting device's came after that. */
function othersAfter(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  return Object.entries(entry.changesBy ?? {}).some(([by, at]) => by !== device && at > seen)
}

/** Whether something written after `seen` by another device stands against a delete. */
function writtenSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const byOther = (by: string | undefined) => device === undefined || by !== device
  return entry.docSeq > seen && byOther(entry.docBy)
}

/** The latest change to an entry's place: its cursor and its device. The entry's own
 *  `seq` and `by` where that was its latest change of any sort, and what was kept of it
 *  when words were written in since (`placedSeq`). An entry from before that was kept
 *  answers as it always did. */
function placing(entry: TreeEntry): { seq: number; by: string | undefined } {
  const wordsLast = entry.seq === entry.docSeq && entry.placedSeq !== undefined
  return wordsLast
    ? { seq: entry.placedSeq ?? entry.seq, by: entry.placedBy }
    : { seq: entry.seq, by: entry.by }
}

/** Whether a delete of the folder around an entry has to leave it: something about it
 *  changed after `seen`, by another device. Its place as its placer left it, and its
 *  words as their writer did: a device that wrote in a note somebody else moved into the
 *  folder had still never seen it there, and its folder delete leaves it (#1068). */
function changedSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const place = placing(entry)
  const byOther = device === undefined || place.by !== device
  return (
    (place.seq > seen && byOther) ||
    writtenSince(entry, seen, device) ||
    othersAfter(entry, seen, device)
  )
}

/** Whether a delete of the entry itself has to leave it: another device wrote in it,
 *  restored, renamed or moved it after `seen` (#1068). Only a device's change counts:
 *  the account's own bookkeeping - folders it made from paths when the space moved to
 *  v2 - is nobody's word against a delete. */
function othersSince(entry: TreeEntry, seen: number, device: string | undefined): boolean {
  const place = placing(entry)
  const byOther = place.by !== undefined && (device === undefined || place.by !== device)
  return (
    (place.seq > seen && byOther) ||
    writtenSince(entry, seen, device) ||
    othersAfter(entry, seen, device)
  )
}

/** The rules, with one op's device in hand. */
class Rules {
  constructor(
    private readonly state: TreeState,
    private readonly device: string | undefined,
  ) {}

  /** Places a new entry: its parent brought back if it was deleted, its name
   *  numbered if taken. */
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

  /** A mergeable create: the live note of that name in that folder, if there is one. */
  merged(op: Op & { t: 'create' }): OpResult | null {
    if (!op.mergeable) return null
    const key = nameKey(op.name)
    for (const one of this.state.entries.values()) {
      if (one.deleted || one.parent !== op.parent || one.kind !== op.kind) continue
      if (one.id !== op.id && nameKey(one.name) === key) return { op: op.op, merged: one.id }
    }
    return null
  }

  /** The entry an op on an existing id acts on, brought back first if it was deleted
   *  after its device last looked, or the refusal. */
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
    // A move that does not say where it was dropped keeps the position it had only in
    // the folder it had it in: carried elsewhere, it stands with the unplaced.
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

  /** Put somewhere else in its folder (#1068). The later of two such to arrive stands,
   *  as with a rename; two moved into one gap stand side by side, the ids between them.
   *  Nothing to put where the entry is gone. */
  placed(op: Op & { t: 'place' }): OpResult {
    const entry = this.state.entries.get(op.id)
    if (!entry || entry.deleted) return { op: op.op, refused: 'gone' }
    if (entry.pos !== op.pos) {
      entry.pos = op.pos
      changed(this.state, entry, this.device, op.seen)
    }
    return placement(op, entry)
  }

  /** A delete, with the edit-beats-delete rule. */
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

    // A folder another device brought back, renamed or moved since stays whole, as a
    // note does (#1068).
    if (othersSince(entry, op.seen, device)) return { op: op.op, refused: 'edited' }

    // What the deleting device had not seen stays, and so does every folder between
    // it and the one deleted.
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

  /** A restore: the entry, the folders above it, and for a folder everything that
   *  was deleted with it. */
  restored(op: Op & { t: 'restore' }): OpResult {
    const { state, device } = this
    const entry = state.entries.get(op.id)
    if (!entry) return { op: op.op, refused: 'gone' }
    // Back already, by somebody else's restore: still a person asking for it, and noted
    // as a change of theirs - whatever they had seen - so a delete that had not seen this
    // one leaves it (#1068).
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

/** Applies one operation, in arrival order, and answers what became of it. The same
 *  op id is answered the same way however often it arrives. */
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

/** A document's content changed: it takes the next cursor as its `docSeq`, and a note
 *  somebody deleted while this was being written comes back, with its folders.
 *  Answers the cursor it took. */
export function contentChanged(state: TreeState, id: string, device?: string): number {
  const entry = state.entries.get(id)
  if (!entry) return state.cursor
  if (entry.deleted) {
    reviveAbove(state, entry.parent, device)
    revive(state, entry, device)
  }
  // Who last put it where it is, kept before the words make their writer its last changer.
  if (entry.seq !== entry.docSeq || entry.placedSeq === undefined) {
    entry.placedSeq = entry.seq
    if (entry.by === undefined) delete entry.placedBy
    else entry.placedBy = entry.by
  }
  changed(state, entry, device)
  entry.docSeq = entry.seq
  if (device === undefined) delete entry.docBy
  else entry.docBy = device
  return entry.seq
}
