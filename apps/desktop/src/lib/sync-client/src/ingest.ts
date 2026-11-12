import type { Core, Holding } from './core'
import { MINE } from './docs'
import { judge, readable, turn, unixLines } from './kinds'
import { project, readFine, readRefused, saidUnsynced, wrote } from './project'
import { againstBytes } from './records'
import { keepLosers } from './rejoin'
import type { SpaceState } from './places'
import { get, type Change, type EntryRow } from './store'

export async function writtenOf(core: Core, id: string): Promise<string | null> {
  const [row] = await core.store.read([get('written', id)])
  return row?.text ?? null
}

async function unsynced(core: Core, entry: EntryRow, full: string, read: string): Promise<void> {
  if (!read.trim()) return
  const kept = `${entry.id}:${await core.world.digest(read)}`
  if (!core.unsyncedKept.has(kept)) {
    core.unsyncedKept.add(kept)
    await core.world.disk.keep(full, read)
  }
  saidUnsynced(core, entry)
}

export async function readAgain(core: Core, space: SpaceState): Promise<Change[]> {
  const changes: Change[] = []
  for (const id of [...core.unreadFor.keys()]) {
    const entry = space.entries.get(id)
    if (!entry || entry.kind === 'file') continue
    if (!entry.local_path || !space.isLive(id)) {
      core.unreadFor.delete(id)
      continue
    }
    if (core.isHeld(id) || core.pinned.has(id) || space.foreign(id)) continue
    const folded = await foldIn(core, space, entry)
    changes.push(...folded)
    if (core.unreadFor.has(id) || core.isHeld(id) || folded.length) continue
    const doc = await core.doc(id)
    if (doc) changes.push(...(await project(core, space, entry, doc)))
  }
  return changes
}

export async function foldIn(core: Core, space: SpaceState, entry: EntryRow): Promise<Change[]> {
  if (!entry.local_path || core.isHeld(entry.id)) return []
  const full = core.world.join(space.row.root, entry.local_path)
  const read = await core.world.disk.read(full)
  if (read === null) {
    if (await core.world.disk.exists(full)) readRefused(core, entry)
    else core.unreadFor.delete(entry.id)
    return []
  }
  core.unreadFor.delete(entry.id)
  const file = unixLines(read)

  const doc = await core.doc(entry.id)
  if (!doc) return []
  const ours = doc.text()
  const ancestor = (await writtenOf(core, entry.id)) ?? ours
  if (file !== ancestor && file !== ours && !readable(doc.shape, file)) {
    await unsynced(core, entry, full, read)
    return []
  }
  readFine(core, entry.id)
  if (file === ancestor) return []
  if (file === ours) return await wrote(core, entry, file)

  if (ours === ancestor) {
    doc.write((live) => turn(doc.shape, live, ours, file, MINE))
    doc.flush()
    return [...core.docChanges(doc), ...(await wrote(core, entry, file))]
  }

  const times = { local: core.world.now(), remote: doc.pendingAt }
  const judged = judge(doc.shape, ancestor, file, ours, times)
  const held = judged.resolution === null
  if (doc.shape !== 'link') {
    core.classified.push({
      id: entry.id,
      base: ancestor,
      local: file,
      remote: ours,
      times,
      held,
      ...(judged.merged === undefined ? {} : { merged: judged.merged }),
    })
  }

  if (judged.resolution === null) {
    const against = { t: 'file', base: ancestor, local: file } as const
    const holding: Holding = {
      row: {
        id: entry.id,
        remote: againstBytes(against),
        remote_sv: new Uint8Array(),
        device: null,
        at: core.world.now(),
      },
      against,
    }
    return core.holdChanges(holding)
  }

  const resolution = judged.resolution
  const changes = keepLosers(core, space, entry.id, judged.lost, file, ours)
  doc.write((live) => turn(doc.shape, live, ours, resolution, MINE))
  doc.flush()
  changes.push(...core.docChanges(doc))
  changes.push(...(await project(core, space, entry, doc)))
  return changes
}
