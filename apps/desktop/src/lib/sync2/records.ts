/** What the engine keeps in the sync store beyond the columns section 9.2 names, and how
 *  it is spelled there.
 *
 *  Three things. A document's two version numbers - where its confirmed state is on the
 *  account (`seq`, what a push names) and how far along the space's feed it has been
 *  pulled (`pulled`, which says a newer `docSeq` has words to fetch) - kept as a `meta`
 *  row beside its `docs` row, `doc:<id>`, in the same write. What waits to go up: tree
 *  ops, the losing side of an answer or a minor overlap on its way to `/v2/docs/keep`,
 *  and a day's note the account merged into one that was there, each a row of the
 *  `outbox` in the order it was made. And what a held note was held against, in the
 *  `held` row's `remote`. Beside them, where each entry was put among the rest of its
 *  folder (`order:<space>`), and where what this device deleted was (`gone:<space>`).
 *
 *  All of it framed the way sync v2 frames a request (`frame` in @orden/sync-core), so a
 *  Yjs update inside a record is bytes and not a list of numbers, and read back through
 *  a check: a row is unknown until it has been looked at. */

import {
  frame,
  type CreateOp,
  type KeepRequest,
  type Op,
  opOf,
  unframe,
} from '@orden/sync-core/wire'
import { isPosition } from '@orden/sync-core/order'
import type { MetaRow } from './store'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// ---------------------------------------------------------------------------
// A document's numbers

/** A push sent and not answered yet: its own id, and how many of the pending updates it
 *  carried. Written before it goes, so one whose answer was lost - to the network or to
 *  a crash - goes again as it was, the same id and the same bytes, and the account
 *  answers it the way it answered the first time (`PushDoc` in @orden/sync-core/wire). */
export interface Flight {
  push: string
  count: number
}

export interface DocNumbers {
  /** The document's version on the account that `confirmed` is at. */
  seq: number
  /** The feed's `docSeq` the confirmed state is known to cover. */
  pulled: number
  /** Whether it holds updates the account has not acknowledged: what a pass looks for
   *  without reading every document's bytes. */
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

/** The id a numbers row is about, or null for another meta row. */
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

/** A document's pending updates as the `pending` column holds them: a list, oldest
 *  first, each what one pause in the typing (or one answer) added. A list rather than
 *  one merged update, because a push carries the first few and an acknowledgement
 *  confirms the first few, and a merged update cannot be cut back into what it was
 *  made of. */
export function pendingBytes(chunks: readonly Uint8Array[]): Uint8Array | null {
  return chunks.length ? frame({ chunks: [...chunks] }) : null
}

export function pendingOf(bytes: Uint8Array | null): Uint8Array[] {
  if (!bytes) return []
  const value = unframe(bytes)
  if (!isRecord(value) || !Array.isArray(value.chunks)) return []
  return value.chunks.filter((one): one is Uint8Array => one instanceof Uint8Array)
}

// ---------------------------------------------------------------------------
// The outbox

/** A day's note the account answered `merged`: this device's words (`mine`) go into
 *  the note that was there (`into`), against the text both started from, and the create
 *  is kept for when that note is gone before they get there. */
export interface Merging {
  mine: string
  into: string
  create: CreateOp
}

/** `sent` marks an op that went up in a request whose answer has not come back: it is
 *  the account's already, and goes again exactly as it was. */
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

// ---------------------------------------------------------------------------
// Documents the feed said moved

/** A document the feed says has words this device has not pulled: the feed's `docSeq`
 *  for it and the epoch it is on. Kept per space in `meta` as `want:<space>`, written
 *  with the cursor that moved past them, so a pass cut off between reading the feed and
 *  pulling still pulls them next time. */
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

// ---------------------------------------------------------------------------
// Where each entry was put among the rest of its folder

/** Whether a space's account keeps where somebody put each entry among the rest of its
 *  folder (its feed said `order`), and the place the account confirmed for every entry
 *  that has one (#1068). Kept per space in `meta` as `order:<space>`, written with the
 *  feed page or the answer that changed it.
 *
 *  A row of `meta` rather than a column of `entries`: a new column is a new schema,
 *  which a store at it shuts an older Orden out of (`Newer` in sync_store/store.rs), and
 *  an entry row with a field the older build does not know is one it refuses to read
 *  (`rowOf` in store.ts). An older build reads past a `meta` row it has no use for, so
 *  going back to one costs the places and nothing else. */
export interface Ordering {
  on: boolean
  positions: Map<string, string>
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
    return { space: row.key.slice(ORDER.length), ordering: { on: value.on === true, positions } }
  } catch {
    return null
  }
}

export function orderingRow(space: string, ordering: Ordering): MetaRow {
  return {
    key: orderKey(space),
    value: JSON.stringify({ on: ordering.on, pos: Object.fromEntries(ordering.positions) }),
  }
}

// ---------------------------------------------------------------------------
// What this device deleted

/** What this device deleted, by the id of the entry deleted: where it and everything in
 *  it were on this disk, relative to the space's root, and the word the app keeps to put
 *  it back by (`back`: its trash's id for it, or its undo's), so a delete put back - out
 *  of the trash, or undone - brings each back as the entry it was (#1068; `restored` in
 *  create.ts). The newest `GONE_KEPT`, per space, in `meta` as `gone:<space>`: an older
 *  build reads past it. */
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

// ---------------------------------------------------------------------------
// A held note

/** What a note is held against (section 5.4).
 *
 *  - `moved`: a push answered `moved`, or a socket opening with pending edits met the
 *    room's words; `update` is what the account sent, which brings the confirmed
 *    state to version `seq`, last changed at `at` on the account's clock.
 *  - `file`: another program changed the file while the document had moved too; the
 *    file's text is `local`, the words Orden last wrote are `base`, and the document is
 *    the other side.
 *  - `blob`: a file that is not a document, replaced here (`mine`, a hash) and on the
 *    account (`theirs`) while apart; see files.ts.
 *  - `merge`: a day's note made here met one of the same name on the account; `local`
 *    is this device's text, `base` the text both started from, and `from` the id of the
 *    note this device made, whose words are `local`. */
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

// ---------------------------------------------------------------------------
// Which words this device keeps

/** In a browser that keeps only some of a space's words (#1126): whether the account
 *  serves what the rest need (`index: true` on its feed), when each document kept here
 *  was last used and how long it is, and the files whose words are being let go. In
 *  `meta` as `keep:<space>`; an older build reads past it and keeps every word again. */
export interface Keeping {
  on: boolean
  used: Map<string, { at: number; size: number }>
  /** Paths in the space whose rows this device is letting go of: written down before
   *  the rows go, so a stop halfway takes the rest at the next start. */
  going: Set<string>
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
    return { space: row.key.slice(KEEP.length), keeping: { on: value.on === true, used, going } }
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
    }),
  }
}
