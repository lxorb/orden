import { type ItemMeta, type MetaPatch, metaOf, metaPatchOf } from './meta'
import { isPosition } from './order'

export type EntryKind = 'note' | 'canvas' | 'pages' | 'url' | 'term' | 'chat' | 'file' | 'folder'

export const ENTRY_KINDS: readonly EntryKind[] = [
  'note',
  'canvas',
  'pages',
  'url',
  'term',
  'chat',
  'file',
  'folder',
]

export interface FeedItem {
  id: string
  kind: EntryKind
  parent: string | null
  name: string
  deleted: boolean
  seq: number
  docSeq?: number
  epoch?: number
  epochBase?: string
  hash: string
  size: number
  by: string
  at: number
  pos?: string
  meta?: ItemMeta
}

export interface FeedPage {
  items: FeedItem[]
  cursor: number
  more: boolean
  order?: true
  meta?: true
  index?: true
  device?: string
}

export const FEED_PAGE = 1000

export const OPS_BATCH = 200

interface OpBase {
  op: string
  seen: number
}

export interface MkdirOp extends OpBase {
  t: 'mkdir'
  id: string
  parent: string | null
  name: string
  pos?: string
}

export interface CreateOp extends OpBase {
  t: 'create'
  id: string
  kind: Exclude<EntryKind, 'folder'>
  parent: string | null
  name: string
  hash?: string
  mergeable?: { text: string }
  pos?: string
}

export interface RenameOp extends OpBase {
  t: 'rename'
  id: string
  name: string
}

export interface MoveOp extends OpBase {
  t: 'move'
  id: string
  parent: string | null
  name?: string
  pos?: string
}

export interface PlaceOp extends OpBase {
  t: 'place'
  id: string
  pos: string
}

export interface MetaOp extends OpBase {
  t: 'meta'
  id: string
  meta: MetaPatch
}

export interface DeleteOp extends OpBase {
  t: 'delete'
  id: string
}

export interface RestoreOp extends OpBase {
  t: 'restore'
  id: string
}

export type Op = MkdirOp | CreateOp | RenameOp | MoveOp | DeleteOp | RestoreOp | PlaceOp | MetaOp

export type Refusal = 'cycle' | 'edited' | 'role' | 'gone'

export type OpResult =
  | { op: string; ok: true }
  | { op: string; ok: true; id: string; parent: string | null; name: string }
  | { op: string; merged: string }
  | { op: string; refused: Refusal }

export interface OpsRequest {
  ops: Op[]
}

export interface OpsResponse {
  results: OpResult[]
  cursor: number
}

export const MOST_UPDATE_BYTES = 4 * 1024 * 1024

export const PULL_BATCH = 200
export const PUSH_BATCH = 50
export const PUSH_BYTES = 6 * 1024 * 1024

export type DocRefusal = 'role' | 'gone' | 'large'

export interface PullDoc {
  id: string
  epoch: number
  sv: Uint8Array
}

export interface PullRequest {
  docs: PullDoc[]
}

export type PullAnswer =
  | { id: string; update: Uint8Array; seq: number }
  | { id: string; epoch: number; epochBase: string }
  | { id: string; refused: DocRefusal }

export interface PullResponse {
  docs: PullAnswer[]
}

export interface PushDoc {
  id: string
  push: string
  epoch: number
  seq: number
  base: Uint8Array
  update: Uint8Array
  at: number
}

export interface PushRequest {
  docs: PushDoc[]
}

export type PushAnswer =
  | { id: string; ok: true; seq: number; sv: Uint8Array }
  | { id: string; moved: Uint8Array; seq: number; sv: Uint8Array; at: number }
  | { id: string; epoch: number }
  | { id: string; refused: DocRefusal }

export interface PushResponse {
  docs: PushAnswer[]
}

export interface KeepRequest {
  id: string
  text: string
  device: string
}

export interface SnapshotDoc {
  id: string
  epoch: number
  epochBase?: string
  seq: number
  update: Uint8Array
}

export interface SnapshotPage {
  docs: SnapshotDoc[]
  next: string | null
}

export const ROOM_V2 = 'nib.v2'

export type RoomNews =
  { t: 'ack'; seq: number; sv: Uint8Array } | { t: 'epoch'; epoch: number; epochBase: string }

export const NEW_EPOCH = 4001

export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

export const FENCE_HEADER = 'x-nib-fence'

export const DEVICE_PROTOCOL = 'nib.device.'

export type DeviceFrame =
  | { t: 'hello'; device: string; name: string; platform: string; app: string }
  | { t: 'active' }
  | { t: 'idle' }
  | { t: 'acquire'; key: string; take: boolean }
  | { t: 'release'; key: string; version: number }
  | { t: 'flushed'; key: string; version: number }
  | { t: 'want-key'; pub: string }
  | { t: 'grant-key'; to: string; wrapped: string; generation: number }
  | { t: 'deny-key'; to: string }

export type HubFrame =
  | { t: 'poke'; space: string; seq: number }
  | { t: 'granted'; key: string; fence: number; version: number }
  | { t: 'busy'; key: string; device: string }
  | { t: 'flush'; key: string; fence: number }
  | { t: 'lost'; key: string; device: string }
  | { t: 'free'; key: string }
  | { t: 'state'; key: string; version: number }
  | { t: 'key-wanted'; device: string; name: string; pub: string }
  | { t: 'key'; wrapped: string; generation: number }
  | { t: 'key-denied' }
  | { t: 'machine'; state: 'asleep' | 'starting' | 'awake' | 'stopping' }
  | { t: 'terms' }

export interface DeviceRow {
  id: string
  name: string
  platform: string
  createdAt: number
  lastSeenAt: number | null
}

export { ackFrame, epochFrame, frame, type Framed, roomNews, unframe } from './frame'

const LONGEST_ID = 200

export const LONGEST_NAME = 255

const MOST_KEPT = 8 * 1024 * 1024

type Checked<T> = (value: unknown) => T | null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= LONGEST_ID
}

export function isEntryId(value: unknown): value is string {
  return isId(value) && !/[/\\\p{Cc}]/u.test(value) && !value.includes('..')
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function isParent(value: unknown): value is string | null {
  return value === null || isId(value)
}

export function isName(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > LONGEST_NAME) return false
  if (value === '.' || value === '..') return false
  return !value.includes('/') && !value.includes('\u0000')
}

function isKind(value: unknown): value is EntryKind {
  return ENTRY_KINDS.some((kind) => kind === value)
}

function listOf<T>(value: unknown, each: Checked<T>, most = Number.MAX_SAFE_INTEGER): T[] | null {
  if (!Array.isArray(value) || value.length > most) return null
  const out: T[] = []
  for (const one of value) {
    const checked = each(one)
    if (checked === null) return null
    out.push(checked)
  }
  return out
}

export function opOf(value: unknown): Op | null {
  if (!isRecord(value) || !isId(value.op) || !isCount(value.seen) || !isId(value.id)) return null
  const { op, seen, id } = value
  if ((value.t === 'mkdir' || value.t === 'create') && !isEntryId(id)) return null

  switch (value.t) {
    case 'mkdir': {
      if (!isParent(value.parent) || !isName(value.name)) return null
      if (value.pos !== undefined && !isPosition(value.pos)) return null
      const made: MkdirOp = { op, t: 'mkdir', id, parent: value.parent, name: value.name, seen }
      if (value.pos !== undefined) made.pos = value.pos
      return made
    }

    case 'create': {
      const { kind, parent, name, hash, mergeable } = value
      if (!isKind(kind) || kind === 'folder' || !isParent(parent) || !isName(name)) return null
      if (hash !== undefined && !isId(hash)) return null
      if (mergeable !== undefined && !(isRecord(mergeable) && typeof mergeable.text === 'string')) {
        return null
      }
      if (value.pos !== undefined && !isPosition(value.pos)) return null
      const made: CreateOp = { op, t: 'create', id, kind, parent, name, seen }
      if (value.pos !== undefined) made.pos = value.pos
      if (hash !== undefined) made.hash = hash
      if (isRecord(mergeable) && typeof mergeable.text === 'string') {
        made.mergeable = { text: mergeable.text }
      }
      return made
    }

    case 'rename':
      return isName(value.name) ? { op, t: 'rename', id, name: value.name, seen } : null

    case 'move': {
      if (!isParent(value.parent)) return null
      if (value.name !== undefined && !isName(value.name)) return null
      if (value.pos !== undefined && !isPosition(value.pos)) return null
      const moved: MoveOp = { op, t: 'move', id, parent: value.parent, seen }
      if (value.name !== undefined) moved.name = value.name
      if (value.pos !== undefined) moved.pos = value.pos
      return moved
    }

    case 'place':
      return isPosition(value.pos) ? { op, t: 'place', id, pos: value.pos, seen } : null

    case 'meta': {
      const meta = metaPatchOf(value.meta)
      return meta ? { op, t: 'meta', id, meta, seen } : null
    }

    case 'delete':
      return { op, t: 'delete', id, seen }

    case 'restore':
      return { op, t: 'restore', id, seen }

    default:
      return null
  }
}

const REFUSALS: readonly Refusal[] = ['cycle', 'edited', 'role', 'gone']
const DOC_REFUSALS: readonly DocRefusal[] = ['role', 'gone', 'large']

function opResultOf(value: unknown): OpResult | null {
  if (!isRecord(value) || !isId(value.op)) return null
  const { op } = value

  if (value.ok === true) {
    if (value.id === undefined) return { op, ok: true }
    if (!isId(value.id) || !isParent(value.parent) || !isName(value.name)) return null
    return { op, ok: true, id: value.id, parent: value.parent, name: value.name }
  }
  if (isId(value.merged)) return { op, merged: value.merged }
  const refused = REFUSALS.find((one) => one === value.refused)
  return refused ? { op, refused } : null
}

export function opsRequestOf(value: unknown): OpsRequest | null {
  if (!isRecord(value)) return null
  const ops = listOf(value.ops, opOf, OPS_BATCH)
  return ops ? { ops } : null
}

export function opsResponseOf(value: unknown): OpsResponse | null {
  if (!isRecord(value) || !isCount(value.cursor)) return null
  const results = listOf(value.results, opResultOf)
  return results ? { results, cursor: value.cursor } : null
}

function feedItemOf(value: unknown): FeedItem | null {
  if (!isRecord(value)) return null
  const {
    id,
    kind,
    parent,
    name,
    deleted,
    seq,
    docSeq,
    epoch,
    epochBase,
    hash,
    size,
    by,
    at,
    pos,
    meta,
  } = value
  if (!isId(id) || !isKind(kind) || !isParent(parent) || !isName(name)) return null
  if (typeof deleted !== 'boolean' || !isCount(seq) || typeof hash !== 'string') return null
  if (!isCount(size) || typeof by !== 'string' || !isTime(at)) return null
  if (docSeq !== undefined && !isCount(docSeq)) return null
  if (epoch !== undefined && !isCount(epoch)) return null
  if (epochBase !== undefined && typeof epochBase !== 'string') return null
  if (pos !== undefined && !isPosition(pos)) return null
  const kept = meta === undefined ? undefined : metaOf(meta)
  if (kept === null) return null

  const item: FeedItem = { id, kind, parent, name, deleted, seq, hash, size, by, at }
  if (docSeq !== undefined) item.docSeq = docSeq
  if (epoch !== undefined) item.epoch = epoch
  if (epochBase !== undefined) item.epochBase = epochBase
  if (pos !== undefined) item.pos = pos
  if (kept && Object.keys(kept).length) item.meta = kept
  return item
}

function namedAsPath(value: unknown): boolean {
  if (!isRecord(value) || value.deleted === true) return false
  const { id, parent } = value
  if (typeof id === 'string' && !isEntryId(id)) return true
  return typeof parent === 'string' && !isEntryId(parent)
}

export function shortened(name: string, by: number, kind: EntryKind): string {
  const dot = kind === 'folder' ? -1 : name.lastIndexOf('.')
  const stemEnd = dot > by ? dot : name.length
  let cut = stemEnd - by
  if (/[\uD800-\uDBFF]/.test(name.charAt(cut - 1)) && cut > 1) cut -= 1
  return name.slice(0, cut) + name.slice(stemEnd)
}

export function heldName(name: string): string {
  const given: unknown = name
  if (isName(given)) return name
  if (name === '') return '_'
  if (name === '.' || name === '..') return '_'.repeat(name.length)
  const plain = name.split('/').join('_').split('\u0000').join('_')
  return plain.length > LONGEST_NAME ? shortened(plain, plain.length - LONGEST_NAME, 'note') : plain
}

function withHeldName(value: unknown): unknown {
  return isRecord(value) && typeof value.name === 'string'
    ? { ...value, name: heldName(value.name) }
    : value
}

export function feedPageOf(value: unknown): FeedPage | null {
  if (!isRecord(value) || !isCount(value.cursor) || typeof value.more !== 'boolean') return null
  if (!Array.isArray(value.items) || value.items.length > FEED_PAGE) return null
  const items = listOf(value.items.filter((one) => !namedAsPath(one)).map(withHeldName), feedItemOf)
  if (!items) return null
  const page: FeedPage = { items, cursor: value.cursor, more: value.more }
  if (value.order === true) page.order = true
  if (value.meta === true) page.meta = true
  if (value.index === true) page.index = true
  if (typeof value.device === 'string' && value.device) page.device = value.device
  return page
}

function pullDocOf(value: unknown): PullDoc | null {
  if (!isRecord(value) || !isId(value.id) || !isCount(value.epoch) || !isBytes(value.sv)) {
    return null
  }
  return { id: value.id, epoch: value.epoch, sv: value.sv }
}

export function pullRequestOf(value: unknown): PullRequest | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pullDocOf, PULL_BATCH)
  return docs ? { docs } : null
}

function docRefusalOf(value: unknown): DocRefusal | null {
  return DOC_REFUSALS.find((one) => one === value) ?? null
}

function pullAnswerOf(value: unknown): PullAnswer | null {
  if (!isRecord(value) || !isId(value.id)) return null
  const { id } = value
  if (isBytes(value.update) && isCount(value.seq))
    return { id, update: value.update, seq: value.seq }
  if (isCount(value.epoch) && typeof value.epochBase === 'string') {
    return { id, epoch: value.epoch, epochBase: value.epochBase }
  }
  const refused = docRefusalOf(value.refused)
  return refused ? { id, refused } : null
}

export function pullResponseOf(value: unknown): PullResponse | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pullAnswerOf, PULL_BATCH)
  return docs ? { docs } : null
}

function pushDocOf(value: unknown): PushDoc | null {
  if (!isRecord(value)) return null
  const { id, push, epoch, seq, base, update, at } = value
  if (!isId(id) || !isId(push) || !isCount(epoch) || !isCount(seq)) return null
  if (!isBytes(base) || !isBytes(update) || !isTime(at)) return null
  return { id, push, epoch, seq, base, update, at }
}

export function pushRequestOf(value: unknown): PushRequest | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pushDocOf, PUSH_BATCH)
  return docs ? { docs } : null
}

function pushAnswerOf(value: unknown): PushAnswer | null {
  if (!isRecord(value) || !isId(value.id)) return null
  const { id, seq, sv, at } = value
  if (value.ok === true && isCount(seq) && isBytes(sv)) return { id, ok: true, seq, sv }
  if (isBytes(value.moved) && isCount(seq) && isBytes(sv) && isTime(at)) {
    return { id, moved: value.moved, seq, sv, at }
  }
  if (isCount(value.epoch)) return { id, epoch: value.epoch }
  const refused = docRefusalOf(value.refused)
  return refused ? { id, refused } : null
}

export function pushResponseOf(value: unknown): PushResponse | null {
  if (!isRecord(value)) return null
  const docs = listOf(value.docs, pushAnswerOf, PUSH_BATCH)
  return docs ? { docs } : null
}

export function keepRequestOf(value: unknown): KeepRequest | null {
  if (!isRecord(value) || !isId(value.id) || !isId(value.device)) return null
  if (typeof value.text !== 'string' || value.text.length > MOST_KEPT) return null
  return { id: value.id, text: value.text, device: value.device }
}

function snapshotDocOf(value: unknown): SnapshotDoc | null {
  if (!isRecord(value) || !isId(value.id) || !isCount(value.epoch) || !isCount(value.seq)) {
    return null
  }
  if (!isBytes(value.update)) return null
  if (value.epochBase !== undefined && typeof value.epochBase !== 'string') return null
  const doc: SnapshotDoc = {
    id: value.id,
    epoch: value.epoch,
    seq: value.seq,
    update: value.update,
  }
  if (typeof value.epochBase === 'string') doc.epochBase = value.epochBase
  return doc
}

export function snapshotPageOf(value: unknown): SnapshotPage | null {
  if (!isRecord(value) || !(value.next === null || isId(value.next))) return null
  const docs = listOf(value.docs, snapshotDocOf)
  return docs ? { docs, next: value.next } : null
}

export function deviceFrameOf(value: unknown): DeviceFrame | null {
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello': {
      const { device, name, platform, app } = value
      if (!isId(device) || !isId(name) || !isId(platform) || !isId(app)) return null
      return { t: 'hello', device, name, platform, app }
    }
    case 'active':
      return { t: 'active' }
    case 'idle':
      return { t: 'idle' }
    case 'acquire':
      return isId(value.key) && typeof value.take === 'boolean'
        ? { t: 'acquire', key: value.key, take: value.take }
        : null
    case 'release':
    case 'flushed':
      return isId(value.key) && isCount(value.version)
        ? { t: value.t, key: value.key, version: value.version }
        : null
    case 'want-key':
      return isId(value.pub) ? { t: 'want-key', pub: value.pub } : null
    case 'grant-key': {
      const { to, wrapped, generation } = value
      if (!isId(to) || typeof wrapped !== 'string' || !isCount(generation)) return null
      return { t: 'grant-key', to, wrapped, generation }
    }
    case 'deny-key':
      return isId(value.to) ? { t: 'deny-key', to: value.to } : null
    default:
      return null
  }
}

export function hubFrameOf(value: unknown): HubFrame | null {
  if (!isRecord(value)) return null
  const { key } = value
  switch (value.t) {
    case 'poke':
      return isId(value.space) && isCount(value.seq)
        ? { t: 'poke', space: value.space, seq: value.seq }
        : null
    case 'granted':
      return isId(key) && isCount(value.fence) && isCount(value.version)
        ? { t: 'granted', key, fence: value.fence, version: value.version }
        : null
    case 'busy':
    case 'lost':
      return isId(key) && isId(value.device) ? { t: value.t, key, device: value.device } : null
    case 'flush':
      return isId(key) && isCount(value.fence) ? { t: 'flush', key, fence: value.fence } : null
    case 'free':
      return isId(key) ? { t: 'free', key } : null
    case 'state':
      return isId(key) && isCount(value.version)
        ? { t: 'state', key, version: value.version }
        : null
    case 'key-wanted': {
      const { device, name, pub } = value
      if (!isId(device) || !isId(name) || !isId(pub)) return null
      return { t: 'key-wanted', device, name, pub }
    }
    case 'key':
      return typeof value.wrapped === 'string' && isCount(value.generation)
        ? { t: 'key', wrapped: value.wrapped, generation: value.generation }
        : null
    case 'key-denied':
      return { t: 'key-denied' }
    case 'machine':
      return value.state === 'asleep' ||
        value.state === 'starting' ||
        value.state === 'awake' ||
        value.state === 'stopping'
        ? { t: 'machine', state: value.state }
        : null
    case 'terms':
      return { t: 'terms' }
    default:
      return null
  }
}

function deviceRowOf(value: unknown): DeviceRow | null {
  if (!isRecord(value)) return null
  const { id, name, platform, createdAt, lastSeenAt } = value
  if (!isId(id) || typeof name !== 'string' || typeof platform !== 'string') return null
  if (!isTime(createdAt) || !(lastSeenAt === null || isTime(lastSeenAt))) return null
  return { id, name, platform, createdAt, lastSeenAt }
}

export function deviceRowsOf(value: unknown): DeviceRow[] | null {
  return listOf(value, deviceRowOf)
}
