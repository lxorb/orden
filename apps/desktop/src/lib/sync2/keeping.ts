/** Which words this device keeps, in a browser that keeps only some of them (#1126).
 *
 *  A browser holds every note it keeps three times over: the document, what Orden last
 *  wrote, and the file's row. For an account of any size that is the whole account in
 *  the browser's storage, so a browser keeps the tree and only the words it is using:
 *
 *  - The tree comes with the feed, as it always has, and every entry is listed.
 *  - A document is pulled when it is asked for (`asked`: opened, or about to be) and
 *    from then on kept in step like any other, until it is let go of.
 *  - Kept documents are let go of the least recently used first once they are more
 *    than the budget the window gives (`trim`): the document, `written` and the row go
 *    together, and the entry stays in the tree as one this device keeps no words of. A
 *    document with anything of this device's in it is never let go of: pending edits,
 *    held, open, carried by a room, in hand, or not yet made on the account.
 *  - What every note is asked about - links, tags, tasks, a search - is the account's
 *    to answer for the rest (sync2/reading.ts in the Worker).
 *
 *  Only where the world says it may (`World.lazy`: the browser) and only where the
 *  account serves what the rest need, which its feed says with `index: true`. An
 *  account that does not say so is kept whole, as before, and so is every space on a
 *  desktop and a phone. A space's own notes, kept in its hidden folders (the inbox),
 *  and every document that is not a note, a canvas or a page note - a website, a
 *  chat's pointer, a terminal - are small, and always kept. */

import type { Core } from './core'
import { holdsDocument } from './kinds'
import type { SpaceState } from './places'
import { keepingRow, type Keeping } from './records'
import { put, type Change, type EntryRow } from './store'

/** The kinds whose words are kept only while used; every other document is small. */
const FEW: ReadonlySet<string> = new Set(['note', 'canvas', 'pages'])

export function emptyKeeping(): Keeping {
  return { on: false, used: new Map(), going: new Set() }
}

/** Whether an entry's words are kept whatever it is used for. */
function alwaysKept(space: SpaceState, entry: EntryRow): boolean {
  if (!FEW.has(entry.kind)) return true
  const path = space.paths().get(entry.id) ?? entry.local_path
  return path.split('/').some((part) => part.startsWith('.'))
}

/** Whether a document's words are to be pulled into this device. */
export function keptHere(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!space.keepsFew) return true
  return core.hasDoc(entry.id) || core.asked.has(entry.id) || alwaysKept(space, entry)
}

/** A document this device keeps no words of: listed from the tree, and fetched when it
 *  is asked for. */
export function away(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!space.keepsFew || !holdsDocument(entry.kind) || entry.seq === null) return false
  if (entry.local_path || core.hasDoc(entry.id) || !space.isLive(entry.id)) return false
  return !space.foreign(entry.id)
}

/** What noting that a document was used now changes, and how long its words are. */
export function usedChanges(core: Core, space: SpaceState, id: string, size?: number): Change[] {
  if (!space.keepsFew) return []
  const was = space.keeping.used.get(id)
  space.keeping.used.set(id, { at: core.world.now(), size: size ?? was?.size ?? 0 })
  return [keepingChange(space)]
}

export function keepingChange(space: SpaceState): Change {
  return put('meta', keepingRow(space.id, space.keeping))
}

/** Whether a kept document may be let go of now: nothing of this device's is in it. */
function mayLetGo(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!FEW.has(entry.kind) || entry.seq === null || !entry.local_path) return false
  if (!core.hasDoc(entry.id) || alwaysKept(space, entry)) return false
  const { id } = entry
  if (core.pinned.has(id) || core.hasPending(id) || core.isHeld(id)) return false
  if (core.carried.has(id) || core.inHand.has(id) || core.asked.has(id)) return false
  return !space.outbox.some((one) => one.record.t === 'op' && one.record.op.id === id)
}

/** What letting go of one file's row takes: the world's own way of dropping a row with
 *  nothing told of it, and what is told of its words first (the index; #1126). */
export interface LettingGo {
  /** Drops the row at a full path, as no delete: nothing kept by path hears of it. */
  drop(path: string): Promise<void>
  /** The words of a note on their way out, for what is kept of them (the index). */
  leaving?(one: Leaving): Promise<void>
}

/** A note whose words are on their way out. */
export interface Leaving {
  id: string
  space: string
  /** Relative to the space, `/`-separated. */
  path: string
  text: string
  /** The account's version of the words, as this device last pulled them. */
  docSeq: number
  /** When they last moved, as the feed said. */
  at: number
}

/** Lets go of the least recently used documents of every space this device keeps few
 *  words of, until what is kept of all of them is at most `budget` characters. Answers
 *  how many went. */
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
    await letGo(core, one.space, one.entry, how)
    total -= one.size
    went += 1
  }
  return went
}

/** One document let go of: its words written down for whoever keeps what is said of
 *  them, then the document, `written` and the entry's place on this disk in one write,
 *  with the path to drop beside them, and then the row. */
async function letGo(core: Core, space: SpaceState, entry: EntryRow, how: LettingGo) {
  const full = core.world.join(space.row.root, entry.local_path)
  if (how.leaving) {
    const text = await core.world.disk.read(full)
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
  // Read again: a write or an open may have come while the words were being told.
  if (!mayLetGo(core, space, entry)) return

  const numbers = core.numbers.get(entry.id)
  const changes = core.forgetChanges(entry.id)
  // What the feed last said of it stays wanted, so its words come down again whole the
  // next time it is asked for.
  core
    .wanted(space.id)
    .set(entry.id, { docSeq: numbers?.pulled ?? 0, epoch: core.epochs.get(entry.id) ?? 1 })
  space.keeping.going.add(entry.local_path)
  space.keeping.used.delete(entry.id)
  entry.local_path = ''
  entry.written_hash = null
  await core.commit([
    ...changes,
    put('entries', { ...entry }),
    core.wantChange(space.id),
    keepingChange(space),
  ])
  await finishGoing(core, space, how)
}

/** The rows a let-go of a space wrote down and has not dropped yet: dropped now. A row
 *  some entry has come to be at again meanwhile is that entry's, and stays. */
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
