import { MAX_NOTE_BYTES } from '../notes'

import * as Y from 'yjs'

const SNAPSHOT = 'state:'
const LOG = 'log:'
const COUNT = 'count'
const VERSION = 'version'

export const MOST_DOCUMENT_BYTES = 2 * MAX_NOTE_BYTES

export const TOO_LARGE_IN_A_ROOM = 'this note is as large as a note in a room may get'

const CHUNK = 96 * 1024

const MAX_UPDATES = 200
const MAX_BYTES = 64 * 1024

export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
  put(entries: Record<string, unknown>): Promise<void>
  delete(keys: string[]): Promise<unknown>
}

interface Count {
  updates: number
  bytes: number
}

export interface Version {
  seq: number
  at: number
}

function versionIn(value: unknown): Version {
  if (typeof value !== 'object' || value === null) return { seq: 0, at: 0 }
  const { seq, at } = value as Partial<Version>
  return {
    seq: typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 ? seq : 0,
    at: typeof at === 'number' && Number.isFinite(at) ? at : 0,
  }
}

const DIGITS = 6

function numbered(prefix: string, key: string): number {
  return Number(key.slice(prefix.length)) || 0
}

function inOrder<T>(prefix: string, held: Map<string, T>): T[] {
  return [...held.entries()]
    .sort(([a], [b]) => numbered(prefix, a) - numbered(prefix, b))
    .map(([, value]) => value)
}

function logKey(at: number): string {
  return `${LOG}${String(at).padStart(DIGITS, '0')}`
}

function chunk(bytes: Uint8Array): Uint8Array[] {
  const pieces: Uint8Array[] = []
  for (let at = 0; at < bytes.length; at += CHUNK) pieces.push(bytes.slice(at, at + CHUNK))
  return pieces.length ? pieces : [new Uint8Array()]
}

function asUpdate(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

export class RoomState {
  readonly doc = new Y.Doc()

  private count: Count = { updates: 0, bytes: 0 }
  private version: Version = { seq: 0, at: 0 }
  private next = 0
  private size = 0
  private pending: Uint8Array[] = []
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly storage: RoomStorage) {}

  async load(): Promise<boolean> {
    const snapshot = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const log = await this.storage.list<unknown>({ prefix: LOG })
    const held = await this.storage.get<Count>(COUNT)
    const version = versionIn(await this.storage.get<unknown>(VERSION))

    if (!snapshot.size && !log.size) return false

    this.doc.transact(() => {
      const parts = inOrder(SNAPSHOT, snapshot)
        .map((value) => asUpdate(value))
        .filter((one) => one !== null)
      if (parts.length) Y.applyUpdateV2(this.doc, concat(parts))

      for (const value of inOrder(LOG, log)) {
        const update = asUpdate(value)
        if (update) Y.applyUpdate(this.doc, update)
      }
    })

    this.count = held ?? { updates: log.size, bytes: 0 }
    this.next = log.size
    this.version = version
    this.measure()
    return true
  }

  get seq(): number {
    return this.version.seq
  }

  get changedAt(): number {
    return this.version.at
  }

  get durable(): boolean {
    return this.pending.length === 0
  }

  async flushAll(): Promise<void> {
    while (!this.durable) await this.flush()
  }

  async clear(): Promise<void> {
    await this.writing
    this.pending = []
    const snapshot = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const log = await this.storage.list<unknown>({ prefix: LOG })
    await this.storage.delete([...snapshot.keys(), ...log.keys(), COUNT, VERSION])
  }

  async seed(fill: (doc: Y.Doc) => void): Promise<void> {
    this.doc.transact(() => fill(this.doc))
    await this.compact()
  }

  record(update: Uint8Array): Promise<void> {
    if (this.full()) return Promise.reject(new Error(TOO_LARGE_IN_A_ROOM))

    this.pending.push(update)
    this.count = { updates: this.count.updates + 1, bytes: this.count.bytes + update.length }
    this.version = { seq: this.version.seq + 1, at: Date.now() }

    if (this.count.bytes < MAX_BYTES && this.count.updates < MAX_UPDATES) return Promise.resolve()
    return this.flush()
  }

  full(): boolean {
    return this.size + this.count.bytes >= MOST_DOCUMENT_BYTES
  }

  flush(): Promise<void> {
    if (!this.pending.length) return Promise.resolve()

    return this.queued(async () => {
      const waiting = this.pending
      this.pending = []
      if (!waiting.length) return

      if (this.count.updates >= MAX_UPDATES || this.count.bytes >= MAX_BYTES) {
        await this.write()
        return
      }

      const merged = waiting.length === 1 ? waiting[0] : Y.mergeUpdates(waiting)
      if (!merged) return

      await this.storage.put({
        [logKey(this.next++)]: merged,
        [COUNT]: this.count,
        [VERSION]: this.version,
      })
    })
  }

  private queued(write: () => Promise<void>): Promise<void> {
    const next = this.writing.then(write)
    this.writing = next.catch(() => undefined)
    return next
  }

  compact(): Promise<void> {
    return this.queued(() => this.write())
  }

  private async write(): Promise<void> {
    this.pending = []
    const whole = Y.encodeStateAsUpdateV2(this.doc)
    this.size = whole.length

    const pieces = chunk(whole)
    const entries: Record<string, unknown> = {
      [COUNT]: { updates: 0, bytes: 0 },
      [VERSION]: this.version,
    }
    for (const [at, piece] of pieces.entries()) {
      entries[`${SNAPSHOT}${String(at).padStart(DIGITS, '0')}`] = piece
    }

    await this.storage.put(entries)

    const stale = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const gone = [...stale.keys()].filter((key) => !(key in entries))
    const log = await this.storage.list<unknown>({ prefix: LOG })

    if (gone.length || log.size) await this.storage.delete([...gone, ...log.keys()])

    this.count = { updates: 0, bytes: 0 }
    this.next = 0
  }

  private measure(): void {
    this.size = Y.encodeStateAsUpdateV2(this.doc).length
  }

  async pieces(): Promise<{ snapshot: number; log: number }> {
    const snapshot = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const log = await this.storage.list<unknown>({ prefix: LOG })
    return { snapshot: snapshot.size, log: log.size }
  }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0] ?? new Uint8Array()

  const whole = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
  let at = 0
  for (const part of parts) {
    whole.set(part, at)
    at += part.length
  }
  return whole
}
