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

export interface Passed {
  pulled: number
  pushed: number
  finished: boolean
  full: boolean
}

const EMPTY_SV = Y.encodeStateVector(new Y.Doc())

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
  passed.finished = true
  return passed
}

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

async function sendKeeps(core: Core, space: SpaceState, alive: () => boolean): Promise<boolean> {
  for (const one of [...space.outbox]) {
    if (one.record.t !== 'keep') continue
    try {
      const reply = await ask(core, space, 'keep', one.record.keep)
      if (!alive() || reply === null) return false
    } catch (error) {
      if (!(error instanceof Refused)) throw error
      if (!alive()) return false
    }
    space.outbox = space.outbox.filter((other) => other !== one)
    await core.commit([remove('outbox', one.row.op_id)])
  }
  return true
}

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
  }
  return true
}

function fitted(space: SpaceState, ops: Op[]): Op[] {
  const { on, describes } = space.ordering
  if (on && describes) return ops
  return ops.flatMap((op): Op[] => {
    if (op.t === 'meta') return describes ? [op] : []
    if (on) return [op]
    if (op.t === 'place') return []
    if ((op.t === 'move' || op.t === 'mkdir' || op.t === 'create') && op.pos !== undefined) {
      const bare = { ...op }
      delete bare.pos
      return [bare]
    }
    return [op]
  })
}

function unplaced(space: SpaceState, batch: readonly Outboxed[], error: Refused) {
  if (error.status !== 400) return false
  const placing = (op: Op) =>
    op.t === 'place' ||
    ((op.t === 'move' || op.t === 'mkdir' || op.t === 'create') && op.pos !== undefined)
  const ops = batch.flatMap((one) => (one.record.t === 'op' ? [one.record.op] : []))
  const places = space.ordering.on && ops.some(placing)
  const describes = space.ordering.describes && ops.some((op) => op.t === 'meta')
  if (!places && !describes) return false
  if (places) space.ordering.on = false
  if (describes) space.ordering.describes = false
  space.repositioned = true
  for (const one of batch) {
    if (one.record.t !== 'op') continue
    one.record = { t: 'op', op: one.record.op }
    one.row = { ...one.row, op: outgoingBytes(one.record) }
  }
  space.changed()
  return true
}

function changesOf(core: Core, space: SpaceState, batch: readonly Outboxed[]): Change[] {
  return [...batch.map((one) => put('outbox', one.row)), ...core.orderChanges(space)]
}

export async function refused(
  core: Core,
  space: SpaceState,
  op: Op,
  why: string,
): Promise<Change[]> {
  if (op.t === 'delete' && why === 'edited') {
    const entry = space.entries.get(op.id)
    if (entry)
      core.events.resurrected?.({ id: op.id, name: entry.name, device: core.by.get(op.id) ?? '' })
    return []
  }
  if ((op.t === 'create' || op.t === 'mkdir') && why === 'role') {
    space.entries.delete(op.id)
    return [remove('entries', op.id), ...core.forgetChanges(op.id)]
  }
  if (op.t === 'create' && why === 'gone' && op.parent !== null) {
    const again: Op = { ...op, op: core.nextId('o'), parent: null, seen: space.row.cursor }
    const { one, change } = core.outgoing(space, { t: 'op', op: again }, space.row.cursor)
    space.outbox.push(one)
    return [change, core.counterRow()]
  }
  if (op.t === 'restore' && why === 'gone') return await remade(core, space, op.id)
  if (op.t === 'create' && why === 'gone' && op.parent === null && op.kind !== 'file') {
    return await madeAnew(core, space, op.id)
  }
  return []
}

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
    if (read.device !== undefined) core.mine.add(read.device)

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
        entry.size = item.size
        entry.mtime = item.at
      }
      if (space.ordering.positions.get(item.id) !== item.pos) {
        if (item.pos === undefined) space.ordering.positions.delete(item.id)
        else space.ordering.positions.set(item.id, item.pos)
        space.repositioned = true
      }
      space.heardMeta(item.id, item.meta)
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

    if (space.ordering.on !== (read.order === true)) {
      space.ordering.on = read.order === true
      space.repositioned = true
    }
    if (space.ordering.describes !== (read.meta === true)) {
      space.ordering.describes = read.meta === true
      space.repositioned = true
    }
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

function pullable(core: Core, space: SpaceState, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null || !space.isLive(entry.id)) return false
  if (space.foreign(entry.id)) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id) || core.hasPending(entry.id)) return false
  if (!keptHere(core, space, entry)) return false
  return core.wanted(space.id).has(entry.id) || !core.hasDoc(entry.id)
}

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
      if (core.hasPending(one.id) || core.isHeld(one.id) || core.carried.has(one.id)) continue

      if ('refused' in one) {
        wanted.delete(one.id)
        continue
      }
      const shape = shapeOf(entry.kind) ?? 'words'
      let doc = await core.doc(one.id)
      if (doc !== (asked.get(one.id) ?? null) || !space.isLive(one.id)) continue

      if ('epoch' in one) {
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

function pushable(core: Core, entry: EntryRow): boolean {
  if (!Core.isDocument(entry) || entry.seq === null) return false
  if (core.isHeld(entry.id) || core.carried.has(entry.id) || resting(core, entry.id)) return false
  return core.hasPending(entry.id)
}

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

export function resting(core: Core, id: string): boolean {
  const one = refusals.get(core)?.get(id)
  return one !== undefined && one.until > core.world.now()
}

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

const REFUSED: Record<DocRefusal, string> = {
  role: 'you can only read this space',
  large: 'that note is too large',
  gone: 'no such note',
}

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
      if (!doc || !entry || !core.current(doc)) continue
      if ('refused' in one && one.refused === 'role') {
        doc.land()
        refusals.get(core)?.delete(one.id)
        said.add(one.refused)
        changes.push(...(await readOnly(core, space, entry, doc)))
        continue
      }
      if ('refused' in one) {
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
    if (was === null || unixLines(was) !== local) await core.world.disk.keep(full, local)
  }
  doc.letPendingGo(core.freshClient())
  return [...core.docChanges(doc), ...(await project(core, space, entry, doc))]
}

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
