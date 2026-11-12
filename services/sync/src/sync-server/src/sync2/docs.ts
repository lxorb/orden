import { diffUpdateV2 } from 'yjs'
import {
  type DocRefusal,
  frame,
  type KeepRequest,
  MOST_UPDATE_BYTES,
  PULL_BYTES,
  type PullAnswer,
  type PullDoc,
  type PushAnswer,
  type PushDoc,
  type SnapshotDoc,
  unframe,
} from '@orden/sync-core'
import { byteLength, sha256 } from '../crypto'
import { noteKey } from '../notes'
import { askRoom, ROOM_LATE } from '../rooms'
import { seedOf, seedsAnything, snapshotKey } from '../rooms/epoch'
import { noteKind } from '../rooms/kind'
import { allows, reachedItem, reachedSpace, type Role } from '../spaces/space'
import type { Env, Note, Whoever } from '../types'
import { keepVersionNow, versionsFit } from '../versions'
import { prepareSpace } from './prepare'
import { DOCUMENT_KINDS, DOCUMENTS_SQL } from './tree'

interface Reached {
  note: Note
  role: Role
}

async function reachedNotes(
  env: Env,
  who: Whoever,
  ids: readonly string[],
): Promise<Map<string, Reached>> {
  const { results } = await env.DB.prepare(
    `select * from notes where id in (select value from json_each(?))
        and not (deleted = 1 and deleted_at is null)`,
  )
    .bind(JSON.stringify([...new Set(ids)]))
    .all<Note>()

  const spaces = new Map<string, Role | null>()
  const out = new Map<string, Reached>()
  for (const note of results) {
    if (!spaces.has(note.space_id)) {
      spaces.set(note.space_id, (await reachedSpace(env, who, note.space_id))?.role ?? null)
    }
    const role = spaces.get(note.space_id) ?? null
    if (role) {
      out.set(note.id, { note, role })
      continue
    }
    if (note.deleted) continue
    const item = await reachedItem(env, who, note)
    if (item) out.set(note.id, { note, role: item.role })
  }
  return out
}

async function onEpochs(env: Env, found: Map<string, Reached>): Promise<void> {
  const spaces = new Set<string>()
  for (const { note } of found.values()) {
    if ((note.epoch ?? 0) === 0 && DOCUMENT_KINDS.has(note.kind ?? 'note'))
      spaces.add(note.space_id)
  }
  if (!spaces.size) return

  for (const space of spaces) await prepareSpace(env, space)
  const ids = [...found.values()].filter(({ note }) => spaces.has(note.space_id))
  for (const { note } of ids) {
    const fresh = await env.DB.prepare('select * from notes where id = ?')
      .bind(note.id)
      .first<Note>()
    const held = found.get(note.id)
    if (fresh && held) held.note = fresh
  }
}

export async function documentOf(
  env: Env,
  note: Note,
): Promise<{ update: Uint8Array; seq: number } | null> {
  const epoch = note.epoch ?? 0
  const kept = await env.NOTES.get(snapshotKey(note.id))
  if (kept && kept.customMetadata?.epoch === String(epoch)) {
    return {
      update: new Uint8Array(await kept.arrayBuffer()),
      seq: Number(kept.customMetadata.seq ?? 0) || 0,
    }
  }

  const object = await env.NOTES.get(noteKey(note.space_id, note.id))
  const body = object ? await object.text() : ''
  if ((await sha256(body)) !== note.epoch_base) return null

  const update = seedOf(noteKind(note), note.id, epoch, body)
  return { update, seq: seedsAnything(update) ? 1 : 0 }
}

const AT_ONCE = 6

const PULL_PATIENCE = 25_000

export async function pullDocs(
  env: Env,
  who: Whoever,
  docs: readonly PullDoc[],
  part = false,
): Promise<PullAnswer[] | null> {
  const found = await reachedNotes(
    env,
    who,
    docs.map((doc) => doc.id),
  )
  await onEpochs(env, found)

  const answers = new Array<PullAnswer | null>(docs.length).fill(null)
  const until = Date.now() + PULL_PATIENCE
  let bytes = 0
  const late = new Set<number>()
  let next = 0
  const enough = () => part && (bytes >= PULL_BYTES || Date.now() >= until)
  const worker = async () => {
    for (let at = next++; at < docs.length && !enough(); at = next++) {
      const doc = docs[at]
      if (!doc) continue
      const one = await pulled(env, found.get(doc.id), doc)
      if (!one) {
        late.add(at)
        continue
      }
      answers[at] = one
      if ('update' in one) bytes += one.update.length
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, docs.length) }, worker))
  if (late.size && !part) return null

  const out: PullAnswer[] = []
  let sent = 0
  for (const one of answers) {
    if (part && out.length && sent >= PULL_BYTES) break
    if (!one) continue
    out.push(one)
    if ('update' in one) sent += one.update.length
  }
  return out
}

async function pulled(
  env: Env,
  found: Reached | undefined,
  doc: PullDoc,
): Promise<PullAnswer | null> {
  const note = found?.note
  if (!note || !DOCUMENT_KINDS.has(note.kind ?? 'note')) return { id: doc.id, refused: 'gone' }

  const epoch = note.epoch ?? 0
  if (epoch !== doc.epoch) return { id: doc.id, epoch, epochBase: note.epoch_base ?? '' }

  try {
    const held = await documentOf(env, note)
    if (held) return { id: doc.id, update: diffUpdateV2(held.update, doc.sv), seq: held.seq }

    const answer = await askRoom(env, note, 'pull', frame({ sv: doc.sv }))
    if (answer === ROOM_LATE) return null
    if (!answer?.ok) return { id: doc.id, refused: 'gone' }
    const said = roomAnswer(new Uint8Array(await answer.arrayBuffer()))
    const { update, seq } = said
    if (update instanceof Uint8Array && typeof seq === 'number') return { id: doc.id, update, seq }
  } catch {
    // A state vector that does not read as one names nothing to diff against.
  }
  return { id: doc.id, refused: 'gone' }
}

function roomAnswer(bytes: Uint8Array): Record<string, unknown> {
  const value = unframe(bytes)
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export async function pushDocs(
  env: Env,
  who: Whoever,
  device: string,
  name: string,
  docs: readonly PushDoc[],
): Promise<PushAnswer[]> {
  const found = await reachedNotes(
    env,
    who,
    docs.map((doc) => doc.id),
  )
  await onEpochs(env, found)

  const answers: PushAnswer[] = new Array<PushAnswer>(docs.length)
  let next = 0
  const worker = async () => {
    for (let at = next++; at < docs.length; at = next++) {
      const doc = docs[at]
      if (doc) answers[at] = await pushed(env, found.get(doc.id), doc, device, name)
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, docs.length) }, worker))
  return answers
}

function refused(id: string, why: DocRefusal): PushAnswer {
  return { id, refused: why }
}

async function pushed(
  env: Env,
  found: Reached | undefined,
  doc: PushDoc,
  device: string,
  name: string,
): Promise<PushAnswer> {
  const note = found?.note
  if (!note || !DOCUMENT_KINDS.has(note.kind ?? 'note')) return refused(doc.id, 'gone')
  if (!allows(found.role, 'write')) return refused(doc.id, 'role')
  if (doc.update.length > MOST_UPDATE_BYTES) return refused(doc.id, 'large')

  const epoch = note.epoch ?? 0
  if (epoch !== doc.epoch) return { id: doc.id, epoch }

  const answer = await askRoom(
    env,
    note,
    'push',
    frame({
      push: doc.push,
      epoch: doc.epoch,
      seq: doc.seq,
      base: doc.base,
      update: doc.update,
      at: doc.at,
      device,
      name,
    }),
  )
  if (answer === ROOM_LATE || !answer?.ok) return refused(doc.id, 'gone')

  const said = roomAnswer(new Uint8Array(await answer.arrayBuffer()))
  const { ok, seq, sv, moved, at, epoch: newer } = said
  if (ok === true && typeof seq === 'number' && sv instanceof Uint8Array) {
    return { id: doc.id, ok: true, seq, sv }
  }
  if (moved instanceof Uint8Array && typeof seq === 'number' && sv instanceof Uint8Array) {
    return { id: doc.id, moved, seq, sv, at: typeof at === 'number' ? at : 0 }
  }
  if (typeof newer === 'number') return { id: doc.id, epoch: newer }
  const why = said.refused
  return refused(doc.id, why === 'large' || why === 'role' ? why : 'gone')
}

export async function keepDoc(
  env: Env,
  who: Whoever,
  request: KeepRequest,
): Promise<'kept' | 'gone' | 'role' | 'full'> {
  const found = (await reachedNotes(env, who, [request.id])).get(request.id)
  if (!found || !DOCUMENT_KINDS.has(found.note.kind ?? 'note')) return 'gone'
  if (!allows(found.role, 'write')) return 'role'
  if (!(await versionsFit(env, found.note.id, byteLength(request.text)))) return 'full'

  await keepVersionNow(env, found.note.id, request.text, request.device)
  return 'kept'
}

const PAGE_BYTES = 4 * 1024 * 1024
const PAGE_DOCS = 200

export async function snapshotPage(
  env: Env,
  spaceId: string,
  after: string,
): Promise<{ docs: SnapshotDoc[]; next: string | null }> {
  const { results } = await env.DB.prepare(
    `select * from notes where space_id = ? and deleted = 0 and kind in ${DOCUMENTS_SQL}
        and id > ? order by id limit ?`,
  )
    .bind(spaceId, after, PAGE_DOCS)
    .all<Note>()

  const docs: SnapshotDoc[] = []
  let bytes = 0
  for (const note of results) {
    if (docs.length && bytes >= PAGE_BYTES) return { docs, next: docs.at(-1)?.id ?? null }

    const held = await documentOf(env, note)
    const epoch = note.epoch ?? 0
    if (!held) {
      continue
    }
    const doc: SnapshotDoc = { id: note.id, epoch, seq: held.seq, update: held.update }
    if (note.epoch_base) doc.epochBase = note.epoch_base
    docs.push(doc)
    bytes += held.update.length
  }

  const last = results.at(-1)
  return { docs, next: results.length === PAGE_DOCS && last ? last.id : null }
}
