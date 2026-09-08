/** A room's shared document, and how it survives the object going to sleep.
 *
 *  The document is a Yjs one: a CRDT, so two devices that both wrote while apart
 *  end up with the same content without anyone choosing between them. What has to
 *  be kept is the sequence of updates that built it, and the cheapest way to keep
 *  it is to append each one as it arrives and to fold the pile into a single
 *  snapshot once it grows: appending is one small write per keystroke burst, and
 *  the snapshot is what makes waking up one read instead of a thousand.
 *
 *  What the document holds is not this file's business. A note's words and a
 *  canvas's objects are stored, folded and woken exactly alike; the difference is
 *  one file over, in kind.ts.
 *
 *  Written against as much of a Durable Object's storage as this needs, so the
 *  whole of it can be driven by a Map in a test. */

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

  private count: Count = { updates: 0, bytes: 0 }
  /** Where the next log entry goes. Reset by every compaction. */
  private next = 0
  /** Updates that have arrived and not been written down yet; see `record`. */
  private pending: Uint8Array[] = []
  /** Writes run one after another. Two updates landing together would otherwise
   *  have the second choosing its log key while the first was compacting, and
   *  the compaction would take the entry away again. */
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly storage: RoomStorage) {}

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

  /** The room's first content, put in by whoever knows what the document holds;
   *  see kind.ts. What it writes is recorded like any other update, so a room
   *  seeded here and one built out of keystrokes are the same thing afterwards. */
  async seed(fill: (doc: Y.Doc) => void): Promise<void> {
    this.doc.transact(() => fill(this.doc))
    await this.compact()
  }

  /** An update that arrived.
   *
   *  Kept in memory rather than written down at once, and written when the typing
   *  pauses or when enough has piled up - which is what makes a keystroke cost
   *  nothing at all here. A keystroke that reached a storage write would cost the
   *  room a row and the reader a wait: a room being typed into is the one moment
   *  it must not spend its time on the disk.
   *
   *  Nothing is at risk while it waits. Every device in the room holds the same
   *  keystrokes, and a room that came back without its last few asks for them in
   *  the sync the first socket opens with. */
  record(update: Uint8Array): Promise<void> {
    this.pending.push(update)
    this.count = { updates: this.count.updates + 1, bytes: this.count.bytes + update.length }

    // Held only up to a point: past it the pile is worth a write of its own,
    // whether or not anybody has stopped typing.
    if (this.count.bytes < MAX_BYTES && this.count.updates < MAX_UPDATES) return Promise.resolve()
    return this.flush()
  }

  /** What has piled up, written down: one entry for the lot, or a fresh snapshot
   *  when the log has grown long enough to be worth folding in.
   *
   *  Called when the typing pauses and when the last device leaves. Both come
   *  through the settle, so the words reaching the note store and the words
   *  reaching the room's own storage are the same moment. */
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

      // Merged, so a burst of keystrokes is one entry rather than one each.
      const merged = waiting.length === 1 ? waiting[0] : Y.mergeUpdates(waiting)
      if (!merged) return

      await this.storage.put({ [logKey(this.next++)]: merged, [COUNT]: this.count })
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
    // Whatever was still only in memory is in the document already, so a snapshot
    // of the document is a snapshot of all of it.
    this.pending = []
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
