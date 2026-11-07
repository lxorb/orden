import { carriedOwn } from '@orden/bases/inbox'
import { unstacked } from '@orden/markdown/paths'
import { fileMade } from './files'
import { inForeignCopy } from '@orden/sync-core/foreign'
import { kindOfName } from '@orden/sync-core/tree'
import type { MetaPatch } from '@orden/sync-core/meta'
import type { EntryKind, Op } from '@orden/sync-core/wire'
import type { Core } from './core'
import { MINE } from './docs'
import { holdsDocument, shapeOf, turn } from './kinds'
import { folderOf, joined, nameOf, SEP, type SpaceState } from './places'
import { wrote } from './project'
import { GONE_KEPT, goneRow, outgoingBytes } from './records'
import { put, remove, type Change, type EntryRow } from './store'

export { kindOfName }

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
  path: string
  folder: boolean
  text?: string
  mergeable?: string
  id?: string
  kind?: EntryKind
}

export async function made(
  core: Core,
  space: SpaceState,
  what: Made,
): Promise<{ id: string; changes: Change[] }> {
  if (inForeignCopy(what.path)) return { id: freshId(core), changes: [] }
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(what.path), changes)
  const name = nameOf(what.path)
  const kind: EntryKind = what.folder ? 'folder' : (what.kind ?? kindOfName(name))
  const id = what.id ?? freshId(core)
  const entry = entryRow(space, id, kind, parent, name, what.path)
  const bytes = kind === 'file' ? await fileMade(core, space, entry) : null
  if (kind === 'file' && !bytes) return { id, changes }
  space.entries.set(id, entry)

  const seen = space.row.cursor
  const op: Op = what.folder
    ? { op: core.nextId('o'), t: 'mkdir', id, parent, name, seen }
    : {
        op: what.id === undefined ? `${id}.c` : core.nextId('o'),
        t: 'create',
        id,
        kind: kind as Exclude<EntryKind, 'folder'>,
        parent,
        name,
        seen,
      }
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

export function atOrUnder(space: SpaceState, path: string): EntryRow[] {
  const key = space.key(path)
  const inside = space.key(`${path}${SEP}`)
  return [...space.entries.values()].filter((entry) => {
    if (!entry.local_path) return false
    const at = space.key(entry.local_path)
    return at === key || at.startsWith(inside)
  })
}

export function moved(core: Core, space: SpaceState, from: string, to: string): Change[] {
  const entry = space.at(from)
  if (!entry) return []
  if (inForeignCopy(to) && !inForeignCopy(from)) return []
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(to), changes)
  changes.push(...carried(space, from, to))
  changes.push(...placing(core, space, entry, parent, keptName(space, entry, from, to)))
  space.changed()
  return changes
}

function keptName(space: SpaceState, entry: EntryRow, from: string, to: string): string {
  const had = space.shown().entries.get(entry.id)?.name
  const name = nameOf(to)
  return had !== undefined && (nameOf(from) === name || placedAs(space, entry.id, name))
    ? had
    : name
}

function placedAs(space: SpaceState, id: string, name: string): boolean {
  const placed = space.paths().get(id)
  return placed !== undefined && nameOf(placed) === name
}

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

export function carried(space: SpaceState, from: string, to: string): Change[] {
  const changes: Change[] = []
  for (const one of atOrUnder(space, from)) {
    one.local_path = `${to}${one.local_path.slice(from.length)}`
    changes.push(put('entries', { ...one }))
  }
  space.changed()
  return changes
}

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

export function described(
  core: Core,
  space: SpaceState,
  patches: ReadonlyMap<string, MetaPatch>,
): Change[] {
  const changes: Change[] = []
  for (const [id, meta] of patches) {
    changes.push(
      ...queue(core, space, { op: core.nextId('o'), t: 'meta', id, meta, seen: space.row.cursor }),
    )
  }
  if (patches.size) core.reorders += 1
  space.changed()
  return changes
}

export function dropUnmade(core: Core, space: SpaceState, ids: Iterable<string>): Change[] {
  const changes: Change[] = []
  for (const id of ids) {
    const entry = space.entries.get(id)
    if (entry?.seq !== null || entry.local_path || entry.deleted) continue
    if ([...space.gone.values()].some((went) => went.paths.has(id))) continue
    const named = space.outbox.some(({ record }) =>
      record.t === 'op'
        ? record.op.id === id
        : record.t === 'merge' && (record.merge.mine === id || record.merge.into === id),
    )
    if (named) continue
    space.entries.delete(id)
    changes.push(remove('entries', id), ...core.forgetChanges(id))
  }
  return changes
}

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

export function removed(core: Core, space: SpaceState, path: string, back?: string): Change[] {
  const entry = space.at(path)
  if (!entry) return []
  const changes: Change[] = []
  const gone = atOrUnder(space, path)

  let seen = space.row.cursor
  const wanted = core.wanted(space.id)
  for (const one of new Set([...gone, ...inside(space, entry.id)])) {
    if (!wanted.has(one.id)) continue
    if (space.keepsFew && !core.hasDoc(one.id)) continue
    seen = Math.min(seen, core.numbers.get(one.id)?.pulled ?? 0)
  }

  space.gone.delete(entry.id)
  const paths = new Map(gone.map((one) => [one.id, one.local_path]))
  space.gone.set(entry.id, back === undefined ? { paths } : { paths, back })
  const pruned: string[] = []
  for (const id of [...space.gone.keys()].slice(0, Math.max(0, space.gone.size - GONE_KEPT))) {
    pruned.push(...(space.gone.get(id)?.paths.keys() ?? []))
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
  changes.push(...dropUnmade(core, space, pruned))
  space.changed()
  return changes
}

function here(space: SpaceState, entry: EntryRow): boolean {
  return entry.local_path !== '' && space.shown().entries.get(entry.id)?.deleted === false
}

function making(space: SpaceState, id: string, unsent = false): boolean {
  return space.outbox.some(
    (one) =>
      one.record.t === 'op' &&
      one.record.op.id === id &&
      (one.record.op.t === 'create' || one.record.op.t === 'mkdir') &&
      !(unsent && one.record.sent),
  )
}

function unsent(space: SpaceState, id: string, changes: Change[]): boolean {
  const one = space.outbox.find(
    (op) =>
      op.record.t === 'op' &&
      !op.record.sent &&
      op.record.op.t === 'delete' &&
      op.record.op.id === id,
  )
  if (!one) return false
  space.outbox = space.outbox.filter((other) => other !== one)
  changes.push(remove('outbox', one.row.op_id))
  space.changed()
  return true
}

export async function restored(
  core: Core,
  space: SpaceState,
  id: string,
  path: string,
): Promise<Change[] | null> {
  const top = space.entries.get(id)
  if (!top) return null
  const holder = space.at(path)
  if (holder && (holder.id !== id || !here(space, top))) return holder.id === id ? [] : null

  const back: { entry: EntryRow; at: string }[] = []
  const was = space.gone.get(id)?.paths
  const from = was?.get(id)
  if (was && from !== undefined) {
    for (const [one, at] of was) {
      const entry = space.entries.get(one)
      if (entry && (!entry.local_path || here(space, entry))) {
        back.push({ entry, at: `${path}${at.slice(from.length)}` })
      }
    }
    back.sort((a, b) => a.at.split(SEP).length - b.at.split(SEP).length)
  } else if (here(space, top)) {
    back.push({ entry: top, at: path })
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

  const stays = here(space, top)
  const changes: Change[] = []
  const full = (at: string) => core.world.join(space.row.root, at)
  const copies: { at: string; home: string; kind: EntryKind }[] = []
  const homeOf = (at: string) => {
    for (const copy of copies) {
      if (space.key(at).startsWith(space.key(`${copy.at}${SEP}`))) {
        return `${copy.home}${at.slice(copy.at.length)}`
      }
    }
    return at
  }
  for (const { entry, at: copy } of back) {
    if (here(space, entry)) {
      if (space.key(entry.local_path) !== space.key(copy) && !space.at(copy)) {
        copies.push({ at: copy, home: entry.local_path, kind: entry.kind as EntryKind })
      }
      const seen = space.row.cursor
      changes.push(
        ...queue(core, space, { op: core.nextId('o'), t: 'restore', id: entry.id, seen }),
      )
      continue
    }
    const at = homeOf(copy)
    if (at !== copy) {
      if (space.at(at) || (await core.world.disk.exists(full(at)))) continue
      if (!(await core.world.disk.exists(full(copy)))) continue
      try {
        await core.world.disk.mkdir(full(folderOf(at)))
        await core.world.disk.move(
          full(copy),
          full(at),
          entry.kind === 'folder' ? 'folder' : 'file',
        )
      } catch {
        continue
      }
    }
    if (space.at(at) || !(await core.world.disk.exists(full(at)))) {
      if (entry === top) return null
      continue
    }
    if (entry.seq === null && !making(space, entry.id)) {
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
    if (holdsDocument(entry.kind) && !core.hasDoc(entry.id)) {
      core.wanted(space.id).set(entry.id, { docSeq: 0, epoch: core.epochs.get(entry.id) ?? 1 })
      const text = await core.world.disk.read(core.world.join(space.row.root, at))
      if (text !== null) changes.push(...(await wrote(core, entry, text)))
    }
    if (making(space, entry.id, true)) {
      const folded = unsent(space, entry.id, changes)
      const shape = shapeOf(entry.kind)
      if (shape && !core.hasDoc(entry.id)) {
        const text = (await core.world.disk.read(core.world.join(space.row.root, at))) ?? ''
        const doc = core.made(entry.id, shape, 1)
        if (text) doc.write((live) => turn(shape, live, '', text, MINE))
        doc.flush()
        changes.push(...core.docChanges(doc), ...(await wrote(core, entry, text)))
      }
      if (folded && space.shown().entries.get(entry.id)?.deleted === false) continue
    }
    const seen = space.row.cursor
    changes.push(...queue(core, space, { op: core.nextId('o'), t: 'restore', id: entry.id, seen }))
  }

  for (const copy of copies) {
    if (homeOf(copy.at) !== copy.at) continue
    if (!(await core.world.disk.exists(full(copy.at)))) continue
    await core.world.disk
      .remove(full(copy.at), copy.kind === 'folder' ? 'folder' : 'file')
      .catch(() => undefined)
  }

  const now = space.shown().entries.get(id)
  const name = nameOf(path)
  if (
    !stays &&
    now &&
    !now.deleted &&
    space.key(space.spelled(now.name)) !== space.key(name) &&
    !placedAs(space, id, name)
  ) {
    const seen = space.row.cursor
    changes.push(...queue(core, space, { op: core.nextId('o'), t: 'rename', id, name, seen }))
  }
  if (space.gone.delete(id)) changes.push(put('meta', goneRow(space.id, space.gone)))
  space.changed()
  return changes
}

const unstacking = new WeakMap<SpaceState, Set<string>>()

export function unstackedNames(core: Core, space: SpaceState): Change[] {
  if (space.row.role === 'read') return []
  const tried = unstacking.get(space) ?? new Set<string>()
  unstacking.set(space, tried)
  const changes: Change[] = []
  for (const entry of space.shown().entries.values()) {
    if (entry.deleted || tried.has(entry.id) || !space.entries.has(entry.id)) continue
    const name = unstacked(entry.name)
    if (name === entry.name) continue
    tried.add(entry.id)
    const seen = space.row.cursor
    changes.push(
      ...queue(core, space, { op: core.nextId('o'), t: 'rename', id: entry.id, name, seen }),
    )
  }
  if (changes.length) space.changed()
  return changes
}
