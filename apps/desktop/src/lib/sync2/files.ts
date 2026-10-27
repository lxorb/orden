/** Every file of a space that is not a note, a canvas, a page note or a web note: a
 *  picture, a recording, a PDF (docs/sync-v2.md section 5.8).
 *
 *  Such a file is an entry of kind `file` with the hash of its bytes, and the bytes are
 *  a blob on the account under that hash. Nothing merges. A file made here goes up as
 *  its bytes and then its `create`; one replaced here goes up as new bytes and a
 *  replace naming the bytes it replaced, which the account answers `moved` when another
 *  device replaced them first - and then the file is held and its person asked, with the
 *  same three answers a note has. A file the account has bytes for that this disk does
 *  not is fetched and written, unless this device replaced it meanwhile, which is the
 *  same question from the other side.
 *
 *  Two hashes on each entry say where it stands: `file_key` is the bytes the account
 *  last named, `written_hash` the bytes this disk was last known to hold. Equal is in
 *  step; a newer `file_key` is something to fetch; a disk that hashes to neither is a
 *  replacement made here.
 *
 *  Only where the world can carry bytes (`World.blobs`): the simulator's cannot, and
 *  there files are not kept at all. Up to 64 MB a file, in one request; a larger one
 *  stays on this device. */

import type { Core, Holding } from './core'
import { againstBytes, outgoingBytes } from './records'
import type { Outboxed, SpaceState } from './places'
import { put, type Change, type EntryRow } from './store'

/** The largest file that travels: the account's one-request ceiling. */
const LARGEST = 64 * 1024 * 1024

/** How long a file whose bytes the account refused waits before they go again. A full
 *  account stays full until somebody deletes something, and every try sends every byte. */
const REFUSED_WAIT = 5 * 60_000

/** What the account answered a replacement. */
export type Replaced =
  | { ok: true; seq: number }
  | { moved: { hash: string; size: number; at: number } }
  | { gone: true }
  | { refused: 'role' }

/** The world's road for bytes. Each request answers null when the account cannot be
 *  reached, as `Account.ask` does. */
export interface Blobs {
  /** A file's bytes on this disk, or null when it is not there. */
  read(path: string): Promise<Uint8Array | null>
  write(path: string, bytes: Uint8Array): Promise<void>
  /** The hash a blob is named by. */
  hash(bytes: Uint8Array): Promise<string>
  /** The bytes, up to the account under their hash. Answers whether it keeps them now,
   *  or `full` when the account has no room for them. */
  up(hash: string, bytes: Uint8Array): Promise<boolean | 'full' | null>
  /** A file's bytes, from its space. `gone` for one the account no longer has. */
  down(space: string, id: string): Promise<Uint8Array | 'gone' | null>
  replace(space: string, id: string, hash: string, base: string): Promise<Replaced | null>
}

/** A file's bytes and their hash, read now; null for one that is not there, and for one
 *  too large to travel. */
async function readBytes(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ bytes: Uint8Array; hash: string } | null> {
  const blobs = core.world.blobs
  if (!blobs || !entry.local_path) return null
  const bytes = await blobs.read(core.world.join(space.row.root, entry.local_path))
  if (!bytes || bytes.byteLength > LARGEST) return null
  return { bytes, hash: await blobs.hash(bytes) }
}

/** A file made here: its hash and size, for the entry and its `create`. Null when this
 *  world keeps no files, or the file is too large to travel. */
export async function fileMade(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
): Promise<{ hash: string; size: number } | null> {
  const read = await readBytes(core, space, entry)
  if (!read) return null
  entry.file_key = null
  entry.written_hash = read.hash
  entry.size = read.bytes.byteLength
  return { hash: read.hash, size: read.bytes.byteLength }
}

/** What a pass heard about the account's room for bytes. */
export interface Room {
  /** Whether the account said it has no room for a file's bytes. */
  full: boolean
}

/** The bytes of every file a waiting `create` names, up before the ops that name them,
 *  since the account makes no entry for bytes it does not have. A file changed since it
 *  was made goes up as it is now, under its new hash. Answers the ids of the files whose
 *  bytes the account would not take - their creates wait, and the rest of the outbox
 *  goes - or null when a request got no answer. */
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
    // Sent without its bytes, the create would be refused `gone` and the file forgotten:
    // it waits, and the rest of the outbox goes.
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

/** Fetches what the account has that this disk does not, and sends what this disk has
 *  that the account does not: every file entry of the space, compared by hash. Answers
 *  whether everything got an answer. */
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
    // A create still on its way: its bytes go up with it (`sendMade`).
    if (waitingCreate(space, entry.id)) continue
    const path = entry.local_path || wanted.get(entry.id)
    if (!path) continue
    const changedThere = entry.file_key !== null && entry.file_key !== entry.written_hash
    // Read only where something may have changed: what another program wrote is said by
    // the watcher and the launch scan (`touched`), so a quiet space reads nothing.
    if (!core.touched.has(entry.id) && !changedThere && entry.local_path) continue
    core.touched.delete(entry.id)

    const here = entry.local_path ? await readBytes(core, space, entry) : null
    const changedHere = here !== null && here.hash !== entry.written_hash

    if (here?.hash === entry.file_key) {
      // Both say the same: in step, whichever moved.
      if (entry.written_hash !== here.hash) await written(core, entry, here.hash, here.bytes)
      continue
    }
    if (changedHere && changedThere) {
      await core.commit(holdFile(core, entry, here.hash))
      continue
    }
    if (changedHere) {
      // Bytes the account refused a moment ago go again once the wait is over.
      if (resting(core, entry.id, here.hash, room)) {
        core.touched.add(entry.id)
        continue
      }
      const stored = await blobs.up(here.hash, here.bytes)
      if (!alive() || stored === null) return false
      if (!(await taken(core, space, entry, here.hash, stored, room))) {
        // Bytes the account would not take, no room for them, say: this file waits, and
        // the rest of the space settles.
        core.touched.add(entry.id)
        continue
      }
      const answer = await blobs.replace(space.id, entry.id, here.hash, entry.file_key ?? '')
      if (!alive() || answer === null) return false
      if ('ok' in answer) {
        entry.file_key = here.hash
        await written(core, entry, here.hash, here.bytes)
      } else if ('moved' in answer) {
        entry.file_key = answer.moved.hash
        await core.commit(holdFile(core, entry, here.hash, answer.moved.at))
      }
      if (!('refused' in answer)) continue
      // A space this account may only read: the bytes another program wrote here will
      // never go up, and kept they would stand for good against every replacement the
      // owner makes. They go to this device's trash, which is where Keep theirs puts a
      // replacement too, and the owner's are fetched in their place. With no file and no
      // path the entry is fetched next pass, should this one stop before the bytes come.
      try {
        await core.world.disk.remove(core.world.join(space.row.root, entry.local_path), 'file')
      } catch {
        // Locked by the program still writing it, or the trash would not take it: thrown,
        // it stopped the whole pass, every pass. It stays as it is and is tried again
        // next pass, and the rest of the space settles meanwhile.
        core.touched.add(entry.id)
        continue
      }
      entry.local_path = ''
      await core.commit([put('entries', { ...entry })])
    }
    if (changedThere || !entry.local_path) {
      const full = core.world.join(space.row.root, path)
      if (!entry.local_path) {
        // Another entry's file is still where this one is going: it moves on first.
        const holder = space.at(path)
        if (holder && holder !== entry) continue
        // A file nobody here has named yet is in the way, dropped here while the app
        // was closed or a page note's paper: it becomes an entry of its own (ingest),
        // and nothing is written over it, as with a document (`project`).
        if (await core.world.disk.exists(full)) continue
      }
      const bytes = await blobs.down(space.id, entry.id)
      if (!alive() || bytes === null) return false
      if (bytes === 'gone') continue
      try {
        await core.world.disk.mkdir(core.world.join(space.row.root, folderPath(path)))
        await blobs.write(full, bytes)
      } catch {
        // Refused, a file another program holds open: this one waits for the next pass,
        // its entry as it was, and the rest of the space settles. Thrown, it stopped
        // every pass before anything after it came or went.
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

/** Whether these bytes of a file were refused too lately to go again yet: bytes changed
 *  since go at once. Says the account is still full meanwhile, as it last said. */
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

/** Whether the account took a file's bytes, writing down when it did not, and saying
 *  so in the log the first time it refuses these bytes: a refusal other than for room
 *  shows no warning, and the file would wait unremarked. */
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

/** Whether an outbox row is an op on a file whose create waits for the account to take
 *  its bytes: nothing a pass can send now, so nothing to pass again for soon. */
export function waitsForBytes(core: Core, space: SpaceState, one: Outboxed): boolean {
  return (
    one.record.t === 'op' &&
    !one.record.sent &&
    core.refusedBytes.has(one.record.op.id) &&
    waitingCreate(space, one.record.op.id)
  )
}

/** Whether a `create` for this entry is still waiting to go up. */
function waitingCreate(space: SpaceState, id: string): boolean {
  return space.outbox.some(
    (one) => one.record.t === 'op' && one.record.op.t === 'create' && one.record.op.id === id,
  )
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

/** A file both sides replaced, held for the question: this disk keeps its bytes, the
 *  account keeps the other's, and nothing goes either way until it is answered. */
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
