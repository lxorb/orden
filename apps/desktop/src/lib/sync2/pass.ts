/** One pass over one space (docs/sync-v2.md sections 5.9, 5.12 and 7).
 *
 *  In order, each step writing down what it learned before the next request goes out:
 *
 *  1. the losing sides of answers and small overlaps, to the account's history;
 *  2. the outbox, folded (`coalesce`), through `ops`, 200 at a time - each answer puts
 *     the entry where the account put it, and a refused delete brings the note back;
 *  3. the feed since the cursor, applied in the account's order;
 *  4. the disk made to agree with the tree: moves, folders, what the account deleted;
 *  5. every document the feed said moved, pulled 200 at a time and written to its file;
 *  6. a day's note the account merged into one that was already there;
 *  7. every document with pending edits, pushed 50 at a time: `ok` confirms them,
 *     `moved` is classified (rejoin.ts), `refused` waits, longer each time (`Refusal`),
 *     except in a space this account may only read, where the edit goes (`readOnly`).
 *
 *  A pass stops quietly the moment a request goes unanswered - offline, or lost - and
 *  the next one starts where the store says this one got to. A document a live room's
 *  socket carries is the socket's: a pass neither pulls nor pushes it. */

import { recoverLost, sendMade, settleFiles } from './files'
import { coalesce } from '@orden/sync-core/outbox'
import {
  type DocRefusal,
  type EntryKind,
  feedPageOf,
  type FeedItem,
  OPS_BATCH,
  opsResponseOf,
  PULL_BATCH,
  pullResponseOf,
  PUSH_BATCH,
  pushResponseOf,
  type Op,
  type PullDoc,
  type PushDoc,
} from '@orden/sync-core/wire'
import * as Y from 'yjs'
import { Core, type Holding } from './core'
import type { Doc } from './docs'
import { MINE } from './docs'
import { foldIn, readAgain } from './ingest'
import { fileOfUpdates, holdsDocument, judge, shapeOf, turn, unixLines } from './kinds'
import { made } from './create'
import { type Outboxed, settle, type SpaceState } from './places'
import { keepingChange, keptHere } from './keeping'
import { notWritten, project } from './project'
import { againstBytes, type Merging, type Outgoing, outgoingBytes } from './records'
import { carriedOwn, withTasksOf } from '@orden/bases/inbox'
import { keepLosers, rejoin } from './rejoin'
import { put, remove, type Change, type EntryRow } from './store'
import { Refused } from './transport'

/** What a pass did, for the log and the light. */
export interface Passed {
  pulled: number
  pushed: number
  /** Whether it got to the end: false when a request went unanswered. */
  finished: boolean
  /** Whether the account said it has no room for a file's bytes: that file waits, and
   *  the rest of the pass goes on. */
  full: boolean
}

const EMPTY_SV = Y.encodeStateVector(new Y.Doc())

/** How many times a pass goes round its pulls: a document on a new epoch is pulled
 *  again from nothing, which is one more round. */
const ROUNDS = 4

export async function pass(core: Core, space: SpaceState): Promise<Passed> {
  const life = core.life
  const alive = () => core.life === life
  const passed: Passed = { pulled: 0, pushed: 0, finished: false, full: false }

  await core.commit(flushAll(core))
  if (!alive()) return passed
  if (!(await sendKeeps(core, space, alive))) return passed
  const unsent = await sendMade(core, space, alive, passed)
  if (!unsent) return passed
  if (!(await sendOps(core, space, alive, unsent))) return passed
  if (!(await readFeed(core, space, alive))) return passed
  await settleDisk(core, space)
  if (!alive()) return passed
  if (!(await settleFiles(core, space, alive, passed))) return passed
  if (!(await recoverLost(core, space, alive, passed))) return passed
  await core.commit(await readAgain(core, space))
  if (!alive()) return passed
  for (let round = 0; round < ROUNDS; round += 1) {
    const pulled = await pullDocs(core, space, alive)
    if (pulled === null) return passed
    passed.pulled += pulled
    if (!pulled) break
  }
  await mergeDays(core, space)
  if (!alive()) return passed
  const pushed = await pushDocs(core, space, alive)
  if (pushed === null) return passed
  passed.pushed = pushed
  // Ops a merge or a refusal queued go up with the next pass, which a waiting outbox
  // asks for; see the engine.
  passed.finished = true
  return passed
}

/** Every pause's worth of typing, into the store. */
export function flushAll(core: Core): Change[] {
  for (const doc of core.docs.values()) doc.flush()
  return core.dirtyChanges()
}

async function ask(
  core: Core,
  space: SpaceState,
  route: Parameters<Core['world']['account']['ask']>[0],
  body: object,
) {
  return await core.world.account.ask(route, body, space.id)
}

// ---------------------------------------------------------------------------
// 1. Versions

async function sendKeeps(core: Core, space: SpaceState, alive: () => boolean): Promise<boolean> {
  for (const one of [...space.outbox]) {
    if (one.record.t !== 'keep') continue
    try {
      const reply = await ask(core, space, 'keep', one.record.keep)
      if (!alive() || reply === null) return false
    } catch (error) {
      if (!(error instanceof Refused)) throw error
      // A note the account no longer has, or may not write: the words are in this
      // device's own history, which is where they were kept first.
      if (!alive()) return false
    }
    space.outbox = space.outbox.filter((other) => other !== one)
    await core.commit([remove('outbox', one.row.op_id)])
  }
  return true
}

// ---------------------------------------------------------------------------
// 2. The tree

/** `unsent` is the files whose creates wait for their bytes (`sendMade`). Nothing on
 *  them goes before the create: a move or rename that could not fold into it, sent
 *  first, is refused `gone` and dropped, and the file lands where it was made. Every
 *  other op goes. */
async function sendOps(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  unsent: ReadonlySet<string>,
): Promise<boolean> {
  const going = (one: Outboxed) =>
    one.record.t === 'op' && !(!one.record.sent && unsent.has(one.record.op.id))
  for (let round = 0; round < 1000; round += 1) {
    if (!space.outbox.some(going)) return true

    // What has not gone yet is folded, a create waiting for its bytes too; what may have
    // gone goes again as it was.
    const waiting = space.outbox.filter((one) => one.record.t === 'op' && !one.record.sent)
    const folded = fitted(
      space,
      coalesce(
        waiting
          .map((one) => (one.record.t === 'op' ? one.record.op : null))
          .filter((op): op is Op => op !== null),
      ),
    )
    const changes: Change[] = []
    const kept = new Map(folded.map((op) => [op.op, op]))
    const queue: Outboxed[] = []
    for (const one of space.outbox) {
      if (one.record.t !== 'op' || one.record.sent) {
        queue.push(one)
        continue
      }
      const id = one.record.op.op
      const op = kept.get(id)
      if (op) {
        one.record = { t: 'op', op }
        one.row = { ...one.row, op: outgoingBytes(one.record) }
        changes.push(put('outbox', one.row))
        queue.push(one)
      } else {
        changes.push(remove('outbox', one.row.op_id))
      }
      // A folder made and deleted here takes its delete with it, and what was only
      // moved into it is deleted instead: deletes the fold makes, named after the
      // delete they came from (`${op}.0`, `.1`), that no row holds yet. Each is a row of
      // its own, where that delete stood in the queue and as old as it, so it goes in
      // the same order after a relaunch - or it never goes at all, and the account keeps
      // what this device threw away.
      for (const split of folded) {
        if (!split.op.startsWith(`${id}.`)) continue
        const record: Outgoing = { t: 'op', op: split }
        const row = { ...one.row, op_id: split.op, op: outgoingBytes(record) }
        changes.push(put('outbox', row))
        queue.push({ row, record })
      }
    }
    space.outbox = queue

    const batch = space.outbox.filter(going).slice(0, OPS_BATCH)
    for (const one of batch) {
      if (one.record.t !== 'op') continue
      one.record = { t: 'op', op: one.record.op, sent: true }
      one.row = { ...one.row, op: outgoingBytes(one.record) }
      changes.push(put('outbox', one.row))
    }
    space.changed()
    await core.commit(changes)
    if (!alive()) return false

    const sent = batch.flatMap((one) => (one.record.t === 'op' ? [one.record.op] : []))
    let reply: unknown
    try {
      reply = await ask(core, space, 'ops', { ops: sent })
    } catch (error) {
      if (!(error instanceof Refused) || !unplaced(space, batch, error)) throw error
      await core.commit(changesOf(core, space, batch))
      continue
    }
    if (!alive() || reply === null) return false
    const answer = opsResponseOf(reply)
    if (!answer) throw new Error('the account answered the ops with something else')

    const done: Change[] = []
    for (const result of answer.results) {
      const one = space.outbox.find(
        (other) => other.record.t === 'op' && other.record.op.op === result.op,
      )
      if (one?.record.t !== 'op') continue
      const op = one.record.op
      space.outbox = space.outbox.filter((other) => other !== one)
      done.push(remove('outbox', one.row.op_id))

      if ('merged' in result && op.t === 'create') {
        const merge: Merging = { mine: op.id, into: result.merged, create: op }
        const { one: queued, change } = core.outgoing(
          space,
          { t: 'merge', merge },
          space.row.cursor,
        )
        space.outbox.push(queued)
        done.push(change, core.counterRow())
        continue
      }
      if ('refused' in result) {
        done.push(...(await refused(core, space, op, result.refused)))
        continue
      }
      done.push(...core.entryChanges(space.answered(op, result)))
    }
    done.push(...core.orderChanges(space))
    space.changed()
    await core.commit(done)
    if (!alive()) return false
    // An op the account never answered (a batch cut short) goes again next round.
  }
  return true
}

/** The ops as this space's account can take them: an account that does not say it keeps
 *  places (#1068) - one from before them, or one put back to such a build - is sent no
 *  `place` and no position, which it would not read; the rest of each op goes. */
function fitted(space: SpaceState, ops: Op[]): Op[] {
  if (space.ordering.on) return ops
  return ops.flatMap((op): Op[] => {
    if (op.t === 'place') return []
    if ((op.t === 'move' || op.t === 'mkdir' || op.t === 'create') && op.pos !== undefined) {
      const bare = { ...op }
      delete bare.pos
      return [bare]
    }
    return [op]
  })
}

/** A batch the account could not read, holding places: an account put back to a build
 *  from before them since its feed last said it keeps them. Nothing of the batch was
 *  applied, so it goes again without them, and no places go until the feed says so
 *  again (#1068). Answers whether that was it. */
function unplaced(space: SpaceState, batch: readonly Outboxed[], error: Refused) {
  if (error.status !== 400 || !space.ordering.on) return false
  const placing = (op: Op) =>
    op.t === 'place' ||
    ((op.t === 'move' || op.t === 'mkdir' || op.t === 'create') && op.pos !== undefined)
  if (!batch.some((one) => one.record.t === 'op' && placing(one.record.op))) return false
  space.ordering.on = false
  space.repositioned = true
  for (const one of batch) {
    if (one.record.t !== 'op') continue
    one.record = { t: 'op', op: one.record.op }
    one.row = { ...one.row, op: outgoingBytes(one.record) }
  }
  space.changed()
  return true
}

/** The rows of a batch put back, with the space's places. */
function changesOf(core: Core, space: SpaceState, batch: readonly Outboxed[]): Change[] {
  return [...batch.map((one) => put('outbox', one.row)), ...core.orderChanges(space)]
}

/** An op the account would not apply. Nothing of this device's is lost by any of them:
 *  the op comes out of what is shown, and the tree reads as the account has it. */
export async function refused(
  core: Core,
  space: SpaceState,
  op: Op,
  why: string,
): Promise<Change[]> {
  // A delete of something another device had written in since: the note stays, and
  // this device is told so once its words are back.
  if (op.t === 'delete' && why === 'edited') {
    const entry = space.entries.get(op.id)
    if (entry)
      core.events.resurrected?.({ id: op.id, name: entry.name, device: core.by.get(op.id) ?? '' })
    return []
  }
  // A file, a note or a folder another program made in a space this account may only
  // read. Shown as the account has it, the tree would take the file off this disk: it
  // stays where it is instead, as v1 leaves it, and this device forgets it ever made it,
  // so it is not asked about again every pass.
  if ((op.t === 'create' || op.t === 'mkdir') && why === 'role') {
    space.entries.delete(op.id)
    return [remove('entries', op.id), ...core.forgetChanges(op.id)]
  }
  // A note made here whose folder the account no longer has: made again at the top of
  // the space, rather than its words waiting on a folder that is not coming back.
  if (op.t === 'create' && why === 'gone' && op.parent !== null) {
    const again: Op = { ...op, op: core.nextId('o'), parent: null, seen: space.row.cursor }
    const { one, change } = core.outgoing(space, { t: 'op', op: again }, space.row.cursor)
    space.outbox.push(one)
    return [change, core.counterRow()]
  }
  // Something back from this device's trash that the account no longer has at all:
  // made again under its id, with what its file says (#1068).
  if (op.t === 'restore' && why === 'gone') return await remade(core, space, op.id)
  // A note the account will not make under its id even at the top of the space - an id
  // another space once made, or one of this space's own gone for good - is made again
  // under a new id, with what its file says, rather than left here unsent with nothing
  // to say so (#1068). A file waiting for its bytes is refused the same way, and sent
  // again once they are up (files.ts), so it is not one of these.
  if (op.t === 'create' && why === 'gone' && op.parent === null && op.kind !== 'file') {
    return await madeAnew(core, space, op.id)
  }
  return []
}

/** An entry this device made that the account would not make under its id, made again
 *  where its file is under a new one, with what its file says. Nothing for one the
 *  account has (`seq`), or whose file is not here to say anything. */
export async function madeAnew(core: Core, space: SpaceState, id: string): Promise<Change[]> {
  const entry = space.entries.get(id)
  if (!entry?.local_path || entry.seq !== null) return []
  const path = entry.local_path
  const full = core.world.join(space.row.root, path)
  const text = holdsDocument(entry.kind) ? await core.world.disk.read(full) : undefined
  if (text === null) return []
  space.entries.delete(id)
  space.changed()
  const changes: Change[] = [remove('entries', id), ...core.forgetChanges(id)]
  const again = await made(core, space, {
    path,
    folder: entry.kind === 'folder',
    ...(entry.kind === 'folder' ? {} : { kind: entry.kind as Exclude<EntryKind, 'folder'> }),
    ...(text === undefined ? {} : { text: unixLines(text) }),
  })
  return [...changes, ...again.changes]
}

/** An entry made again on the account under its id, where its file is on this disk. */
async function remade(core: Core, space: SpaceState, id: string): Promise<Change[]> {
  const entry = space.entries.get(id)
  if (!entry?.local_path) return []
  const full = core.world.join(space.row.root, entry.local_path)
  const text = holdsDocument(entry.kind) ? await core.world.disk.read(full) : undefined
  if (text === null) return []
  const path = entry.local_path
  entry.local_path = ''
  const again = await made(core, space, {
    path,
    folder: entry.kind === 'folder',
    id,
    kind: entry.kind as EntryKind,
    ...(text === undefined ? {} : { text }),
  })
  return again.changes
}

/** Reads the feed from the space's cursor to its end, each page written down with the
 *  cursor that moved past it. `heard` hears every item, for a first pass that needs
 *  more of them than the tree keeps. Answers whether it got to the end. */
export async function readFeed(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  heard?: (item: FeedItem) => void,
): Promise<boolean> {
  for (let page = 0; page < 10_000; page += 1) {
    const reply = await ask(core, space, 'feed', { since: space.row.cursor })
    if (!alive() || reply === null) return false
    const read = feedPageOf(reply)
    if (!read) throw new Error('the account answered the feed with something else')

    const changes: Change[] = []
    const wanted = core.wanted(space.id)
    for (const item of read.items) {
      heard?.(item)
      core.by.set(item.id, item.by)
      const had = space.entries.get(item.id)
      if (had && had.seq !== null && had.seq >= item.seq) continue
      const entry: EntryRow = had ?? {
        id: item.id,
        space_id: space.id,
        kind: item.kind,
        parent: item.parent,
        name: item.name,
        local_path: '',
        file_key: null,
        written_hash: null,
        mtime: null,
        size: null,
        seq: item.seq,
        deleted: item.deleted,
      }
      entry.kind = item.kind
      entry.parent = item.parent
      entry.name = item.name
      entry.deleted = item.deleted
      entry.seq = item.seq
      if (item.kind === 'file') {
        entry.file_key = item.hash || null
        entry.size = item.size
      } else if (core.world.lazy && shapeOf(item.kind)) {
        // How long its words are and when they last moved: what the file list says of a
        // document this device may keep no words of (keeping.ts, #1126).
        entry.size = item.size
        entry.mtime = item.at
      }
      if (space.ordering.positions.get(item.id) !== item.pos) {
        if (item.pos === undefined) space.ordering.positions.delete(item.id)
        else space.ordering.positions.set(item.id, item.pos)
        space.repositioned = true
      }
      space.entries.set(item.id, entry)
      changes.push(put('entries', { ...entry }))

      if (item.epoch !== undefined) core.epochs.set(item.id, item.epoch)
      if (shapeOf(item.kind) && item.docSeq !== undefined) {
        const pulled = core.numbers.get(item.id)?.pulled ?? -1
        if (item.docSeq > pulled || !core.hasDoc(item.id)) {
          wanted.set(item.id, { docSeq: item.docSeq, epoch: item.epoch ?? 1 })
        }
      }
    }

    // An account that keeps places says so on every page; one put back to a build from
    // before them stops saying it, and is sent none again.
    if (space.ordering.on !== (read.order === true)) {
      space.ordering.on = read.order === true
      space.repositioned = true
    }
    // And one that answers for the notes a browser keeps no words of says that too; one
    // that stops saying it is kept whole again, from the next pull (keeping.ts, #1126).
    if (space.keeping.on !== (read.index === true)) {
      space.keeping.on = read.index === true
      if (!space.keeping.on) delete space.keeping.refused
      changes.push(keepingChange(space))
    }
    const asked = space.row.cursor
    space.row.cursor = Math.max(space.row.cursor, read.cursor)
    changes.push(
      put('spaces', { ...space.row }),
      core.wantChange(space.id),
      ...core.orderChanges(space),
    )
    space.changed()
    await core.commit(changes)
    if (!alive()) return false
    if (!read.more || space.row.cursor === asked) return true
  }
  return true
}

/** The disk, made to agree with the tree. */
export async function settleDisk(core: Core, space: SpaceState) {
  const forgets: Change[] = []
  const moved = await settle(space, {
    disk: core.world.disk,
    join: (folder, path) => core.world.join(folder, path),
    keeps: (id) => core.hasPending(id) || core.isHeld(id),
    forget: (id) => forgets.push(...core.forgetChanges(id)),
    busy: (id) => core.inHand.has(id),
  })
  await core.commit([...core.entryChanges(moved), ...forgets])
}

// ---------------------------------------------------------------------------
// 5. Pulls

/** Whether a document may be pulled now: shown, this device's to read into, and holding
 *  nothing of this device's that has not gone up. A pull never lands on pending edits
 *  made while apart: those go up first and meet the account's words as `moved`. */
function pullable(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null || !space.isLive(entry.id)) return false
  // Another sync tool's copy is never brought here (`foreign` in places.ts).
  if (space.foreign(entry.id)) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id) || core.hasPending(entry.id)) return false
  // Where this device keeps only the words it uses, only those (keeping.ts).
  if (!keptHere(core, space, entry)) return false
  return core.wanted(space.id).has(entry.id) || !core.hasDoc(entry.id)
}

/** Some documents' words, pulled now and written to their files, epochs and all: what
 *  opening a note this device keeps no words of asks for (keeping.ts, #1126). Answers
 *  false when the account did not answer. */
export async function pullNow(
  core: Core,
  space: SpaceState,
  ids: ReadonlySet<string>,
  alive: () => boolean,
): Promise<boolean> {
  for (let round = 0; round < ROUNDS; round += 1) {
    const pulled = await pullDocs(core, space, alive, ids)
    if (pulled === null) return false
    if (!pulled) break
  }
  return true
}

/** Pulls one batch - of `only`, where it is given. Answers how many documents it brought,
 *  or null when the account did not answer. */
async function pullDocs(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
  only?: ReadonlySet<string>,
): Promise<number | null> {
  const due = [...space.entries.values()].filter(
    (entry) => (!only || only.has(entry.id)) && pullable(core, space, entry),
  )
  if (!due.length) return 0
  const wanted = core.wanted(space.id)

  let brought = 0
  for (let at = 0; at < due.length; at += PULL_BATCH) {
    const batch = due.slice(at, at + PULL_BATCH)
    const asking: PullDoc[] = []
    /** What each document was when it was asked about: an answer is a diff against
     *  that, and lands on nothing else. */
    const asked = new Map<string, Doc | null>()
    for (const entry of batch) {
      const doc = await core.doc(entry.id)
      const epoch = doc?.epoch ?? wanted.get(entry.id)?.epoch ?? 1
      asked.set(entry.id, doc)
      asking.push({ id: entry.id, epoch, sv: doc ? doc.confirmedSv() : EMPTY_SV })
    }
    const reply = await ask(core, space, 'pull', { docs: asking })
    if (!alive() || reply === null) return null
    const answer = pullResponseOf(reply)
    if (!answer) throw new Error('the account answered the pull with something else')

    const changes: Change[] = []
    for (const one of answer.docs) {
      const entry = space.entries.get(one.id)
      if (!entry) continue
      // Typed into, or held, while the pull was in the air: the push brings the
      // account's words back through `moved`, where they are classified.
      if (core.hasPending(one.id) || core.isHeld(one.id) || core.carried.has(one.id)) continue

      if ('refused' in one) {
        wanted.delete(one.id)
        continue
      }
      const shape = shapeOf(entry.kind) ?? 'words'
      let doc = await core.doc(one.id)
      // Deleted, dropped or made again here while the pull was in the air: the answer
      // is a diff against a document this device no longer holds.
      if (doc !== (asked.get(one.id) ?? null) || !space.isLive(one.id)) continue

      if ('epoch' in one) {
        // A new epoch, with nothing here that is not the account's: this device starts
        // the new document from nothing, and the next round pulls it whole.
        if (doc) {
          doc.restart(Y.encodeStateAsUpdateV2(new Y.Doc()), 0, one.epoch, core.freshClient())
          doc.pulled = 0
          changes.push(...core.docChanges(doc))
        }
        wanted.set(one.id, { docSeq: wanted.get(one.id)?.docSeq ?? 0, epoch: one.epoch })
        brought += 1
        continue
      }

      doc ??= core.made(one.id, shape, wanted.get(one.id)?.epoch ?? 1)
      doc.took(one.update, one.seq)
      doc.pulled = Math.max(doc.pulled, wanted.get(one.id)?.docSeq ?? 0)
      wanted.delete(one.id)
      changes.push(...core.docChanges(doc))
      try {
        changes.push(...(await foldedThenProjected(core, space, entry, doc)))
      } catch (error) {
        changes.push(...notWritten(core, space, entry, doc, error))
      }
      if (!wanted.has(one.id)) brought += 1
    }
    changes.push(core.wantChange(space.id))
    await core.commit(changes)
    if (!alive()) return null
  }
  return brought
}

/** A file written with a document's words - after any change another program made to it
 *  since Orden last wrote it has been folded in, so nothing is written over. */
async function foldedThenProjected(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  const changes = entry.local_path ? await foldIn(core, space, entry) : []
  if (core.isHeld(entry.id)) return changes
  return [...changes, ...(await project(core, space, entry, doc))]
}

// ---------------------------------------------------------------------------
// 6. A day's note, twice

async function mergeDays(core: Core, space: SpaceState) {
  for (const one of [...space.outbox]) {
    if (one.record.t !== 'merge') continue
    const { mine, into, create } = one.record.merge
    const changes: Change[] = []
    const ours = await core.doc(mine)
    const words = ours?.text() ?? null
    const done = () => {
      space.outbox = space.outbox.filter((other) => other !== one)
      changes.push(remove('outbox', one.row.op_id))
    }

    if (words === null) {
      done()
      await core.commit(changes)
      continue
    }

    // The note it was to go into was deleted meanwhile: it is made after all, as a
    // note of its own, rather than its words waiting for a note that will not come.
    const target = space.entries.get(into)
    if (target?.deleted) {
      const plain: Op = { ...create, op: core.nextId('o'), seen: space.row.cursor }
      delete (plain as { mergeable?: unknown }).mergeable
      const { one: queued, change } = core.outgoing(space, { t: 'op', op: plain }, space.row.cursor)
      space.outbox.push(queued)
      done()
      await core.commit([...changes, change, core.counterRow()])
      continue
    }

    const theirs = await core.doc(into)
    if (!theirs || !target || core.hasPending(into) || core.isHeld(into)) continue
    const base = create.mergeable?.text ?? ''
    const remote = theirs.text()
    if (target.parent === null && carriedOwn(target.name)) {
      // The space's own inbox, made apart on two devices: every task of both, each
      // once, never a question about a file nobody opens (#1044). Two devices moving
      // one old inbox in make the same list, which is then that list once.
      const resolution = withTasksOf(remote, words)
      theirs.write((live) => turn(theirs.shape, live, remote, resolution, MINE))
      theirs.flush()
      changes.push(...core.docChanges(theirs))
      changes.push(...(await project(core, space, target, theirs)))
    } else {
      const times = { local: ours?.pendingAt ?? 0, remote: theirs.pendingAt }
      const judged = judge(theirs.shape, base, words, remote, times)
      const held = judged.resolution === null
      core.classified.push({
        id: into,
        base,
        local: words,
        remote,
        times,
        held,
        ...(judged.merged === undefined ? {} : { merged: judged.merged }),
      })

      if (judged.resolution === null) {
        const against = { t: 'merge', base, local: words, from: mine } as const
        const holding: Holding = {
          row: {
            id: into,
            remote: againstBytes(against),
            remote_sv: new Uint8Array(),
            device: core.by.get(into) ?? null,
            at: core.world.now(),
          },
          against,
        }
        changes.push(...core.holdChanges(holding))
      } else {
        const resolution = judged.resolution
        changes.push(...keepLosers(core, space, into, judged.lost, words, remote))
        theirs.write((live) => turn(theirs.shape, live, remote, resolution, MINE))
        theirs.flush()
        changes.push(...core.docChanges(theirs))
        changes.push(...(await project(core, space, target, theirs)))
      }
    }

    // This device's own day note goes: its words are in the one that was there.
    const own = space.entries.get(mine)
    if (own?.local_path && !core.pinned.has(mine)) {
      const full = core.world.join(space.row.root, own.local_path)
      if (await core.world.disk.exists(full)) await core.world.disk.remove(full, 'file')
    }
    space.entries.delete(mine)
    changes.push(remove('entries', mine), ...core.forgetChanges(mine))
    done()
    space.changed()
    await core.commit(changes)
  }
}

// ---------------------------------------------------------------------------
// 7. Pushes

function pushable(core: Core, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id) || resting(core, entry.id)) return false
  return core.hasPending(entry.id)
}

/** A document whose pushes the account keeps refusing: an update past the ceiling, a
 *  note it does not have (a space this device may only read is `readOnly`'s). Asking
 *  again every two seconds changes none of that, so it waits longer each time (`AGAIN`,
 *  up to `LONGEST`) and the log says so once a streak. `gone` is said only after
 *  `GONE_SAID` in a row, since a room that did not answer reads as `gone` too. Any other
 *  answer ends it. The words stay here, pending, the whole time. Memory only: a launch
 *  asks again. */
interface Refusal {
  why: DocRefusal
  times: number
  until: number
  said: boolean
}

const AGAIN = 2_000
const LONGEST = 30 * 60_000
const GONE_SAID = 3

const refusals = new WeakMap<Core, Map<string, Refusal>>()

function refusalsOf(core: Core): Map<string, Refusal> {
  let held = refusals.get(core)
  if (!held) {
    held = new Map()
    refusals.set(core, held)
  }
  return held
}

/** Whether a document's push waits out a refusal: not pushed, and no reason for another
 *  pass (`Engine.waiting`). */
export function resting(core: Core, id: string): boolean {
  const one = refusals.get(core)?.get(id)
  return one !== undefined && one.until > core.world.now()
}

/** A refusal written down. Answers whether it is the one to say. */
function refusedAgain(core: Core, id: string, why: DocRefusal): boolean {
  const held = refusalsOf(core)
  const before = held.get(id)
  const one: Refusal = before?.why === why ? before : { why, times: 0, until: 0, said: false }
  one.times += 1
  one.until = core.world.now() + Math.min(AGAIN * 4 ** (one.times - 1), LONGEST)
  held.set(id, one)
  if (one.said || (why === 'gone' && one.times < GONE_SAID)) return false
  one.said = true
  return true
}

/** The account's own words for a refusal, which the Sync pane translates as it does
 *  every message the account sends. */
const REFUSED: Record<DocRefusal, string> = {
  role: 'you can only read this space',
  large: 'that note is too large',
  gone: 'no such note',
}

/** A line in the log for each reason, under the space the log row names. */
function refusalRows(core: Core, space: SpaceState, said: Set<DocRefusal>): Change[] {
  return [...said].map((why) =>
    put('log', {
      at: core.world.now(),
      space: space.id,
      pulled: null,
      pushed: null,
      failed: REFUSED[why],
    }),
  )
}

/** Answers how many documents went up, or null when the account did not answer. */
async function pushDocs(
  core: Core,
  space: SpaceState,
  alive: () => boolean,
): Promise<number | null> {
  const due = [...space.entries.values()].filter((entry) => pushable(core, entry))
  const said = new Set<DocRefusal>()
  let pushed = 0

  for (let at = 0; at < due.length; at += PUSH_BATCH) {
    const going: PushDoc[] = []
    const docs = new Map<string, Doc>()
    const before: Change[] = []
    for (const entry of due.slice(at, at + PUSH_BATCH)) {
      const doc = await core.doc(entry.id)
      if (!doc) continue
      doc.flush()
      const out = doc.outgoing(() => core.nextId('p'))
      if (!out) continue
      docs.set(doc.id, doc)
      going.push({
        id: doc.id,
        push: out.push,
        epoch: doc.epoch,
        seq: doc.seq,
        base: doc.confirmedSv(),
        update: out.update,
        at: doc.pendingAt,
      })
      before.push(...core.docChanges(doc))
    }
    if (!going.length) continue
    // The push is written down before it goes, so a lost answer sends it again as it was.
    await core.commit([...before, core.counterRow()])
    if (!alive()) return null

    const reply = await ask(core, space, 'push', { docs: going })
    if (!alive() || reply === null) return null
    const answer = pushResponseOf(reply)
    if (!answer) throw new Error('the account answered the push with something else')

    const changes: Change[] = []
    for (const one of answer.docs) {
      const doc = docs.get(one.id)
      const entry = space.entries.get(one.id)
      // Deleted here while the push was in the air: nothing of it goes on.
      if (!doc || !entry || !core.current(doc)) continue
      if ('refused' in one && one.refused === 'role') {
        doc.land()
        refusals.get(core)?.delete(one.id)
        said.add(one.refused)
        changes.push(...(await readOnly(core, space, entry, doc)))
        continue
      }
      if ('refused' in one) {
        // What it holds stays here, pending, and waits; see `Refusal`.
        doc.land()
        if (refusedAgain(core, one.id, one.refused)) said.add(one.refused)
        changes.push(...core.docChanges(doc))
        continue
      }
      refusals.get(core)?.delete(one.id)
      if ('ok' in one) {
        doc.confirmFlight(one.seq)
        pushed += 1
      } else if ('moved' in one) {
        doc.land()
        if (!core.isHeld(one.id)) {
          const by = core.by.get(one.id) ?? null
          changes.push(...(await rejoin(core, space, doc, one.moved, one.seq, one.at, by)).changes)
          if (!core.isHeld(one.id)) changes.push(...(await project(core, space, entry, doc)))
        }
      } else {
        doc.land()
        changes.push(...(await newEpoch(core, space, entry, doc, one.epoch)))
      }
      changes.push(...core.docChanges(doc))
    }
    await core.commit([...changes, ...refusalRows(core, space, said)])
    said.clear()
    if (!alive()) return null
  }
  return pushed
}

/** A push refused because this account may only read the space: another program
 *  changed the file (an editor, a `git pull`), or the role was lowered while this device
 *  was offline with an edit. Waiting changes nothing, and kept pending the edit would
 *  stand between this device and every word the owner writes after, since a pull never
 *  lands on pending edits. So the edit goes and the owner's words are written back, with
 *  this device's kept as a version on this device first: the account will take nothing
 *  from a reader, not even a version, so this disk is the one place it can go.
 *
 *  Only on the account's refusal, never on the role this device remembers: that can be
 *  out of date, and a writer whose edit was dropped on an old `read` would lose it. */
async function readOnly(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
): Promise<Change[]> {
  const local = doc.text()
  if (entry.local_path && local.trim()) {
    const full = core.world.join(space.row.root, entry.local_path)
    const was = await core.world.disk.read(full)
    // What the file says is kept by `project` as it writes over it; words typed here
    // that never reached the file are kept now.
    if (was === null || unixLines(was) !== local) await core.world.disk.keep(full, local)
  }
  doc.letPendingGo(core.freshClient())
  return [...core.docChanges(doc), ...(await project(core, space, entry, doc))]
}

/** The account started the document again at a new epoch while this device held pending
 *  edits on the old one (section 5.3). The operations cannot be merged into the new
 *  document, so the fallback is three texts: the confirmed words as the ancestor, this
 *  device's, and the new document's. The document becomes the account's, and this
 *  device's edits go in as operations or, when they overlap too much, wait for the
 *  modal as another program's edit to the file would. */
async function newEpoch(
  core: Core,
  space: SpaceState,
  entry: EntryRow,
  doc: Doc,
  epoch: number,
): Promise<Change[]> {
  const reply = await ask(core, space, 'pull', { docs: [{ id: doc.id, epoch, sv: EMPTY_SV }] })
  const answer = reply === null ? null : pullResponseOf(reply)
  const whole = answer?.docs.find((one) => one.id === doc.id)
  if (!whole || !('update' in whole)) return []

  const base = doc.confirmedText()
  const local = doc.text()
  const remote = fileOfUpdates(doc.shape, whole.update)
  doc.restart(whole.update, whole.seq, epoch, core.freshClient())
  if (local === remote || local === base) return await project(core, space, entry, doc)

  const times = { local: doc.pendingAt, remote: core.world.now() }
  const judged = judge(doc.shape, base, local, remote, times)
  core.classified.push({
    id: doc.id,
    base,
    local,
    remote,
    times,
    held: judged.resolution === null,
    ...(judged.merged === undefined ? {} : { merged: judged.merged }),
  })
  if (judged.resolution === null) {
    const against = { t: 'file', base, local } as const
    return core.holdChanges({
      row: {
        id: doc.id,
        remote: againstBytes(against),
        remote_sv: new Uint8Array(),
        device: core.by.get(doc.id) ?? null,
        at: core.world.now(),
      },
      against,
    })
  }
  const resolution = judged.resolution
  const changes = keepLosers(core, space, doc.id, judged.lost, local, remote)
  doc.write((live) => turn(doc.shape, live, remote, resolution, MINE))
  doc.flush()
  changes.push(...core.docChanges(doc), ...(await project(core, space, entry, doc)))
  return changes
}
