/** What this device does to a space's tree, told to the account as operations on ids
 *  (docs/sync-v2.md sections 5.9 and 5.13).
 *
 *  A move, a rename or a delete arrives before the disk has it (`moving` and `removing`
 *  in engine.ts, `intended` here), a file made after - and anything another program did,
 *  after (`watching.ts`) - so the entry takes its new place here, the op waits in the
 *  outbox, and what is shown is the tree with the op applied, exactly as the account
 *  will apply it.
 *
 *  **A new note is a document from its first character.** A tab with no file has no id
 *  and nothing to sync (lane `unsaved-tabs`: its words are this device's session and
 *  nothing else); the moment it is given a place it is a file, and that moment makes its
 *  id here, a document holding its words as this device's pending edits, and a queued
 *  `create`. Nobody waits for the account to hand out an id. A name that follows the
 *  first line while it is typed is a run of renames the outbox folds into one, or into
 *  the create itself if that has not gone yet (`coalesce`).
 *
 *  **A day's note is made if it is not there yet.** The append action makes it with
 *  `mergeable` and the text it started from, and when two devices made it apart the
 *  account answers `merged` and the pass folds this device's words into the one that
 *  was there, three ways against that text (section 5.9). */

import { carriedOwn } from '@orden/bases/inbox'
import { fileMade } from './files'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { kindOfName } from '@orden/sync-core/tree'
import type { EntryKind, Op } from '@orden/sync-core/wire'
import type { Core } from './core'
import { MINE } from './docs'
import { holdsDocument, shapeOf, turn } from './kinds'
import { folderOf, joined, nameOf, SEP, type SpaceState } from './places'
import { wrote } from './project'
import { GONE_KEPT, goneRow, outgoingBytes } from './records'
import { put, remove, type Change, type EntryRow } from './store'

/** What an entry is, read off its name: sync-core's rule, which the account reads by too. */
export { kindOfName }

/** An id no other device will ever make: 128 random bits. */
function freshId(core: Core): string {
  let out = ''
  for (let part = 0; part < 4; part += 1) {
    out += Math.floor(core.world.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  }
  return out
}

function queue(core: Core, space: SpaceState, op: Op): Change[] {
  const { one, change } = core.outgoing(space, { t: 'op', op }, op.seen)
  space.queue(one)
  return [change, core.counterRow()]
}

/** The folder at a local path, made here first (with every folder above it) when the
 *  tree does not have it: a folder another program made and filled in one go. */
function folderFor(core: Core, space: SpaceState, path: string, changes: Change[]): string | null {
  const known = space.folderAt(path)
  if (known !== undefined) return known
  const parent = folderFor(core, space, folderOf(path), changes)
  const id = freshId(core)
  const name = nameOf(path)
  space.entries.set(id, entryRow(space, id, 'folder', parent, name, path))
  changes.push(put('entries', entryRow(space, id, 'folder', parent, name, path)))
  changes.push(
    ...queue(core, space, {
      op: core.nextId('o'),
      t: 'mkdir',
      id,
      parent,
      name,
      seen: space.row.cursor,
    }),
  )
  return id
}

function entryRow(
  space: SpaceState,
  id: string,
  kind: EntryKind,
  parent: string | null,
  name: string,
  path: string,
): EntryRow {
  return {
    id,
    space_id: space.id,
    kind,
    parent,
    name,
    local_path: path,
    file_key: null,
    written_hash: null,
    mtime: null,
    size: null,
    seq: null,
    deleted: false,
  }
}

export interface Made {
  /** Where the file is, relative to the space's root. */
  path: string
  folder: boolean
  /** The words it was made with. */
  text?: string
  /** For a day's note made by the append action: the text it started from. */
  mergeable?: string
  /** Made again under the id it had: something this device deleted before the account
   *  heard of it, back from the trash (`restored`) - and as the kind it was, which a
   *  rename may have left its name no longer saying. Or the id it had while the space
   *  was used signed out, made on the account at its first pass (`firstPass`). */
  id?: string
  kind?: EntryKind
}

/** A file or a folder that came to be here. Answers its id, and the changes to write. */
export async function made(
  core: Core,
  space: SpaceState,
  what: Made,
): Promise<{ id: string; changes: Change[] }> {
  // Another sync tool's copy stays on this disk alone, the way a file too large to
  // travel does: an id, and nothing made (@orden/sync-core/foreign). Whichever way it
  // came - the watcher, the first pass, a file made in the list - this is where.
  if (inForeignCopy(what.path)) return { id: freshId(core), changes: [] }
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(what.path), changes)
  const name = nameOf(what.path)
  const kind: EntryKind = what.folder ? 'folder' : (what.kind ?? kindOfName(name))
  const id = what.id ?? freshId(core)
  const entry = entryRow(space, id, kind, parent, name, what.path)
  // A file that is not a document travels as its bytes, where this world carries them,
  // and stays on this device where it does not, or where it is too large to.
  const bytes = kind === 'file' ? await fileMade(core, space, entry) : null
  if (kind === 'file' && !bytes) return { id, changes }
  space.entries.set(id, entry)

  const seen = space.row.cursor
  const op: Op = what.folder
    ? { op: core.nextId('o'), t: 'mkdir', id, parent, name, seen }
    : {
        // A create made again goes as an op of its own: the account answers one id
        // once, and the first may have reached it before it was lost.
        op: what.id === undefined ? `${id}.c` : core.nextId('o'),
        t: 'create',
        id,
        kind: kind as Exclude<EntryKind, 'folder'>,
        parent,
        name,
        seen,
      }
  // The space's own inbox is "this note, made if it is not there yet" wherever it was
  // made, as a day's note is: two devices that each made it apart make one (#1044).
  const mergeable = what.mergeable ?? (parent === null && carriedOwn(name) ? '' : undefined)
  if (op.t === 'create' && mergeable !== undefined) op.mergeable = { text: mergeable }
  if (op.t === 'create' && bytes) op.hash = bytes.hash
  changes.push(...queue(core, space, op))

  const shape = shapeOf(kind)
  if (shape) {
    const doc = core.made(id, shape, 1)
    const text = what.text ?? ''
    if (text) doc.write((live) => turn(shape, live, '', text, MINE))
    doc.flush()
    changes.push(...core.docChanges(doc))
    changes.push(...(await wrote(core, entry, text)))
  } else {
    changes.push(put('entries', { ...entry }))
  }
  return { id, changes }
}

/** A create still waiting to go, made `mergeable` after all: the file list said a moment
 *  after the folder's watcher that it made the note, and as the day's note it is. */
export function mergeableAfter(space: SpaceState, entry: EntryRow, text: string): Change[] {
  const one = space.outbox.find(
    (op) =>
      op.record.t === 'op' &&
      !op.record.sent &&
      op.record.op.t === 'create' &&
      op.record.op.id === entry.id,
  )
  if (one?.record.t !== 'op' || one.record.op.t !== 'create') return []
  one.record = { t: 'op', op: { ...one.record.op, mergeable: { text } } }
  one.row = { ...one.row, op: outgoingBytes(one.record) }
  return [put('outbox', one.row)]
}

/** Every entry at or under a local path. */
export function atOrUnder(space: SpaceState, path: string): EntryRow[] {
  const key = space.key(path)
  const inside = space.key(`${path}${SEP}`)
  return [...space.entries.values()].filter((entry) => {
    if (!entry.local_path) return false
    const at = space.key(entry.local_path)
    return at === key || at.startsWith(inside)
  })
}

/** A file or folder that moved here, renamed or into another folder. Answers the
 *  changes to write; nothing for a path the tree does not know. */
export function moved(core: Core, space: SpaceState, from: string, to: string): Change[] {
  const entry = space.at(from)
  if (!entry) return []
  // Put aside under another sync tool's name - Proton does that to its side of a
  // clash before it writes the other - is not the note being renamed: it keeps its
  // place, and the file that arrives there is read as an edit to it.
  if (inForeignCopy(to) && !inForeignCopy(from)) return []
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(to), changes)
  // Everything under it is where it is now, before the op is shown.
  changes.push(...carried(space, from, to))
  changes.push(...placing(core, space, entry, parent, keptName(space, entry, from, to)))
  space.changed()
  return changes
}

/** The name a move to `to` leaves an entry: moved and not renamed keeps the account's, which
 *  a name this platform spells its own way here is not: `CON` on Windows would become `_CON`
 *  on every device. */
function keptName(space: SpaceState, entry: EntryRow, from: string, to: string): string {
  const had = space.shown().entries.get(entry.id)?.name
  return had !== undefined && nameOf(from) === nameOf(to) ? had : nameOf(to)
}

/** The op that puts an entry at `to`, shown at once, before its file is there: what
 *  the file list does is said before the disk has it (`moving` in engine.ts), so
 *  nothing the folder's watcher hears meanwhile is a guess. Where the file is stays as
 *  it was until `carried`. `name`: what it was called, for a move put back. */
export function intended(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  to: string,
  name = keptName(space, entry, entry.local_path, to),
): Change[] {
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(to), changes)
  changes.push(...placing(core, space, entry, parent, name))
  space.changed()
  return changes
}

/** Everything at or under `from` is at `to` on this disk now. */
export function carried(space: SpaceState, from: string, to: string): Change[] {
  const changes: Change[] = []
  for (const one of atOrUnder(space, from)) {
    one.local_path = `${to}${one.local_path.slice(from.length)}`
    changes.push(put('entries', { ...one }))
  }
  space.changed()
  return changes
}

/** A rename, or a move, of an entry to `name` in `parent`, where what is shown does not
 *  have it there already. */
function placing(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  parent: string | null,
  name: string,
): Change[] {
  const seen = space.row.cursor
  const shown = space.shown().entries.get(entry.id)
  if (shown?.parent === parent) {
    if (shown.name === name) return []
    return queue(core, space, { op: core.nextId('o'), t: 'rename', id: entry.id, name, seen })
  }
  const op: Op = { op: core.nextId('o'), t: 'move', id: entry.id, parent, seen }
  if (shown?.name !== name) op.name = name
  return queue(core, space, op)
}

/** Entries put somewhere else among the rest of their folder, by hand (#1068): one
 *  `place` each, which the outbox folds to the last of a row's drags. */
export function placed(
  core: Core,
  space: SpaceState,
  places: ReadonlyMap<string, string>,
): Change[] {
  const changes: Change[] = []
  for (const [id, pos] of places) {
    changes.push(
      ...queue(core, space, { op: core.nextId('o'), t: 'place', id, pos, seen: space.row.cursor }),
    )
  }
  if (places.size) core.reorders += 1
  space.changed()
  return changes
}

/** Another sync tool's copy taken off the account, which the person asked for in the
 *  Sync pane: it goes to the account's Recently deleted and its file stays where it is,
 *  here and on every disk (`settle` in places.ts). Seen up to the cursor, because this
 *  device pulls nothing of such a copy's words and it is meant to go whatever they say. */
export function unsynced(core: Core, space: SpaceState, entry: EntryRow): Change[] {
  const changes: Change[] = []
  if (entry.local_path) {
    entry.local_path = ''
    changes.push(put('entries', { ...entry }))
  }
  changes.push(...core.letGoChanges(entry.id))
  if (entry.kind !== 'folder') changes.push(...core.forgetChanges(entry.id))
  const seen = space.row.cursor
  changes.push(...queue(core, space, { op: core.nextId('o'), t: 'delete', id: entry.id, seen }))
  space.changed()
  return changes
}

/** Every live entry under a folder in the tree, however deep, whether or not it is on
 *  this disk. */
function inside(space: SpaceState, folder: string): EntryRow[] {
  const holds = (id: string | null, depth = 0): boolean => {
    if (id === null || depth > space.entries.size) return false
    if (id === folder) return true
    return holds(space.entries.get(id)?.parent ?? null, depth + 1)
  }
  return [...space.entries.values()].filter(
    (one) => !one.deleted && one.id !== folder && holds(one.parent),
  )
}

/** A file or folder deleted here. The person threw these words away, so nothing of them
 *  goes up any more; what the account holds of them lands in its Recently deleted,
 *  unless another device wrote in them since this one last looked, when the account
 *  keeps them and they come back (an edit beats a delete). */
export function removed(core: Core, space: SpaceState, path: string, back?: string): Change[] {
  const entry = space.at(path)
  if (!entry) return []
  const changes: Change[] = []
  const gone = atOrUnder(space, path)

  // What this device has seen of the words it deletes: a note whose newest words it has
  // not pulled yet was not seen, so the account must not take them. Everything under it
  // in the tree, not only what is on this disk: a note that came in the list and whose
  // words were never pulled has no file here yet, and a folder delete took it, words and
  // all, with nothing kept (#435).
  let seen = space.row.cursor
  const wanted = core.wanted(space.id)
  for (const one of new Set([...gone, ...inside(space, entry.id)])) {
    if (!wanted.has(one.id)) continue
    seen = Math.min(seen, core.numbers.get(one.id)?.pulled ?? 0)
  }

  // Where each was, for the delete to be put back as the entries it was.
  space.gone.delete(entry.id)
  const paths = new Map(gone.map((one) => [one.id, one.local_path]))
  space.gone.set(entry.id, back === undefined ? { paths } : { paths, back })
  for (const id of [...space.gone.keys()].slice(0, Math.max(0, space.gone.size - GONE_KEPT))) {
    space.gone.delete(id)
  }
  changes.push(put('meta', goneRow(space.id, space.gone)))

  for (const one of gone) {
    one.local_path = ''
    changes.push(put('entries', { ...one }))
    changes.push(...core.letGoChanges(one.id))
    if (one.kind !== 'folder') changes.push(...core.forgetChanges(one.id))
  }
  changes.push(...queue(core, space, { op: core.nextId('o'), t: 'delete', id: entry.id, seen }))
  space.changed()
  return changes
}

/** Whether an op that makes an entry is still in the outbox - `unsent`: and has not
 *  gone yet. */
function making(space: SpaceState, id: string, unsent = false): boolean {
  return space.outbox.some(
    (one) =>
      one.record.t === 'op' &&
      one.record.op.id === id &&
      (one.record.op.t === 'create' || one.record.op.t === 'mkdir') &&
      !(unsent && one.record.sent),
  )
}

/** This device's delete of an entry whose making has not gone either, taken out of the
 *  outbox: the account will hear of neither, and a restore behind them would name an
 *  entry it never had, the two folded away before it (`coalesce`). */
function unsent(space: SpaceState, id: string, changes: Change[]): void {
  const one = space.outbox.find(
    (op) =>
      op.record.t === 'op' &&
      !op.record.sent &&
      op.record.op.t === 'delete' &&
      op.record.op.id === id,
  )
  if (!one) return
  space.outbox = space.outbox.filter((other) => other !== one)
  changes.push(remove('outbox', one.row.op_id))
  space.changed()
}

/** What this device deleted, back on its disk at `path` - out of its trash, or a delete
 *  undone - as the entries it was, under their ids (#1068). The files were heard as
 *  files made before, so a note came back under a new id beside its own tombstone.
 *
 *  Each entry whose file is back: one made here whose making has not gone yet loses
 *  the delete behind it; one the account never heard of is made again under its id,
 *  with what its file says; any other goes up as a `restore`, which brings it
 *  back on the account with the folders above it, over a delete made without having
 *  seen it, and its words come down again by the next pull. A folder's entries are
 *  found where this device last had them (`gone` on the space), else where their names
 *  put them inside it. Answers null where the
 *  entry is not this space's, or another entry's file is at `path`: what is there is
 *  then a file made. */
export async function restored(
  core: Core,
  space: SpaceState,
  id: string,
  path: string,
): Promise<Change[] | null> {
  const top = space.entries.get(id)
  if (!top) return null
  const holder = space.at(path)
  if (holder) return holder.id === id ? [] : null

  // Where each was when this device deleted it, else where the names put it.
  const back: { entry: EntryRow; at: string }[] = []
  const was = space.gone.get(id)?.paths
  const from = was?.get(id)
  if (was && from !== undefined) {
    for (const [one, at] of was) {
      const entry = space.entries.get(one)
      if (entry && !entry.local_path) back.push({ entry, at: `${path}${at.slice(from.length)}` })
    }
    back.sort((a, b) => a.at.split(SEP).length - b.at.split(SEP).length)
  } else {
    const walk = (entry: EntryRow, at: string, depth: number) => {
      back.push({ entry, at })
      if (entry.kind !== 'folder' || depth > space.entries.size) return
      for (const one of space.entries.values()) {
        if (one.parent !== entry.id || one.local_path) continue
        walk(one, joined(at, space.spelled(one.name)), depth + 1)
      }
    }
    walk(top, path, 0)
  }

  const changes: Change[] = []
  let wants = false
  for (const { entry, at } of back) {
    if (space.at(at) || !(await core.world.disk.exists(core.world.join(space.row.root, at)))) {
      if (entry === top) return null
      continue
    }
    if (entry.seq === null && !making(space, entry.id)) {
      // Made and deleted here before the account heard of either: made again.
      const text = holdsDocument(entry.kind)
        ? ((await core.world.disk.read(core.world.join(space.row.root, at))) ?? '')
        : undefined
      const again = await made(core, space, {
        path: at,
        folder: entry.kind === 'folder',
        id: entry.id,
        kind: entry.kind as EntryKind,
        ...(text === undefined ? {} : { text }),
      })
      changes.push(...again.changes)
      continue
    }
    entry.local_path = at
    changes.push(put('entries', { ...entry }))
    if (entry.kind === 'file') core.touched.add(entry.id)
    // Its words were let go of with the delete: wanted again, so the next pull brings
    // them, and a delete made before then takes nothing this device has not seen. What
    // the file says is what this device last had, not an edit made since: the account's
    // newer words are written over it, and it is kept as a version (`project`).
    if (holdsDocument(entry.kind) && !core.hasDoc(entry.id)) {
      core.wanted(space.id).set(entry.id, { docSeq: 0, epoch: core.epochs.get(entry.id) ?? 1 })
      wants = true
      const text = await core.world.disk.read(core.world.join(space.row.root, at))
      if (text !== null) changes.push(...(await wrote(core, entry, text)))
    }
    // Made here and not gone yet: the delete behind it goes instead, and nothing else.
    if (making(space, entry.id, true)) {
      unsent(space, entry.id, changes)
      // And its words, let go of with the delete, are its file's again: the account has
      // none of them yet.
      const shape = shapeOf(entry.kind)
      if (shape && !core.hasDoc(entry.id)) {
        const text = (await core.world.disk.read(core.world.join(space.row.root, at))) ?? ''
        const doc = core.made(entry.id, shape, 1)
        if (text) doc.write((live) => turn(shape, live, '', text, MINE))
        doc.flush()
        changes.push(...core.docChanges(doc), ...(await wrote(core, entry, text)))
      }
      continue
    }
    // Even where it shows: somebody else's delete this device has not heard of yet may
    // be on the account, and a person asking for it back outweighs a delete that had
    // not seen that.
    const seen = space.row.cursor
    changes.push(...queue(core, space, { op: core.nextId('o'), t: 'restore', id: entry.id, seen }))
  }

  // Put back beside something that took its name meanwhile: under the name it came
  // back with.
  const now = space.shown().entries.get(id)
  const name = nameOf(path)
  if (now && !now.deleted && space.key(space.spelled(now.name)) !== space.key(name)) {
    const seen = space.row.cursor
    changes.push(...queue(core, space, { op: core.nextId('o'), t: 'rename', id, name, seen }))
  }
  if (wants) changes.push(core.wantChange(space.id))
  if (space.gone.delete(id)) changes.push(put('meta', goneRow(space.id, space.gone)))
  space.changed()
  return changes
}
