import { holderOf } from '@orden/markdown/pages'
import type { Mirror, Moving, Tracked, Untold } from '../../sync-mirror/src/api'
import type { Core } from './core'
import { kindOfName, made, moved } from './create'
import { MINE } from './docs'
import { readFeed } from './pass'
import { fileOfUpdates, judge, readable, seedOf, shapeOf, turn, unixLines } from './kinds'
import type { SpaceState } from './places'
import { againstBytes } from './records'
import { keepLosers } from './rejoin'
import { project, wrote } from './project'
import type { Change, EntryRow } from './store'
import { pullResponseOf, PULL_BATCH, type FeedItem, type Op } from '@orden/sync-core'
import * as Y from 'yjs'

export interface V1Space {
  cursor: number
  notes: Readonly<Record<string, Tracked>>
  moving?: Moving
  untold?: Readonly<Record<string, Untold>>
}

const EMPTY_SV = Y.encodeStateVector(new Y.Doc())

interface Matched {
  entry: EntryRow
  item: FeedItem
  file: string
  tracked: Tracked | undefined
}

export async function firstPass(
  core: Core,
  space: SpaceState,
  v1: V1Space | null,
  carried: ReadonlyMap<string, string> = new Map(),
  done: readonly Change[] = [],
): Promise<boolean> {
  const life = core.life
  const alive = () => core.life === life
  const world = core.world
  const full = (path: string) => world.join(space.row.root, path)

  if ((await world.account.ask('prepare', {}, space.id)) === null || !alive()) return false

  space.row.cursor = 0
  const items = new Map<string, FeedItem>()
  if (!(await readFeed(core, space, alive, (item) => items.set(item.id, item)))) return false

  const listed = world.list ? await world.list(space.row.root) : []
  if (listed === null || !alive()) return false
  const everything = [...listed]
  const shown = new Set(listed.map((one) => space.key(one.path)))
  for (const path of Object.keys(v1?.notes ?? {})) {
    if (shown.has(space.key(path))) continue
    if ((await world.disk.read(full(path))) !== null) {
      everything.push({ path, dir: false })
      shown.add(space.key(path))
    } else if (await world.disk.exists(full(path))) {
      return false
    }
  }
  const notes = new Set(everything.filter((one) => !one.dir).map((one) => space.key(one.path)))
  const listing = everything.filter((one) => {
    const holder = one.dir ? null : holderOf(one.path)
    return holder === null || !notes.has(space.key(holder))
  })
  const wanted = space.paths()
  const changes: Change[] = []
  const matched: Matched[] = []
  const claimed = new Set<string>()

  const untold = Object.entries(v1?.untold ?? {}).filter(
    ([id, one]) => v1?.notes[one.from]?.id === id,
  )
  const left = new Set(untold.map(([, one]) => one.from))
  const away = new Set(untold.map(([id]) => id))
  const byTracked = (path: string): EntryRow | null => {
    const tracked = left.has(path) ? undefined : v1?.notes[path]
    const entry = tracked ? space.entries.get(tracked.id) : undefined
    return entry && !entry.deleted && !claimed.has(entry.id) ? entry : null
  }
  const deletedUnseen = async (path: string): Promise<EntryRow | null> => {
    const tracked = left.has(path) ? undefined : v1?.notes[path]
    const entry = tracked ? space.entries.get(tracked.id) : undefined
    if (!tracked || !entry?.deleted || claimed.has(entry.id)) return null
    const read = await world.disk.read(full(path))
    return read !== null && (await hashesOf(core, read)).includes(tracked.hash) ? entry : null
  }
  const byPlace = (path: string, folder: boolean): EntryRow | null => {
    const key = space.key(path)
    for (const [id, at] of wanted) {
      if (claimed.has(id) || away.has(id) || space.key(at) !== key) continue
      const entry = space.entries.get(id)
      if (entry && (entry.kind === 'folder') === folder) return entry
    }
    return null
  }
  const match = async (entry: EntryRow, file: string, tracked: Tracked | undefined) => {
    changes.push(...(await wrote(core, entry, file)))
    const item = items.get(entry.id)
    if (item && shapeOf(entry.kind)) matched.push({ entry, item, file, tracked })
  }

  const strays: { path: string; dir: boolean }[] = []
  for (const listed of listing) {
    const gone = listed.dir ? null : await deletedUnseen(listed.path)
    if (gone) {
      claimed.add(gone.id)
      gone.local_path = listed.path
      changes.push(...core.entryChanges([gone]))
      continue
    }
    const entry = listed.dir
      ? byPlace(listed.path, true)
      : (byTracked(listed.path) ?? byPlace(listed.path, false))
    if (!entry) {
      strays.push(listed)
      continue
    }
    claimed.add(entry.id)
    entry.local_path = listed.path
    changes.push(...core.entryChanges([entry]))
    if (listed.dir || !shapeOf(entry.kind)) continue
    const read = await world.disk.read(full(listed.path))
    if (read !== null) await match(entry, unixLines(read), v1?.notes[listed.path])
  }

  const idOf = (path: string): { id?: string } => {
    const id = carried.get(space.key(path))
    return id !== undefined && !core.entry(id) && !claimed.has(id) ? { id } : {}
  }
  const depth = (path: string) => path.split('/').length
  for (const stray of strays
    .filter((one) => one.dir)
    .sort((a, b) => depth(a.path) - depth(b.path))) {
    if (space.folderAt(stray.path) !== undefined) continue
    const folder = { path: stray.path, folder: true, ...idOf(stray.path) }
    changes.push(...(await made(core, space, folder)).changes)
  }

  const vacated = new Set<string>()
  const renamed = await renamedHere(core, space, v1, strays, claimed)
  for (const { entry, from, path, file, tracked } of renamed) {
    claimed.add(entry.id)
    if (entry.parent !== null) vacated.add(entry.parent)
    entry.local_path = from
    changes.push(...moved(core, space, from, path))
    await match(entry, file, tracked)
  }

  const needs: Matched[] = []
  for (const one of matched) {
    const digest = await world.digest(one.file)
    const seeds =
      one.item.epochBase === digest && (one.tracked === undefined || one.tracked.hash === digest)
    if (seeds) {
      seed(core, space, one, changes)
    } else if (one.tracked?.hash !== digest) {
      needs.push(one)
    }
  }

  for (let at = 0; at < needs.length; at += PULL_BATCH) {
    let batch = needs.slice(at, at + PULL_BATCH)
    while (batch.length) {
      const reply = await world.account.ask(
        'pull',
        {
          docs: batch.map((one) => ({
            id: one.entry.id,
            epoch: one.item.epoch ?? 1,
            sv: EMPTY_SV,
          })),
          part: true,
        },
        space.id,
      )
      if (!alive() || reply === null) return false
      const answered = new Map((pullResponseOf(reply)?.docs ?? []).map((doc) => [doc.id, doc]))
      for (const one of batch) {
        const whole = answered.get(one.entry.id)
        if (whole && 'update' in whole) {
          changes.push(...(await reconcile(core, space, one, whole.update, whole.seq)))
        }
      }
      const left = batch.filter((one) => !answered.has(one.entry.id))
      if (left.length === batch.length) return false
      batch = left
    }
  }

  if (v1) {
    for (const tracked of Object.values(v1.notes)) {
      const entry = space.entries.get(tracked.id)
      if (!entry || entry.deleted || claimed.has(entry.id)) continue
      if (entry.parent !== null) vacated.add(entry.parent)
      const op: Op = { op: core.nextId('o'), t: 'delete', id: entry.id, seen: v1.cursor }
      changes.push(...send(core, space, op))
    }
  }

  for (const id of vacated) {
    const folder = space.entries.get(id)
    if (!v1 || folder?.kind !== 'folder' || claimed.has(id) || !space.isLive(id)) continue
    const shown = space.shown()
    if ([...shown.entries.values()].some((one) => one.parent === id && !one.deleted)) continue
    changes.push(...send(core, space, { op: core.nextId('o'), t: 'delete', id, seen: v1.cursor }))
    if (folder.parent !== null) vacated.add(folder.parent)
  }

  for (const stray of strays) {
    if (stray.dir || renamed.some((one) => one.path === stray.path)) continue
    const document = !!shapeOf(kindOfName(stray.path))
    if (!document && !world.blobs) continue
    const text = document ? await world.disk.read(full(stray.path)) : undefined
    const madeHere = await made(core, space, {
      path: stray.path,
      folder: false,
      ...idOf(stray.path),
      ...(text === null || text === undefined ? {} : { text: unixLines(text) }),
    })
    changes.push(...madeHere.changes)
  }

  changes.push(...done)
  if (!alive()) return false
  await core.commit(changes)
  return true
}

interface Renamed {
  entry: EntryRow
  from: string
  path: string
  file: string
  tracked: Tracked
}

async function renamedHere(
  core: Core,
  space: SpaceState,
  v1: V1Space | null,
  strays: readonly { path: string; dir: boolean }[],
  claimed: ReadonlySet<string>,
): Promise<Renamed[]> {
  const left = new Map<string, Tracked[]>()
  for (const tracked of Object.values(v1?.notes ?? {})) {
    const entry = space.entries.get(tracked.id)
    if (!entry || entry.deleted || claimed.has(entry.id) || !shapeOf(entry.kind)) continue
    const gathered = left.get(tracked.hash)
    if (gathered) gathered.push(tracked)
    else left.set(tracked.hash, [tracked])
  }
  if (!left.size) return []

  const loose: { path: string; file: string; hashes: string[] }[] = []
  for (const stray of strays) {
    if (stray.dir || !shapeOf(kindOfName(stray.path))) continue
    const read = await core.world.disk.read(core.world.join(space.row.root, stray.path))
    if (read === null) continue
    loose.push({ path: stray.path, file: unixLines(read), hashes: await hashesOf(core, read) })
  }

  const out: Renamed[] = []
  for (const [id, untold] of Object.entries(v1?.untold ?? {})) {
    const tracked = v1?.notes[untold.from]
    const entry = space.entries.get(id)
    const from = entry && space.paths().get(id)
    const one = loose.find((stray) => space.key(stray.path) === space.key(untold.to))
    if (tracked?.id !== id || !entry || entry.deleted || claimed.has(id) || !one) continue
    if (from === undefined || !shapeOf(entry.kind)) continue
    out.push({ entry, from, path: one.path, file: one.file, tracked })
    loose.splice(loose.indexOf(one), 1)
  }
  for (const one of loose) {
    const known = [...new Set(one.hashes.flatMap((hash) => left.get(hash) ?? []))].filter(
      (tracked) => !out.some((done) => done.entry.id === tracked.id),
    )
    const twins = loose.filter((other) => other.hashes.some((hash) => one.hashes.includes(hash)))
    const tracked = known.length === 1 && twins.length === 1 ? known[0] : undefined
    const entry = tracked && space.entries.get(tracked.id)
    const from = entry && space.paths().get(entry.id)
    if (tracked && entry && from !== undefined) {
      out.push({ entry, from, path: one.path, file: one.file, tracked })
    }
  }
  return out
}

async function hashesOf(core: Core, text: string): Promise<string[]> {
  const plain = unixLines(text)
  const hashes = [await core.world.digest(text)]
  if (plain !== text) hashes.push(await core.world.digest(plain))
  return hashes
}

function send(core: Core, space: SpaceState, op: Op): Change[] {
  const { one, change } = core.outgoing(space, { t: 'op', op }, op.seen)
  space.queue(one)
  return [change, core.counterRow()]
}

function seed(core: Core, space: SpaceState, one: Matched, changes: Change[]) {
  const shape = shapeOf(one.entry.kind) ?? 'words'
  const epoch = one.item.epoch ?? 1
  const doc = core.made(
    one.entry.id,
    shape,
    epoch,
    seedOf(shape, one.entry.id, epoch, one.file),
    one.file ? 1 : 0,
  )
  core.wanted(space.id).set(one.entry.id, { docSeq: one.item.docSeq ?? 0, epoch })
  changes.push(...core.docChanges(doc))
}

async function reconcile(
  core: Core,
  space: SpaceState,
  one: Matched,
  update: Uint8Array,
  seq: number,
): Promise<Change[]> {
  const shape = shapeOf(one.entry.kind) ?? 'words'
  const epoch = one.item.epoch ?? 1
  const remote = fileOfUpdates(shape, update)
  const local = one.file
  const doc = core.made(one.entry.id, shape, epoch, update, seq)
  doc.pulled = one.item.docSeq ?? 0
  core.wanted(space.id).delete(one.entry.id)
  const changes: Change[] = []
  const take = (to: string) => {
    doc.write((live) => turn(shape, live, remote, to, MINE))
    doc.flush()
  }

  const remoteDigest = await core.world.digest(remote)
  if (local === remote) {
    // Nothing to do: the two agree.
  } else if (!readable(shape, local)) {
    // A plane another program cut short or left with conflict markers is no edit of it:
    // the account's stands, as v1's own merge has it, and the file is kept as a version
    // before it is written (`project`).
  } else if (one.tracked?.hash === remoteDigest) {
    take(local)
  } else {
    const ancestor = one.tracked
      ? ((await core.world.ancestor?.(one.entry.id, one.tracked.hash)) ?? null)
      : null
    if (ancestor !== null) {
      const times = { local: core.world.now(), remote: 0 }
      const judged = judge(shape, ancestor, local, remote, times)
      if (judged.resolution === null) {
        changes.push(...hold(core, one.entry.id, ancestor, local))
      } else {
        changes.push(...keepLosers(core, space, one.entry.id, judged.lost, local, remote))
        take(judged.resolution)
      }
    } else if (local.includes(remote)) {
      take(local)
    } else if (!remote.includes(local)) {
      changes.push(...hold(core, one.entry.id, remote, local))
    }
  }

  changes.push(...core.docChanges(doc), ...(await wrote(core, one.entry, local)))
  if (!core.isHeld(one.entry.id)) changes.push(...(await project(core, space, one.entry, doc)))
  return changes
}

function hold(core: Core, id: string, base: string, local: string): Change[] {
  const against = { t: 'file', base, local } as const
  return core.holdChanges({
    row: {
      id,
      remote: againstBytes(against),
      remote_sv: new Uint8Array(),
      device: null,
      at: core.world.now(),
    },
    against,
  })
}

interface V1Note {
  id: string
  path: string
  version: number
  hash: string
  seq: number
  deleted: boolean
}

export interface V1Listing {
  cursor: number
  notes: readonly V1Note[]
}

const UNPROVEN = 0

export async function mirrorsFrom(
  core: Core,
  listings: ReadonlyMap<string, V1Listing> | null,
  done: (space: string) => boolean = () => true,
): Promise<Record<string, Mirror>> {
  const out: Record<string, Mirror> = {}
  for (const space of core.spaces.values()) {
    if (!done(space.id)) continue
    const listing = listings?.get(space.id)
    const { cursor, notes } = listing
      ? await proven(core, space, listing)
      : { cursor: 0, notes: await confirmed(core, space) }
    out[space.row.root] = {
      spaceId: space.id,
      root: space.row.root,
      cursor,
      notes,
      offered: {},
      files: {},
      dropped: false,
      shared: space.row.role !== null && space.row.role !== 'owner',
    }
  }
  return out
}

async function confirmed(core: Core, space: SpaceState): Promise<Record<string, Tracked>> {
  const notes: Record<string, Tracked> = {}
  for (const entry of space.entries.values()) {
    if (entry.deleted || !entry.local_path || entry.seq === null || !shapeOf(entry.kind)) continue
    const doc = await core.doc(entry.id)
    if (!doc) continue
    notes[entry.local_path] = {
      id: entry.id,
      version: UNPROVEN,
      hash: core.isHeld(entry.id) ? '' : await core.world.digest(doc.confirmedText()),
    }
  }
  return notes
}

async function proven(
  core: Core,
  space: SpaceState,
  listing: V1Listing,
): Promise<{ cursor: number; notes: Record<string, Tracked> }> {
  const notes: Record<string, Tracked> = {}
  let cursor = listing.cursor
  for (const remote of listing.notes) {
    if (remote.deleted) continue
    const tracked = await provenOne(core, space, remote)
    if (tracked) notes[remote.path] = tracked
    if (tracked?.version !== remote.version) cursor = Math.min(cursor, remote.seq - 1)
  }
  return { cursor: Math.max(0, cursor), notes }
}

async function provenOne(core: Core, space: SpaceState, remote: V1Note): Promise<Tracked | null> {
  const entry = space.entries.get(remote.id)
  if (!entry || entry.deleted || entry.local_path !== remote.path || !shapeOf(entry.kind)) {
    return null
  }
  const doc = await core.doc(entry.id)
  const read = await core.world.disk.read(core.world.join(space.row.root, entry.local_path))
  if (!doc || read === null) return null
  if (core.isHeld(entry.id)) return { id: entry.id, version: UNPROVEN, hash: '' }
  const agreed = await core.world.digest(doc.confirmedText())
  if (agreed === remote.hash || (await hashesOf(core, read)).includes(remote.hash)) {
    return { id: entry.id, version: remote.version, hash: remote.hash }
  }
  return { id: entry.id, version: UNPROVEN, hash: agreed }
}
