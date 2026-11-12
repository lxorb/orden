import type { Core, Holding } from './core'
import { readFine, readRefused, saidUnsynced } from './project'
import { againstBytes, outgoingBytes } from './records'
import type { Outboxed, SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

const LARGEST = 64 * 1024 * 1024

const REFUSED_WAIT = 5 * 60_000

export type Replaced =
  | { ok: true; seq: number }
  | { moved: { hash: string; size: number; at: number } }
  | { gone: true }
  | { refused: 'role' }

export interface Blobs {
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  size?(path: string): Promise<number | null>
  hash(bytes: Uint8Array): Promise<string>
  up(hash: string, bytes: Uint8Array): Promise<boolean | 'full' | null>
  down(space: string, id: string): Promise<Uint8Array | 'gone' | null>
  replace(space: string, id: string, hash: string, base: string): Promise<Replaced | null>
  have?(hashes: string[]): Promise<Set<string> | null>
}

const LOST_EVERY = 6 * 60 * 60_000

const ASKED_AT_ONCE = 90

async function readBytes(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ bytes: Uint8Array; hash: string } | 'large' | 'unread' | null> {
  const blobs = core.world.blobs
  if (!blobs || !entry.local_path) return null
  const full = core.world.join(space.row.root, entry.local_path)
  if (((await blobs.size?.(full)) ?? 0) > LARGEST) return 'large'
  const bytes = await blobs.read(full)
  if (!bytes) return (await core.world.disk.exists(full)) ? 'unread' : null
  if (bytes.byteLength > LARGEST) return 'large'
  return { bytes, hash: await blobs.hash(bytes) }
}

function stampLanded(core: Core, entry: EntryRow): boolean {
  const stamp = core.stampWaiting.get(entry.id)
  if (!stamp) return false
  core.stampWaiting.delete(entry.id)
  entry.mtime = stamp.mtime
  return true
}

function cannotJudge(core: Core, entry: EntryRow, how: 'large' | 'unread'): void {
  if (how === 'large') saidUnsynced(core, entry)
  else readRefused(core, entry)
}

export async function fileMade(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ hash: string; size: number } | null> {
  const read = await readBytes(core, space, entry)
  if (!read || typeof read === 'string') return null
  entry.file_key = null
  entry.written_hash = read.hash
  entry.size = read.bytes.byteLength
  return { hash: read.hash, size: read.bytes.byteLength }
}

export interface Room {
  full: boolean
}

export async function sendMade(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  room: Room,
): Promise<Set<string> | null> {
  const waiting = new Set<string>()
  const blobs = core.world.blobs
  if (!blobs) return waiting
  for (const one of space.outbox) {
    if (one.record.t !== 'op' || one.record.sent) continue
    const op = one.record.op
    if (op.t !== 'create' || op.kind !== 'file') continue
    const entry = space.entries.get(op.id)
    if (!entry) continue
    const read = await readBytes(core, space, entry)
    if (!read) continue
    if (typeof read === 'string') {
      cannotJudge(core, entry, read)
      core.refusedBytes.set(op.id, { at: core.world.now(), hash: '', full: false })
      waiting.add(op.id)
      continue
    }
    readFine(core, op.id)
    if (resting(core, op.id, read.hash, room)) {
      waiting.add(op.id)
      continue
    }
    const stored = await blobs.up(read.hash, read.bytes)
    if (!alive() || stored === null) return null
    if (!(await taken(core, space, entry, read.hash, stored, room))) {
      waiting.add(op.id)
      continue
    }
    if (op.hash !== read.hash) {
      op.hash = read.hash
      entry.written_hash = read.hash
      entry.size = read.bytes.byteLength
      one.row = { ...one.row, op: outgoingBytes(one.record) }
      await core.commit([put('outbox', one.row), put('entries', { ...entry })])
    }
  }
  return waiting
}

export async function settleFiles(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  room: Room,
): Promise<boolean> {
  const blobs = core.world.blobs
  if (!blobs) return true
  const wanted = space.paths()
  for (const entry of [...space.entries.values()]) {
    if (entry.kind !== 'file' || entry.deleted || entry.seq === null) continue
    if (core.isHeld(entry.id) || !space.isLive(entry.id) || space.foreign(entry.id)) continue
    if (waitingCreate(space, entry.id)) continue
    const path = entry.local_path || wanted.get(entry.id)
    if (!path) continue
    const changedThere = entry.file_key !== null && entry.file_key !== entry.written_hash
    if (!core.touched.has(entry.id) && !changedThere && entry.local_path) continue
    core.touched.delete(entry.id)

    const here = entry.local_path ? await readBytes(core, space, entry) : null
    if (typeof here === 'string') {
      cannotJudge(core, entry, here)
      if (here === 'unread') core.touched.add(entry.id)
      continue
    }
    readFine(core, entry.id)
    const changedHere = here !== null && here.hash !== entry.written_hash

    if (here?.hash === entry.file_key) {
      const stamped = stampLanded(core, entry)
      if (entry.written_hash !== here.hash || stamped) {
        await written(core, entry, here.hash, here.bytes)
      }
      continue
    }
    if (changedHere && changedThere) {
      await core.commit(holdFile(core, entry, here.hash))
      continue
    }
    if (changedHere) {
      core.touched.add(entry.id)
      if (resting(core, entry.id, here.hash, room)) continue
      const stored = await blobs.up(here.hash, here.bytes)
      if (!alive() || stored === null) return false
      if (!(await taken(core, space, entry, here.hash, stored, room))) {
        continue
      }
      const answer = await blobs.replace(space.id, entry.id, here.hash, entry.file_key ?? '')
      if (!alive() || answer === null) return false
      core.touched.delete(entry.id)
      if ('ok' in answer) {
        entry.file_key = here.hash
        stampLanded(core, entry)
        await written(core, entry, here.hash, here.bytes)
      } else if ('moved' in answer) {
        entry.file_key = answer.moved.hash
        await core.commit(holdFile(core, entry, here.hash, answer.moved.at))
      }
      if (!('refused' in answer)) continue
      try {
        await core.world.disk.remove(core.world.join(space.row.root, entry.local_path), 'file')
      } catch {
        core.touched.add(entry.id)
        continue
      }
      entry.local_path = ''
      await core.commit([put('entries', { ...entry })])
    }
    if (changedThere || !entry.local_path) {
      const full = core.world.join(space.row.root, path)
      if (!entry.local_path) {
        const holder = space.at(path)
        if (holder && holder !== entry) continue
        if (await core.world.disk.exists(full)) {
          await claimed(core, space, entry, path)
          continue
        }
      }
      const bytes = await blobs.down(space.id, entry.id)
      if (!alive() || bytes === null) return false
      if (bytes === 'gone') continue
      try {
        await core.world.disk.mkdir(core.world.join(space.row.root, folderPath(path)))
        await blobs.write(full, bytes)
      } catch {
        continue
      }
      entry.local_path = path
      entry.file_key = await blobs.hash(bytes)
      await written(core, entry, entry.file_key, bytes)
      space.changed()
    }
  }
  return true
}

export async function recoverLost(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  room: Room,
): Promise<boolean> {
  const blobs = core.world.blobs
  if (!blobs?.have || core.world.now() - space.lostCheckedAt < LOST_EVERY) return true
  space.lostCheckedAt = core.world.now()

  const inStep = [...space.entries.values()].filter(
    (entry) =>
      entry.kind === 'file' &&
      !entry.deleted &&
      entry.seq !== null &&
      entry.local_path &&
      entry.file_key !== null &&
      entry.file_key === entry.written_hash &&
      space.isLive(entry.id) &&
      !space.foreign(entry.id) &&
      !core.isHeld(entry.id),
  )
  for (let from = 0; from < inStep.length; from += ASKED_AT_ONCE) {
    const batch = inStep.slice(from, from + ASKED_AT_ONCE)
    const kept = await blobs.have([...new Set(batch.map((entry) => entry.file_key ?? ''))])
    if (!alive()) return false
    if (kept === null) return true
    for (const entry of batch) {
      if (entry.file_key === null || kept.has(entry.file_key)) continue
      const here = await readBytes(core, space, entry)
      if (!here || typeof here === 'string' || here.hash !== entry.file_key) continue
      const stored = await blobs.up(here.hash, here.bytes)
      if (!alive() || stored === null) return false
      await taken(core, space, entry, here.hash, stored, room)
    }
  }
  return true
}

function resting(core: Core, id: string, hash: string, room: Room): boolean {
  const refused = core.refusedBytes.get(id)
  if (!refused) return false
  if (refused.hash !== hash) {
    core.refusedBytes.delete(id)
    return false
  }
  const was = core.world.now() - refused.at
  if (was >= 0 && was < REFUSED_WAIT) {
    if (refused.full) room.full = true
    return true
  }
  core.refusedBytes.delete(id)
  return false
}

async function taken(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  hash: string,
  stored: boolean | 'full',
  room: Room,
): Promise<boolean> {
  const before = core.refusedBytes.get(entry.id)
  if (stored === true) {
    core.refusedBytes.delete(entry.id)
    return true
  }
  const full = stored === 'full'
  core.refusedBytes.set(entry.id, { at: core.world.now(), hash, full })
  if (full) room.full = true
  if (before?.hash !== hash || before.full !== full) {
    const failed = full
      ? `no room on the account for ${entry.name}`
      : `the account would not take ${entry.name}`
    const row = { at: core.world.now(), space: space.id, pulled: null, pushed: null, failed }
    await core.commit([put('log', row)])
  }
  return false
}

export function waitsForBytes(core: Core, space: SpaceState, one: Outboxed): boolean {
  return (
    one.record.t === 'op' &&
    !one.record.sent &&
    core.refusedBytes.has(one.record.op.id) &&
    waitingCreate(space, one.record.op.id)
  )
}

function waitingCreate(space: SpaceState, id: string): boolean {
  return space.outbox.some(
    (one) => one.record.t === 'op' && one.record.op.t === 'create' && one.record.op.id === id,
  )
}

export async function claimed(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  path: string,
): Promise<boolean> {
  entry.local_path = path
  const here = await readBytes(core, space, entry)
  if (!here || typeof here === 'string' || here.hash !== entry.file_key) {
    entry.local_path = ''
    return false
  }
  space.changed()
  await written(core, entry, here.hash, here.bytes)
  return true
}

async function written(core: Core, entry: EntryRow, hash: string, bytes: Uint8Array) {
  entry.written_hash = hash
  entry.size = bytes.byteLength
  await core.commit([put('entries', { ...entry })])
}

function folderPath(path: string): string {
  const at = path.lastIndexOf('/')
  return at < 0 ? '' : path.slice(0, at)
}

function holdFile(core: Core, entry: EntryRow, mine: string, at = core.world.now()): Change[] {
  const against = { t: 'blob', mine, theirs: entry.file_key ?? '', at } as const
  const holding: Holding = {
    row: {
      id: entry.id,
      remote: againstBytes(against),
      remote_sv: new Uint8Array(),
      device: core.by.get(entry.id) ?? null,
      at: core.world.now(),
    },
    against,
  }
  return [...core.holdChanges(holding), put('entries', { ...entry })]
}
