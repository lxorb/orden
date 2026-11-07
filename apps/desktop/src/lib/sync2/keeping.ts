import type { Core } from './core'
import { holdsDocument, unixLines } from './kinds'
import type { SpaceState } from './places'
import { keepingRow, Tracked, type Keeping } from './records'
import { put, type Change, type EntryRow } from './store'

const FEW: ReadonlySet<string> = new Set(['note', 'canvas', 'pages'])

export function emptyKeeping(): Keeping {
  return { on: false, used: new Tracked(), going: new Set() }
}

function alwaysKept(space: SpaceState, entry: EntryRow): boolean {
  if (!FEW.has(entry.kind)) return true
  const path = space.paths().get(entry.id) ?? entry.local_path
  return path.split('/').some((part) => part.startsWith('.'))
}

export function keptHere(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!space.keepsFew) return true
  return core.hasDoc(entry.id) || core.asked.has(entry.id) || alwaysKept(space, entry)
}

export function away(space: SpaceState, entry: EntryRow): boolean {
  if (!space.keepsFew || !holdsDocument(entry.kind) || entry.seq === null) return false
  if (entry.local_path || !space.isLive(entry.id)) return false
  return !space.foreign(entry.id)
}

export function awayUnder(space: SpaceState, path: string): EntryRow[] {
  if (!space.keepsFew) return []
  const key = space.key(path)
  const inside = space.key(`${path}/`)
  const out: EntryRow[] = []
  for (const [id, at] of space.paths()) {
    const entry = space.entries.get(id)
    if (!entry || !away(space, entry)) continue
    const one = space.key(at)
    if (one === key || one.startsWith(inside)) out.push(entry)
  }
  return out
}

export function usedChanges(core: Core, space: SpaceState, id: string, size?: number): Change[] {
  return used(core, space, id, size) ? [keepingChange(space)] : []
}

export function used(core: Core, space: SpaceState, id: string, size?: number): boolean {
  if (!space.keepsFew) return false
  const was = space.keeping.used.get(id)
  space.keeping.used.set(id, { at: core.world.now(), size: size ?? was?.size ?? 0 })
  return true
}

export function keepingChange(space: SpaceState): Change {
  return put('meta', keepingRow(space.id, space.keeping))
}

function mayLetGo(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!FEW.has(entry.kind) || entry.seq === null || !entry.local_path) return false
  if (!core.hasDoc(entry.id) || alwaysKept(space, entry)) return false
  const { id } = entry
  if (core.pinned.has(id) || core.hasPending(id) || core.isHeld(id)) return false
  if (core.carried.has(id) || core.inHand.has(id) || core.asked.has(id)) return false
  return !space.outbox.some((one) => one.record.t === 'op' && one.record.op.id === id)
}

export interface LettingGo {
  drop(path: string): Promise<void>
  leaving?(one: Leaving): Promise<void>
}

export interface Leaving {
  id: string
  space: string
  path: string
  text: string
  docSeq: number
  at: number
}

export async function trim(core: Core, budget: number, how: LettingGo): Promise<number> {
  const kept: { space: SpaceState; entry: EntryRow; at: number; size: number }[] = []
  let total = 0
  for (const space of core.spaces.values()) {
    if (!space.keepsFew) continue
    await finishGoing(core, space, how)
    for (const entry of space.entries.values()) {
      if (!FEW.has(entry.kind) || !core.hasDoc(entry.id) || !entry.local_path) continue
      const used = space.keeping.used.get(entry.id)
      const size = used?.size ?? entry.size ?? 0
      total += size
      if (mayLetGo(core, space, entry)) kept.push({ space, entry, at: used?.at ?? 0, size })
    }
  }
  if (total <= budget) return 0

  let went = 0
  kept.sort((a, b) => a.at - b.at)
  for (const one of kept) {
    if (total <= budget) break
    if (!mayLetGo(core, one.space, one.entry)) continue
    if (!(await letGo(core, one.space, one.entry, how))) continue
    total -= one.size
    went += 1
  }
  return went
}

async function letGo(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  how: LettingGo,
): Promise<boolean> {
  const full = core.world.join(space.row.root, entry.local_path)
  const text = await core.world.disk.read(full)
  if (text !== null && (await core.world.digest(unixLines(text))) !== entry.written_hash)
    return false
  if (how.leaving) {
    const docSeq = core.numbers.get(entry.id)?.pulled ?? 0
    if (text !== null) {
      await how.leaving({
        id: entry.id,
        space: space.id,
        path: entry.local_path,
        text,
        docSeq,
        at: entry.mtime ?? 0,
      })
    }
  }
  if (!mayLetGo(core, space, entry)) return false

  const numbers = core.numbers.get(entry.id)
  const changes = core.forgetChanges(entry.id)
  core
    .wanted(space.id)
    .set(entry.id, { docSeq: numbers?.pulled ?? 0, epoch: core.epochs.get(entry.id) ?? 1 })
  space.keeping.going.add(entry.local_path)
  space.keeping.used.delete(entry.id)
  entry.local_path = ''
  entry.written_hash = null
  await core.commit([...changes, put('entries', { ...entry }), keepingChange(space)])
  await finishGoing(core, space, how)
  return true
}

async function finishGoing(core: Core, space: SpaceState, how: LettingGo) {
  if (!space.keeping.going.size) return
  for (const path of [...space.keeping.going]) {
    const holder = space.at(path)
    if (!holder?.local_path || holder.local_path !== path) {
      await how.drop(core.world.join(space.row.root, path))
    }
    space.keeping.going.delete(path)
  }
  await core.commit([keepingChange(space)])
}
