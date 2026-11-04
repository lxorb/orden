/** A space kept with no account behind it (#1068, step 4b): what Orden is signed out.
 *
 *  Every folder, note and file still has an id from the moment it is here, and the
 *  tree is still operations on ids, applied by the rules the account applies
 *  (`applyOp` in @orden/sync-core/tree). There is just nobody to send them to, so this
 *  device is its own account: a pass applies the outbox to the tree it has confirmed,
 *  with every change its own, and takes what was typed as confirmed words. Nothing is
 *  asked of the network. The rest of the engine - the outbox, the disk made to agree
 *  with the tree, the watcher, a delete put back under its ids - is the one that runs
 *  signed in.
 *
 *  Such a space is told by its id (`isLocal`) and kept in a store of its own
 *  (`LOCAL_STORE`), never in an account's. */

import { applyOp } from '@orden/sync-core/tree'
import type { EntryKind, Op } from '@orden/sync-core/wire'
import { holderOf } from '../pages/held'
import { Core } from './core'
import { kindOfName, made } from './create'
import { holdsDocument, unixLines } from './kinds'
import { flushAll, refused, settleDisk, type Passed } from './pass'
import type { SpaceState } from './places'
import { put, remove, type Change } from './store'

/** The store the spaces used signed out are kept in. An account's store is named by its
 *  id, a UUID, so no account's is ever called this. */
export const LOCAL_STORE = 'local'

const PREFIX = 'local-'

/** Whether a space is kept with no account behind it. */
export function isLocal(spaceId: string): boolean {
  return spaceId.startsWith(PREFIX)
}

/** An id for a space kept here: 128 random bits, named as one no account hands out. */
export function localSpaceId(random: () => number): string {
  let out = PREFIX
  for (let part = 0; part < 4; part += 1) {
    out += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  }
  return out
}

/** How many times a pass goes round the outbox: an op the rules refuse can queue one
 *  more (a note made again at the top of the space), which the next round applies. */
const ROUNDS = 4

/** A space's first pass with no account: everything in its folder becomes an entry with
 *  an id, and each note a document holding its words. Answers whether it got through. */
export async function localFirst(core: Core, space: SpaceState): Promise<boolean> {
  const life = core.life
  const world = core.world
  const everything = (await world.list?.(space.row.root)) ?? []
  // A page note's paper is part of the note and no entry of its own (#551), as in the
  // first pass that meets an account (migrate.ts).
  const notes = new Set(everything.filter((one) => !one.dir).map((one) => space.key(one.path)))
  const listing = everything
    .filter((one) => {
      const holder = one.dir ? null : holderOf(one.path)
      return holder === null || !notes.has(space.key(holder))
    })
    // Shallow before deep, so every folder is there before what is in it.
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  const changes: Change[] = []
  for (const one of listing) {
    if (core.life !== life) return false
    // Known already: a first pass cut short and run again.
    if (space.at(one.path)) continue
    const document = !one.dir && holdsDocument(kindOfName(one.path))
    const text = document ? await world.disk.read(world.join(space.row.root, one.path)) : undefined
    if (text === null) continue
    const madeHere = await made(core, space, {
      path: one.path,
      folder: one.dir,
      ...(text === undefined ? {} : { text: unixLines(text) }),
    })
    changes.push(...madeHere.changes)
  }
  await core.commit(changes)
  return core.life === life
}

/** One pass over a space with no account: the outbox applied here, the disk made to
 *  agree with the tree, and what was typed confirmed. */
export async function localPass(core: Core, space: SpaceState): Promise<Passed> {
  const life = core.life
  const alive = () => core.life === life
  const passed: Passed = { pulled: 0, pushed: 0, finished: false, full: false }

  await core.commit(flushAll(core))
  if (!alive()) return passed
  for (let round = 0; round < ROUNDS && space.outbox.length; round += 1) {
    await core.commit(await applied(core, space))
    if (!alive()) return passed
  }
  await settleDisk(core, space)
  if (!alive()) return passed
  passed.pushed = await confirmed(core, space)
  passed.finished = alive()
  return passed
}

/** The outbox, applied to the tree as an account would apply it, every change this
 *  device's own: an op sees everything before it, and no change stands against
 *  another, since nobody else made any. Answers the rows to write. */
async function applied(core: Core, space: SpaceState): Promise<Change[]> {
  const state = space.confirmed()
  const device = core.device
  for (const entry of state.entries.values()) entry.by = device

  const changes: Change[] = []
  const refusals: [Op, string][] = []
  for (const one of [...space.outbox]) {
    space.outbox = space.outbox.filter((other) => other !== one)
    changes.push(remove('outbox', one.row.op_id))
    // A version for the account's history, or a day's note to merge into another: there
    // is no account, and the version is already kept on this disk.
    if (one.record.t !== 'op') continue
    const op = { ...one.record.op, seen: state.cursor }
    // Two days' notes are two files here, each where it is.
    if (op.t === 'create') delete op.mergeable
    const result = applyOp(state, op, { role: 'owner', device })
    if ('refused' in result) refusals.push([op, result.refused])
  }

  for (const after of state.entries.values()) {
    const entry = space.entries.get(after.id)
    if (!entry) continue
    if (
      entry.seq === after.seq &&
      entry.parent === after.parent &&
      entry.name === after.name &&
      entry.deleted === after.deleted
    )
      continue
    entry.parent = after.parent
    entry.name = after.name
    entry.deleted = after.deleted
    entry.seq = after.seq
    changes.push(put('entries', { ...entry }))
  }
  space.row = { ...space.row, cursor: state.cursor }
  changes.push(put('spaces', { ...space.row }))
  space.changed()

  // What the rules refused comes out of what is shown, as an account's refusal does,
  // and the disk is put back to agree.
  for (const [op, why] of refusals) changes.push(...(await refusedHere(core, space, op, why)))
  space.changed()
  return changes
}

/** An op the rules would not apply here. A folder or a file whose making was refused -
 *  its folder deleted meanwhile, or its id already a tombstone of this space - is made
 *  again where its file is, under a new id: nobody else holds it, so nothing of it may
 *  go, and a file that no entry shows is one the disk would be made to agree with by
 *  taking it away. The rest is what an account's refusal is (`refused` in pass.ts). */
async function refusedHere(core: Core, space: SpaceState, op: Op, why: string): Promise<Change[]> {
  if ((op.t !== 'create' && op.t !== 'mkdir') || why !== 'gone') {
    return await refused(core, space, op, why)
  }
  const entry = space.entries.get(op.id)
  if (!entry?.local_path || entry.seq !== null) return []
  const path = entry.local_path
  const full = core.world.join(space.row.root, path)
  const text = holdsDocument(entry.kind) ? await core.world.disk.read(full) : undefined
  if (text === null) return []
  space.entries.delete(op.id)
  space.changed()
  const changes: Change[] = [remove('entries', op.id), ...core.forgetChanges(op.id)]
  const again = await made(core, space, {
    path,
    folder: entry.kind === 'folder',
    ...(entry.kind === 'folder' ? {} : { kind: entry.kind as Exclude<EntryKind, 'folder'> }),
    ...(text === undefined ? {} : { text: unixLines(text) }),
  })
  return [...changes, ...again.changes]
}

/** Every document's pending words, confirmed: they are the only words there are. Answers
 *  how many documents that was. */
async function confirmed(core: Core, space: SpaceState): Promise<number> {
  const changes: Change[] = []
  let count = 0
  for (const entry of space.entries.values()) {
    // Only what the tree shows: a document nothing shows keeps its words pending, and
    // with them its file (`keeps` in `settle`).
    if (!Core.isDocument(entry) || !space.isLive(entry.id)) continue
    if (!core.hasPending(entry.id) || core.isHeld(entry.id)) continue
    const doc = await core.doc(entry.id)
    if (!doc) continue
    doc.flush()
    if (!doc.outgoing(() => core.nextId('p'))) continue
    doc.confirmFlight(doc.seq + 1)
    changes.push(...core.docChanges(doc))
    count += 1
  }
  if (count) await core.commit([...changes, core.counterRow()])
  return count
}
