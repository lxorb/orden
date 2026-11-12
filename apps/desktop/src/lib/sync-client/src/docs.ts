import * as Y from 'yjs'
import { fileOf, fileOfUpdates, type Shape } from './kinds'
import { type DocNumbers, type Flight, pendingBytes, pendingOf } from './records'
import type { DocRow } from './store'

export const HERE = 'here'
export const MINE = 'mine'
const ROOM = 'room'
const PULLED = 'pulled'
const LOADED = 'loaded'

const MOST_CHUNKS = 32

function merged(updates: readonly Uint8Array[]): Uint8Array {
  if (updates.length === 1 && updates[0]) return updates[0]
  return Y.mergeUpdatesV2([...updates])
}

const EMPTY = Y.encodeStateAsUpdateV2(new Y.Doc())

function reachesPast(update: Uint8Array, sv: Uint8Array): boolean {
  const rest = Y.diffUpdateV2(update, sv)
  return Y.decodeUpdateV2(rest).structs.length > 0
}

export class Doc {
  unsaved: Uint8Array[] = []
  private roomed: Uint8Array[] = []
  live: Y.Doc | null = null
  dirty = false
  replaced: ((doc: Y.Doc) => void) | null = null
  touched: (() => void) | null = null

  private constructor(
    readonly id: string,
    readonly shape: Shape,
    public epoch: number,
    public client: number,
    public confirmed: Uint8Array,
    public pending: Uint8Array[],
    public pendingAt: number,
    public seq: number,
    public pulled: number,
    public flight: Flight | null,
    private readonly now: () => number,
  ) {}

  static fresh(
    id: string,
    shape: Shape,
    epoch: number,
    client: number,
    now: () => number,
    confirmed: Uint8Array = EMPTY,
    seq = 0,
  ): Doc {
    const doc = new Doc(id, shape, epoch, client, confirmed, [], 0, seq, 0, null, now)
    doc.dirty = true
    return doc
  }

  static fromRow(row: DocRow, numbers: DocNumbers, shape: Shape, now: () => number): Doc {
    return new Doc(
      row.id,
      shape,
      row.epoch,
      row.client_id,
      row.confirmed,
      pendingOf(row.pending),
      row.pending_at ?? 0,
      numbers.seq,
      numbers.pulled,
      numbers.flight,
      now,
    )
  }

  row(): DocRow {
    this.foldRoomed()
    return {
      id: this.id,
      epoch: this.epoch,
      client_id: this.client,
      confirmed: this.confirmed,
      confirmed_sv: Y.encodeStateVectorFromUpdateV2(this.confirmed),
      pending: pendingBytes(this.pending),
      pending_at: this.pending.length ? this.pendingAt : null,
    }
  }

  numbers(): DocNumbers {
    return {
      seq: this.seq,
      pulled: this.pulled,
      pending: this.pending.length > 0,
      flight: this.flight,
    }
  }

  get hasPending(): boolean {
    return this.pending.length > 0 || this.unsaved.length > 0
  }

  open(): Y.Doc {
    if (this.live) return this.live
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, this.confirmedNow(), LOADED)
    for (const update of this.pending) Y.applyUpdateV2(doc, update, LOADED)
    for (const update of this.unsaved) Y.applyUpdateV2(doc, update, LOADED)
    doc.clientID = this.client
    doc.on('updateV2', (update: Uint8Array, origin: unknown) => this.heard(update, origin))
    this.live = doc
    return doc
  }

  private heard(update: Uint8Array, origin: unknown) {
    if (origin === HERE || origin === MINE) {
      this.unsaved.push(update)
      this.pendingAt = Math.max(this.pendingAt, this.now())
      this.touched?.()
    } else if (origin === ROOM) {
      this.roomed.push(update)
      this.dirty = true
    }
  }

  close() {
    this.live?.destroy()
    this.live = null
  }

  text(): string {
    if (this.live) return fileOf(this.shape, this.live)
    return fileOfUpdates(this.shape, this.confirmedNow(), ...this.pending, ...this.unsaved)
  }

  confirmedText(): string {
    return fileOfUpdates(this.shape, this.confirmedNow())
  }

  confirmedSv(): Uint8Array {
    return Y.encodeStateVectorFromUpdateV2(this.confirmedNow())
  }

  whole(): Uint8Array {
    return merged([this.confirmedNow(), ...this.pending, ...this.unsaved])
  }

  private confirmedNow(): Uint8Array {
    this.foldRoomed()
    return this.confirmed
  }

  private foldRoomed() {
    if (!this.roomed.length) return
    this.confirmed = merged([this.confirmed, ...this.roomed])
    this.roomed = []
  }

  flush(): boolean {
    if (!this.unsaved.length) return false
    this.pending.push(merged(this.unsaved))
    this.unsaved = []
    this.dirty = true

    const carried = this.flight?.count ?? 0
    if (this.pending.length > MOST_CHUNKS) {
      this.pending = [...this.pending.slice(0, carried), merged(this.pending.slice(carried))]
    }
    return true
  }

  outgoing(newId: () => string): { push: string; update: Uint8Array } | null {
    if (!this.flight) {
      if (!this.pending.length) return null
      this.flight = { push: newId(), count: this.pending.length }
      this.dirty = true
    }
    return { push: this.flight.push, update: merged(this.pending.slice(0, this.flight.count)) }
  }

  confirmFlight(seq: number) {
    const count = this.flight?.count ?? 0
    this.confirmed = merged([this.confirmedNow(), ...this.pending.slice(0, count)])
    this.pending = this.pending.slice(count)
    this.flight = null
    this.seq = seq
    this.dirty = true
  }

  land() {
    if (!this.flight) return
    this.flight = null
    this.dirty = true
  }

  acked(seq: number, sv: Uint8Array) {
    let covered = 0
    while (covered < this.pending.length) {
      const chunk = this.pending[covered]
      if (!chunk || reachesPast(chunk, sv)) break
      covered += 1
    }
    if (this.flight && covered < this.flight.count) covered = 0
    if (covered) {
      this.confirmed = merged([this.confirmedNow(), ...this.pending.slice(0, covered)])
      this.pending = this.pending.slice(covered)
      if (this.flight) this.flight = null
    }
    this.seq = Math.max(this.seq, seq)
    this.dirty = true
  }

  took(update: Uint8Array, seq: number) {
    this.confirmed = merged([this.confirmedNow(), update])
    this.seq = seq
    this.dirty = true
    if (this.live) Y.applyUpdateV2(this.live, update, PULLED)
  }

  write(change: (doc: Y.Doc) => void) {
    const doc = this.open()
    change(doc)
  }

  restart(confirmed: Uint8Array, seq: number, epoch: number, client: number) {
    this.roomed = []
    this.confirmed = confirmed
    this.pending = []
    this.unsaved = []
    this.flight = null
    this.seq = seq
    this.epoch = epoch
    this.client = client
    this.dirty = true
    if (!this.live) return

    this.live.destroy()
    this.live = null
    const fresh = this.open()
    this.replaced?.(fresh)
  }

  letPendingGo(client: number) {
    this.restart(this.confirmedNow(), this.seq, this.epoch, client)
  }

  rotate(client: number) {
    this.client = client
    if (this.live) this.live.clientID = client
    this.dirty = true
  }
}
