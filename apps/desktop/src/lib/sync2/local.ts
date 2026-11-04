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
import type { Op } from '@orden/sync-core/wire'
import { holderOf } from '../pages/held'
import { Core } from './core'
import { kindOfName, made } from './create'
import { holdsDocument, unixLines } from './kinds'
import { flushAll, madeAnew, refused, settleDisk, type Passed } from './pass'
import type { SpaceState } from './places'
import { get, put, remove, scan, type Change, type SyncStore } from './store'

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
 *  an id, and each note a document holding its words - under the id it had signed in,
 *  where signing out carried one (`carried`). Answers whether it got through. */
export async function localFirst(
  core: Core,
  space: SpaceState,
  carried: ReadonlyMap<string, string> = new Map(),
): Promise<boolean> {
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
    // The id it had in the account's store, signed in until now, where nothing here has it.
    const id = carried.get(space.key(one.path))
    const madeHere = await made(core, space, {
      path: one.path,
      folder: one.dir,
      ...(id === undefined || core.entry(id) ? {} : { id }),
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
 *  again where its file is, under a new id (`madeAnew` in pass.ts): nobody else holds
 *  it, so nothing of it may go, and a file that no entry shows is one the disk would be
 *  made to agree with by taking it away. The rest is what an account's refusal is
 *  (`refused` in pass.ts). */
async function refusedHere(core: Core, space: SpaceState, op: Op, why: string): Promise<Change[]> {
  if ((op.t !== 'create' && op.t !== 'mkdir') || why !== 'gone') {
    return await refused(core, space, op, why)
  }
  return await madeAnew(core, space, op.id)
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

/** The meta row a store keeps, until a space's first pass, of the ids what is in that
 *  space's folder had in the store kept before it: the one kept signed out, for an
 *  account's first pass, or an account's, for the first pass signed out. */
const CARRIED = 'carried:'

/** The meta row the store kept signed out keeps of which ids came from which account,
 *  by a space's root: what signing in to another account does not carry, since a space
 *  there may not make an entry under an id another space has made (`takenIds` in the
 *  Worker's sync2/ops.ts). */
const FROM = 'from:'

/** What an id is, as a store keeps it: a UUID the account gave, or 32 hex digits a
 *  device made. */
const ID = /^[0-9A-Za-z-]{1,64}$/

/** The ids of everything live in a store's spaces, by each space's root and, within it,
 *  by path as the disk had it: what signing in or out carries over to the next store's
 *  first pass of each, so each entry keeps its id where it can (`firstPass` in
 *  migrate.ts, `localFirst` here). Signing in to `account`, what came from another
 *  account stays behind. */
export async function carriedIds(
  store: Pick<SyncStore, 'read'>,
  which: (spaceId: string) => boolean = isLocal,
  account?: string,
): Promise<Map<string, string>> {
  const [spaces, entries, meta] = await store.read([scan('spaces'), scan('entries'), scan('meta')])
  const elsewhere = new Map<string, Set<string>>()
  for (const row of meta) {
    if (!row.key.startsWith(FROM) || typeof row.value !== 'string') continue
    const from = fromOf(row.value)
    if (from && from.account !== account) elsewhere.set(row.key.slice(FROM.length), from.ids)
  }
  const out = new Map<string, string>()
  for (const space of spaces) {
    if (!which(space.space_id)) continue
    const away = elsewhere.get(space.root)
    const ids: Record<string, string> = {}
    for (const entry of entries) {
      if (entry.space_id !== space.space_id || entry.deleted || !entry.local_path) continue
      if (away?.has(entry.id)) continue
      ids[entry.local_path] = entry.id
    }
    if (Object.keys(ids).length) out.set(space.root, JSON.stringify(ids))
  }
  return out
}

function fromOf(value: string): { account: string; ids: Set<string> } | null {
  try {
    const read: unknown = JSON.parse(value)
    if (typeof read !== 'object' || read === null) return null
    const { account, ids } = read as { account?: unknown; ids?: unknown }
    if (typeof account !== 'string' || !Array.isArray(ids)) return null
    return { account, ids: new Set(ids.filter((id): id is string => typeof id === 'string')) }
  } catch {
    return null
  }
}

/** The rows that keep carried ids in the next store, one a space's root; carried from an
 *  account into the store kept signed out, with which account they came from. */
export function carriedRows(carried: ReadonlyMap<string, string>, account?: string): Change[] {
  const rows: Change[] = []
  for (const [root, ids] of carried) {
    rows.push(put('meta', { key: `${CARRIED}${root}`, value: ids }))
    if (account === undefined) continue
    const from = { account, ids: Object.values(JSON.parse(ids) as Record<string, string>) }
    rows.push(put('meta', { key: `${FROM}${root}`, value: JSON.stringify(from) }))
  }
  return rows
}

/** The ids carried for a space's folder, by path as `key` compares paths; none where
 *  nothing was carried or what was kept does not read. */
export async function carriedFor(
  store: Pick<SyncStore, 'read'>,
  root: string,
  key: (path: string) => string,
): Promise<Map<string, string>> {
  const [row] = await store.read([get('meta', `${CARRIED}${root}`)])
  const out = new Map<string, string>()
  if (typeof row?.value !== 'string') return out
  try {
    const ids: unknown = JSON.parse(row.value)
    if (typeof ids !== 'object' || ids === null) return out
    for (const [path, id] of Object.entries(ids)) {
      if (typeof id === 'string' && ID.test(id)) out.set(key(path), id)
    }
  } catch {
    // Not what was written: nothing carried, and every stray is made under a new id.
  }
  return out
}

/** The row of a space's carried ids, gone once its first pass has used them. */
export function carriedGone(root: string): Change {
  return remove('meta', `${CARRIED}${root}`)
}
