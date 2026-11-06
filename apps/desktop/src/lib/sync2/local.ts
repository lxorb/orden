import { applyOp } from '@orden/sync-core/tree'
import type { Op } from '@orden/sync-core/wire'
import { holderOf } from '../pages/held'
import { Core } from './core'
import { kindOfName, made } from './create'
import { holdsDocument, unixLines } from './kinds'
import { flushAll, madeAnew, refused, settleDisk, type Passed } from './pass'
import type { SpaceState } from './places'
import { get, put, remove, scan, type Change, type SyncStore } from './store'

export const LOCAL_STORE = 'local'

const PREFIX = 'local-'

export function isLocal(spaceId: string): boolean {
  return spaceId.startsWith(PREFIX)
}

export function localSpaceId(random: () => number): string {
  let out = PREFIX
  for (let part = 0; part < 4; part += 1) {
    out += Math.floor(random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  }
  return out
}

const ROUNDS = 4

export async function localFirst(
  core: Core,
  space: SpaceState,
  carried: ReadonlyMap<string, string> = new Map(),
): Promise<boolean> {
  const life = core.life
  const world = core.world
  const everything = (await world.list?.(space.row.root)) ?? []
  const notes = new Set(everything.filter((one) => !one.dir).map((one) => space.key(one.path)))
  const listing = everything
    .filter((one) => {
      const holder = one.dir ? null : holderOf(one.path)
      return holder === null || !notes.has(space.key(holder))
    })
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  const changes: Change[] = []
  for (const one of listing) {
    if (core.life !== life) return false
    if (space.at(one.path)) continue
    const document = !one.dir && holdsDocument(kindOfName(one.path))
    const text = document ? await world.disk.read(world.join(space.row.root, one.path)) : undefined
    if (text === null) continue
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

async function applied(core: Core, space: SpaceState): Promise<Change[]> {
  const state = space.confirmed()
  const device = core.device
  for (const entry of state.entries.values()) entry.by = device

  const changes: Change[] = []
  const refusals: [Op, string][] = []
  for (const one of [...space.outbox]) {
    space.outbox = space.outbox.filter((other) => other !== one)
    changes.push(remove('outbox', one.row.op_id))
    if (one.record.t !== 'op') continue
    const op = { ...one.record.op, seen: state.cursor }
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

  for (const [op, why] of refusals) changes.push(...(await refusedHere(core, space, op, why)))
  space.changed()
  return changes
}

async function refusedHere(core: Core, space: SpaceState, op: Op, why: string): Promise<Change[]> {
  if ((op.t !== 'create' && op.t !== 'mkdir') || why !== 'gone') {
    return await refused(core, space, op, why)
  }
  return await madeAnew(core, space, op.id)
}

async function confirmed(core: Core, space: SpaceState): Promise<number> {
  const changes: Change[] = []
  let count = 0
  for (const entry of space.entries.values()) {
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

const CARRIED = 'carried:'

const FROM = 'from:'

const ID = /^[0-9A-Za-z-]{1,64}$/

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

export function carriedGone(root: string): Change {
  return remove('meta', `${CARRIED}${root}`)
}
