import {
  frame,
  type CreateOp,
  type KeepRequest,
  type Op,
  opOf,
  unframe,
} from '@orden/sync-core/wire'
import { type ItemMeta, metaOf } from '@orden/sync-core/meta'
import { isPosition } from '@orden/sync-core/order'
import type { MetaRow } from './store'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export interface Flight {
  push: string
  count: number
}

export interface DocNumbers {
  seq: number
  pulled: number
  pending: boolean
  flight: Flight | null
}

const DOC = 'doc:'

export function numbersKey(id: string): string {
  return `${DOC}${id}`
}

const whole = (value: unknown): value is number => Number.isSafeInteger(value)

function flightOf(value: unknown): Flight | null {
  if (typeof value !== 'object' || value === null) return null
  const { push, count } = value as Record<string, unknown>
  return typeof push === 'string' && whole(count) ? { push, count } : null
}

export function numbersOf(row: MetaRow): { id: string; numbers: DocNumbers } | null {
  if (!row.key.startsWith(DOC) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (typeof value !== 'object' || value === null) return null
    const { seq, pulled, pending, flight } = value as Record<string, unknown>
    if (!whole(seq) || !whole(pulled)) return null
    return {
      id: row.key.slice(DOC.length),
      numbers: { seq, pulled, pending: pending === true, flight: flightOf(flight) },
    }
  } catch {
    return null
  }
}

export function numbersRow(id: string, numbers: DocNumbers): MetaRow {
  return { key: numbersKey(id), value: JSON.stringify(numbers) }
}

export function pendingBytes(chunks: readonly Uint8Array[]): Uint8Array | null {
  return chunks.length ? frame({ chunks: [...chunks] }) : null
}

export function pendingOf(bytes: Uint8Array | null): Uint8Array[] {
  if (!bytes) return []
  const value = unframe(bytes)
  if (!isRecord(value) || !Array.isArray(value.chunks)) return []
  return value.chunks.filter((one): one is Uint8Array => one instanceof Uint8Array)
}

export interface Merging {
  mine: string
  into: string
  create: CreateOp
}

export type Outgoing =
  | { t: 'op'; op: Op; sent?: boolean }
  | { t: 'keep'; keep: KeepRequest }
  | { t: 'merge'; merge: Merging }

export function outgoingBytes(record: Outgoing): Uint8Array {
  return frame(record)
}

export function outgoingOf(bytes: Uint8Array): Outgoing | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  if (value.t === 'op') {
    const op = opOf(value.op)
    if (!op) return null
    return value.sent === true ? { t: 'op', op, sent: true } : { t: 'op', op }
  }
  if (value.t === 'keep' && isRecord(value.keep)) {
    const { id, text, device } = value.keep
    if (typeof id !== 'string' || typeof text !== 'string' || typeof device !== 'string') {
      return null
    }
    return { t: 'keep', keep: { id, text, device } }
  }
  if (value.t === 'merge' && isRecord(value.merge)) {
    const { mine, into, create } = value.merge
    const op = opOf(create)
    if (typeof mine !== 'string' || typeof into !== 'string' || op?.t !== 'create') return null
    return { t: 'merge', merge: { mine, into, create: op } }
  }
  return null
}

export interface Wanted {
  docSeq: number
  epoch: number
}

const WANT = 'want:'

export function wantKey(space: string): string {
  return `${WANT}${space}`
}

export function wantedOf(row: MetaRow): { space: string; wanted: Map<string, Wanted> } | null {
  if (!row.key.startsWith(WANT) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (!isRecord(value)) return null
    const wanted = new Map<string, Wanted>()
    for (const [id, one] of Object.entries(value)) {
      if (!Array.isArray(one)) continue
      const [docSeq, epoch] = one as unknown[]
      if (whole(docSeq) && whole(epoch)) wanted.set(id, { docSeq, epoch })
    }
    return { space: row.key.slice(WANT.length), wanted }
  } catch {
    return null
  }
}

export function wantedRow(space: string, wanted: ReadonlyMap<string, Wanted>): MetaRow {
  const out: Record<string, [number, number]> = {}
  for (const [id, one] of wanted) out[id] = [one.docSeq, one.epoch]
  return { key: wantKey(space), value: JSON.stringify(out) }
}

export interface Ordering {
  on: boolean
  positions: Map<string, string>
  describes: boolean
  meta: Map<string, ItemMeta>
}

export function emptyOrdering(): Ordering {
  return { on: false, positions: new Map(), describes: false, meta: new Map() }
}

const ORDER = 'order:'

export function orderKey(space: string): string {
  return `${ORDER}${space}`
}

export function orderingOf(row: MetaRow): { space: string; ordering: Ordering } | null {
  if (!row.key.startsWith(ORDER) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (!isRecord(value)) return null
    const positions = new Map<string, string>()
    if (isRecord(value.pos)) {
      for (const [id, pos] of Object.entries(value.pos)) {
        if (isPosition(pos)) positions.set(id, pos)
      }
    }
    const meta = new Map<string, ItemMeta>()
    if (isRecord(value.meta)) {
      for (const [id, said] of Object.entries(value.meta)) {
        const read = metaOf(said)
        if (read && Object.keys(read).length) meta.set(id, read)
      }
    }
    return {
      space: row.key.slice(ORDER.length),
      ordering: { on: value.on === true, positions, describes: value.about === true, meta },
    }
  } catch {
    return null
  }
}

export function orderingRow(space: string, ordering: Ordering): MetaRow {
  return {
    key: orderKey(space),
    value: JSON.stringify({
      on: ordering.on,
      pos: Object.fromEntries(ordering.positions),
      ...(ordering.describes ? { about: true } : {}),
      ...(ordering.meta.size ? { meta: Object.fromEntries(ordering.meta) } : {}),
    }),
  }
}

interface Went {
  paths: Map<string, string>
  back?: string
}

export type Gone = Map<string, Went>

export const GONE_KEPT = 200

const GONE = 'gone:'

export function goneKey(space: string): string {
  return `${GONE}${space}`
}

export function goneOf(row: MetaRow): { space: string; gone: Gone } | null {
  if (!row.key.startsWith(GONE) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (!isRecord(value)) return null
    const gone: Gone = new Map()
    for (const [id, went] of Object.entries(value)) {
      if (!isRecord(went) || !isRecord(went.paths)) continue
      const paths = new Map<string, string>()
      for (const [one, path] of Object.entries(went.paths)) {
        if (typeof path === 'string') paths.set(one, path)
      }
      if (!paths.has(id)) continue
      gone.set(id, typeof went.back === 'string' ? { paths, back: went.back } : { paths })
    }
    return { space: row.key.slice(GONE.length), gone }
  } catch {
    return null
  }
}

export function goneRow(space: string, gone: Gone): MetaRow {
  const value: Record<string, { paths: Record<string, string>; back?: string }> = {}
  for (const [id, went] of gone) {
    value[id] = {
      paths: Object.fromEntries(went.paths),
      ...(went.back === undefined ? {} : { back: went.back }),
    }
  }
  return { key: goneKey(space), value: JSON.stringify(value) }
}

export type Against =
  | { t: 'moved'; update: Uint8Array; seq: number; at: number }
  | { t: 'file'; base: string; local: string }
  | { t: 'merge'; base: string; local: string; from: string }
  | { t: 'blob'; mine: string; theirs: string; at: number }

export function againstBytes(against: Against): Uint8Array {
  return frame(against)
}

export function againstOf(bytes: Uint8Array): Against | null {
  const value = unframe(bytes)
  if (!isRecord(value)) return null
  const { t } = value
  if (t === 'moved') {
    const { update, seq, at } = value
    if (!(update instanceof Uint8Array) || !Number.isSafeInteger(seq)) return null
    return { t, update, seq: Number(seq), at: typeof at === 'number' ? at : 0 }
  }
  if (t === 'file') {
    const { base, local } = value
    if (typeof base !== 'string' || typeof local !== 'string') return null
    return { t, base, local }
  }
  if (t === 'blob') {
    const { mine, theirs, at } = value
    if (typeof mine !== 'string' || typeof theirs !== 'string') return null
    return { t, mine, theirs, at: typeof at === 'number' ? at : 0 }
  }
  if (t === 'merge') {
    const { base, local, from } = value
    if (typeof base !== 'string' || typeof local !== 'string' || typeof from !== 'string') {
      return null
    }
    return { t, base, local, from }
  }
  return null
}

export interface Keeping {
  on: boolean
  used: Map<string, { at: number; size: number }>
  going: Set<string>
  refused?: boolean
}

const KEEP = 'keep:'

export function keepKey(space: string): string {
  return `${KEEP}${space}`
}

export function keepingOf(row: MetaRow): { space: string; keeping: Keeping } | null {
  if (!row.key.startsWith(KEEP) || typeof row.value !== 'string') return null
  try {
    const value: unknown = JSON.parse(row.value)
    if (!isRecord(value)) return null
    const used = new Map<string, { at: number; size: number }>()
    if (isRecord(value.used)) {
      for (const [id, one] of Object.entries(value.used)) {
        if (!Array.isArray(one)) continue
        const [at, size] = one as unknown[]
        if (typeof at === 'number' && typeof size === 'number') used.set(id, { at, size })
      }
    }
    const going = new Set(
      Array.isArray(value.going)
        ? value.going.filter((one): one is string => typeof one === 'string')
        : [],
    )
    const keeping: Keeping = { on: value.on === true, used, going }
    if (value.refused === true) keeping.refused = true
    return { space: row.key.slice(KEEP.length), keeping }
  } catch {
    return null
  }
}

export function keepingRow(space: string, keeping: Keeping): MetaRow {
  return {
    key: keepKey(space),
    value: JSON.stringify({
      on: keeping.on,
      used: Object.fromEntries([...keeping.used].map(([id, one]) => [id, [one.at, one.size]])),
      going: [...keeping.going],
      ...(keeping.refused ? { refused: true } : {}),
    }),
  }
}
