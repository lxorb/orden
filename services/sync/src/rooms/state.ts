/** A room's shared text, and how it survives the object going to sleep.
 *
 *  The document is a Yjs one: a CRDT, so two devices that both wrote while apart
 *  end up with the same text without anyone choosing between them. What has to
 *  be kept is the sequence of updates that built it, and the cheapest way to keep
 *  it is to append each one as it arrives and to fold the pile into a single
 *  snapshot once it grows: appending is one small write per keystroke burst, and
 *  the snapshot is what makes waking up one read instead of a thousand.
 *
 *  Written against as much of a Durable Object's storage as this needs, so the
 *  whole of it can be driven by a Map in a test. */

import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'

const SNAPSHOT = 'state:'
const LOG = 'log:'
const COUNT = 'count'

/** What one storage value may hold. A Durable Object's own ceiling is higher;
 *  staying well under it keeps the snapshot from ever being the reason a room
 *  fails to save, and is the same number on either storage backend. */
const CHUNK = 96 * 1024

/** When the pile of updates is folded into the snapshot. Whichever comes first:
 *  a note typed in steadily hits the count, and a note pasted into in one go
 *  hits the bytes. Both are small enough that waking a room is one read of a few
 *  tens of kilobytes. */
const MAX_UPDATES = 200
const MAX_BYTES = 64 * 1024

/** As much of a Durable Object's storage as a room needs. */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>
  list<T>(options: { prefix: string }): Promise<Map<string, T>>
  put(entries: Record<string, unknown>): Promise<void>
  /** Answers how many went, which nothing here reads. */
  delete(keys: string[]): Promise<unknown>
}

/** How much is waiting to be folded in, kept beside the log so that waking a
 *  room does not have to measure the pile before it can decide. */
interface Count {
  updates: number
  bytes: number
}

/** Six digits, so the log sorts in the order it was written. A room that saw a
 *  million updates without ever compacting is not a room. */
function logKey(at: number): string {
  return `${LOG}${String(at).padStart(6, '0')}`
}

function chunk(bytes: Uint8Array): Uint8Array[] {
  const pieces: Uint8Array[] = []
  for (let at = 0; at < bytes.length; at += CHUNK) pieces.push(bytes.slice(at, at + CHUNK))
  return pieces.length ? pieces : [new Uint8Array()]
}

/** Storage hands back what was put in, and what was put in were byte arrays.
 *  Read at the boundary rather than trusted: a value written by an older build,
 *  or one that came back as an ArrayBuffer, is not an update. */
function asUpdate(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  return null
}

export class RoomState {
  readonly doc = new Y.Doc()
  readonly text = this.doc.getText(TEXT)

  private count: Count = { updates: 0, bytes: 0 }
  /** Where the next log entry goes. Reset by every compaction. */
  private next = 0
  /** Writes run one after another. Two updates landing together would otherwise
   *  have the second choosing its log key while the first was compacting, and
   *  the compaction would take the entry away again. */
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly storage: RoomStorage) {}

  /** The words, which is what a settle writes into the note store. */
  get markdown(): string {
    return this.text.toJSON()
  }

  /** Whether the room holds a document at all. A room nobody has joined yet has
   *  neither a snapshot nor a log, and is seeded from the stored note. */
  async load(): Promise<boolean> {
    const snapshot = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const log = await this.storage.list<unknown>({ prefix: LOG })
    const held = await this.storage.get<Count>(COUNT)

    if (!snapshot.size && !log.size) return false

    // One transaction for all of it, so the document is put back together in a
    // single pass rather than firing an update per stored piece.
    this.doc.transact(() => {
      // The snapshot is written in Yjs's second encoding, which is markedly
      // smaller; the log is updates as they came off the wire, which is the
      // first. Which is which is what the key says.
      const pieces = [...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b))
      const parts = pieces.map(([, value]) => asUpdate(value)).filter((one) => one !== null)
      if (parts.length) Y.applyUpdateV2(this.doc, concat(parts))

      for (const [, value] of [...log.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const update = asUpdate(value)
        if (update) Y.applyUpdate(this.doc, update)
      }
    })

    this.count = held ?? { updates: log.size, bytes: 0 }
    this.next = log.size
    return true
  }

  /** The room's first text, from the note as the store holds it. The insert is
   *  recorded like any other update, so a room seeded here and one built out of
   *  keystrokes are the same thing afterwards. */
  async seed(markdown: string): Promise<void> {
    if (markdown) this.text.insert(0, markdown)
    await this.compact()
  }

  /** An update that arrived, kept so the room can be put back together. Folds
   *  the log into the snapshot once the pile has grown enough to be worth it. */
  record(update: Uint8Array): Promise<void> {
    return this.queued(async () => {
      this.count = { updates: this.count.updates + 1, bytes: this.count.bytes + update.length }

      if (this.count.updates >= MAX_UPDATES || this.count.bytes >= MAX_BYTES) {
        await this.write()
        return
      }

      await this.storage.put({ [logKey(this.next++)]: update, [COUNT]: this.count })
    })
  }

  /** One write at a time, in the order they were asked for. */
  private queued(write: () => Promise<void>): Promise<void> {
    const next = this.writing.then(write)
    // A failed write must not stop every write after it; whoever asked still
    // hears about it through the promise they were handed.
    this.writing = next.catch(() => undefined)
    return next
  }

  /** The whole document as one snapshot, and the log it replaces taken away.
   *  What keeps waking a room cheap however long it has been edited in. */
  compact(): Promise<void> {
    return this.queued(() => this.write())
  }

  private async write(): Promise<void> {
    const pieces = chunk(Y.encodeStateAsUpdateV2(this.doc))
    const entries: Record<string, unknown> = { [COUNT]: { updates: 0, bytes: 0 } }
    for (const [at, piece] of pieces.entries()) {
      entries[`${SNAPSHOT}${String(at).padStart(3, '0')}`] = piece
    }

    // The new snapshot goes in before the old pieces come out, so a room
    // interrupted between the two wakes up with too much rather than too little.
    await this.storage.put(entries)

    const stale = await this.storage.list<unknown>({ prefix: SNAPSHOT })
    const gone = [...stale.keys()].filter((key) => !(key in entries))
    const log = await this.storage.list<unknown>({ prefix: LOG })

    if (gone.length || log.size) await this.storage.delete([...gone, ...log.keys()])

    this.count = { updates: 0, bytes: 0 }
    this.next = 0
  }

  /** How many pieces the room is stored in: the snapshot's chunks and the log
   *  entries after it. What a test measures compaction by. */
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
