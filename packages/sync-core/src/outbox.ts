import { nameKey } from './tree'
import type { CreateOp, MkdirOp, Op } from './wire'

type Making = CreateOp | MkdirOp

function isMaking(op: Op): op is Making {
  return op.t === 'create' || op.t === 'mkdir'
}

function unmergeable(create: Making) {
  if (create.t === 'create') delete create.mergeable
}

function placesBefore(queue: readonly (Op | null)[], until: number): Map<string, string | null> {
  const places = new Map<string, string | null>()
  for (let at = 0; at < until; at++) {
    const op = queue[at]
    if (op && (isMaking(op) || op.t === 'move')) places.set(op.id, op.parent)
  }
  return places
}

function placedInside(queue: readonly (Op | null)[], until: number, folder: string): string[] {
  const places = placesBefore(queue, until)
  const inside = (id: string): boolean => {
    const seen = new Set<string>()
    for (
      let at = places.get(id) ?? null;
      at !== null && !seen.has(at);
      at = places.get(at) ?? null
    ) {
      if (at === folder) return true
      seen.add(at)
    }
    return false
  }
  return [...places.keys()].filter((id) => id !== folder && inside(id))
}

export function coalesce(ops: readonly Op[]): Op[] {
  const queue: (Op | null)[] = ops.map((op) => ({ ...op }))
  const making = new Map<string, number>()
  const renaming = new Map<string, number>()
  const stuck = new Set<string>()
  const placing = new Map<string, number>()
  let restoring = -1

  for (let at = 0; at < queue.length; at++) {
    const op = queue[at]
    if (!op) continue
    if (op.t === 'restore') restoring = at

    if (isMaking(op)) {
      making.set(op.id, at)
      renaming.delete(op.id)
      continue
    }

    const made = making.get(op.id)
    const create = made === undefined ? undefined : queue[made]
    const foldable = !stuck.has(op.id)

    if (op.t === 'rename' && foldable && create && isMaking(create)) {
      if (nameKey(op.name) !== nameKey(create.name)) unmergeable(create)
      create.name = op.name
      queue[at] = null
      continue
    }

    if (
      op.t === 'move' &&
      foldable &&
      create &&
      isMaking(create) &&
      made !== undefined &&
      restoring < made
    ) {
      const folder = op.parent === null ? undefined : making.get(op.parent)
      if (folder === undefined || folder < made) {
        if (op.parent !== create.parent) unmergeable(create)
        if (op.name !== undefined && nameKey(op.name) !== nameKey(create.name)) unmergeable(create)
        create.parent = op.parent
        if (op.name !== undefined) create.name = op.name
        queue[at] = null
        continue
      }
    }

    if (op.t === 'meta') continue

    if (create) stuck.add(op.id)

    if (op.t === 'rename') {
      const earlier = renaming.get(op.id)
      if (earlier !== undefined) queue[earlier] = null
      renaming.set(op.id, at)
      continue
    }

    if (op.t === 'place') {
      const earlier = placing.get(op.id)
      if (earlier !== undefined) queue[earlier] = null
      placing.set(op.id, at)
      continue
    }
    placing.delete(op.id)

    renaming.delete(op.id)
    if (op.t !== 'delete' || !create) continue

    const inside = create.t === 'mkdir' ? placedInside(queue, at, op.id) : []
    const gone = new Set<string>([op.id, ...inside])
    const existed = inside.filter((id) => making.get(id) === undefined)

    const named = queue.some(
      (one) =>
        one && 'parent' in one && one.parent !== null && gone.has(one.parent) && !gone.has(one.id),
    )
    if (named) continue

    if (queue.some((one) => one?.t === 'restore' && gone.has(one.id))) continue

    for (let other = 0; other <= at; other++) {
      const one = queue[other]
      if (one && 'id' in one && gone.has(one.id)) queue[other] = null
    }
    queue.splice(
      at,
      1,
      ...existed.map((id, index): Op => ({
        op: `${op.op}.${String(index)}`,
        t: 'delete',
        id,
        seen: op.seen,
      })),
    )
    at += existed.length - 1

    for (const id of gone) {
      making.delete(id)
      renaming.delete(id)
      stuck.delete(id)
    }
  }

  return queue.filter((op): op is Op => op !== null)
}
