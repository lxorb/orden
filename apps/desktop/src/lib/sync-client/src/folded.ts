import type { Op } from '@orden/sync-core'
import type { SpaceState } from './places'
import type { Disk } from './world'
import { outgoingBytes } from './records'
import { put, remove, type Change } from './store'

function movedOp(op: Op, mine: string, into: string): Op {
  let next = op
  if (next.id === mine) next = { ...next, id: into }
  if ('parent' in next && next.parent === mine) next = { ...next, parent: into }
  return next
}
function movedKey<T>(map: Map<string, T>, mine: string, into: string): boolean {
  const had = map.get(mine)
  if (had === undefined) return false
  map.delete(mine)
  if (!map.has(into)) map.set(into, had)
  return true
}
export function foldedInto(space: SpaceState, mine: string, into: string): Change[] {
  const changes: Change[] = []
  for (const one of space.outbox) {
    const record = one.record
    if (record.t === 'op') {
      const op = movedOp(record.op, mine, into)
      if (op === record.op) continue
      one.record = { ...record, op }
    } else if (record.t === 'merge' && record.merge.create.parent === mine) {
      one.record = { t: 'merge', merge: { ...record.merge, create: { ...record.merge.create, parent: into } } }
    } else {
      continue
    }
    one.row = { ...one.row, op: outgoingBytes(one.record) }
    changes.push(put('outbox', one.row))
  }
  for (const entry of space.entries.values()) {
    if (entry.parent !== mine) continue
    entry.parent = into
    changes.push(put('entries', { ...entry }))
  }
  const ours = space.entries.get(mine)
  const theirs = space.entries.get(into)
  if (ours) {
    space.entries.delete(mine)
    changes.push(remove('entries', mine))
    if (!theirs) {
      const moved = { ...ours, id: into }
      space.entries.set(into, moved)
      changes.push(put('entries', moved))
    } else if (!theirs.local_path) {
      theirs.local_path = ours.local_path
      changes.push(put('entries', { ...theirs }))
    } else if (ours.local_path && ours.local_path !== theirs.local_path) {
      space.emptied.add(ours.local_path)
    }
  }
  const positioned = movedKey(space.ordering.positions, mine, into)
  if (movedKey(space.ordering.meta, mine, into) || positioned) space.repositioned = true
  space.changed()
  return changes
}
export async function emptiedGone(space: SpaceState, disk: Disk, join: (root: string, path: string) => string) {
  for (const path of [...space.emptied]) {
    const full = join(space.row.root, path)
    const held = disk.holds ? await disk.holds(full) : null
    if (held === null || space.at(path)) {
      space.emptied.delete(path)
      continue
    }
    if (held.length) continue
    space.emptied.delete(path)
    await disk.remove(full, 'folder').catch(() => undefined)
  }
}
