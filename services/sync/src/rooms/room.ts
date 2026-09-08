/** One file, being written in by several devices at once.
 *
 *  A room is a Durable Object: one instance in the world per file, which is what
 *  makes it the place the sockets meet. It holds the file as a Yjs document, so
 *  two devices that both wrote - at the same moment, or an hour apart with one of
 *  them on a train - end up with the same content and nobody is asked to choose.
 *
 *  Three things happen here and nothing else does. Sockets are joined and their
 *  messages handed to the protocol (see @nib/rooms, which is the wire). Updates
 *  are written down and folded into a snapshot when the pile grows, so waking a
 *  room is one read. And the content is settled into the note store a moment after
 *  the typing stops, as an ordinary save with the version moved on, so everything
 *  else that reads notes - the file sync, publishing, the connector, the glasses,
 *  exports, search - carries on knowing nothing about any of this.
 *
 *  A note and a canvas are both rooms and this is both of them. What differs is
 *  only what the document holds - one `Y.Text` of prose, or a map of the objects on
 *  a plane - and that lives in kind.ts, decided from the file's name. One object
 *  class rather than two, because everything here is the same either way: a room
 *  is named by the file's id, so there is one instance per file whichever kind it
 *  is, and a second class would be this whole file again for the sake of one
 *  seed and one serialiser.
 *
 *  The sockets hibernate: the runtime may take this object out of memory between
 *  messages and put it back on the next one, and while it is away the room costs
 *  nothing. That is why nothing that matters is held in a field. The open sockets
 *  are asked of the runtime, what each socket announced is kept on the socket
 *  itself, and the settle is an alarm rather than a timer. */

import { Awareness } from 'y-protocols/awareness'
import {
  awarenessState,
  awarenessUpdate,
  forget,
  isEdit,
  unattended,
  receive,
  syncStep1,
  syncUpdate,
} from '@nib/rooms'
import { byteLength } from '../crypto'
import { MAX_NOTE_BYTES, noteKey, saveNote } from '../notes'
import { fits } from '../storage'
import type { Env, Note } from '../types'
import { fileOf, fill, kindOf, type RoomKind } from './kind'
import { RoomState } from './state'

/** How long after the last keystroke the words are written into the note store.
 *  The same pause the app waits before it writes a note to disk, so somebody who
 *  has stopped typing sees one settle rather than two. */
const SETTLE_DELAY = 1_200

/** Which file this room is, learned from the first join and kept in storage so
 *  that a room woken by an alarm knows what to write, and what shape what it
 *  holds is in. */
export interface Held {
  noteId: string
  spaceId: string
  kind: RoomKind
}

/** What a socket has announced, kept on the socket so that a room which was
 *  asleep still knows whose carets to take away when it closes - and whether it
 *  was let in to write, which the door decided and this object only enforces. */
interface Attached {
  clients: number[]
  mayWrite: boolean
}

/** What a room kept about itself, read back. A room written down before there
 *  were two kinds says nothing about which it is, and a note is what it was. */
function heldIn(value: unknown): Held | null {
  if (typeof value !== 'object' || value === null) return null

  const held = value as Partial<Held>
  if (typeof held.noteId !== 'string' || typeof held.spaceId !== 'string') return null

  return { noteId: held.noteId, spaceId: held.spaceId, kind: kindOf(held.kind) }
}

function attachedTo(socket: WebSocket): Partial<Attached> | null {
  const held: unknown = socket.deserializeAttachment()
  return held && typeof held === 'object' ? held : null
}

function announcedBy(socket: WebSocket): number[] {
  const clients = attachedTo(socket)?.clients
  return Array.isArray(clients) ? clients.filter((one) => typeof one === 'number') : []
}

/** Whether this socket was let in to write. A socket whose attachment says
 *  nothing may not: the only way to lose the flag is a shape this version did
 *  not write, and refusing is the safe answer to that. */
function mayWrite(socket: WebSocket): boolean {
  return attachedTo(socket)?.mayWrite === true
}

export class NoteRoom implements DurableObject {
  private readonly state: RoomState
  private readonly awareness: Awareness
  /** Settles once the document has been read back out of storage, or seeded from
   *  the note. Held so that two joins landing together do not both seed it. */
  private opened: Promise<void> | null = null
  private held: Held | null = null
  /** When the settle already on the clock will fire, or null for one this object
   *  did not put there itself; see `settleSoon`. */
  private settleAt: number | null = null

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    this.state = new RoomState(ctx.storage)
    this.awareness = new Awareness(this.state.doc)
    // A room is a place, not somebody in it, and it must be able to sleep; see
    // `unattended`.
    unattended(this.awareness)

    this.state.doc.on('update', (update: Uint8Array, origin: unknown) => {
      this.ctx.waitUntil(this.spread(update, origin))
    })

    this.awareness.on('update', (changed: AwarenessChange, origin: unknown) => {
      const clients = [...changed.added, ...changed.updated, ...changed.removed]
      if (!clients.length) return

      this.announced(origin, changed.added)
      this.send(awarenessUpdate(this.awareness, clients), origin)
    })
  }

  /** A device joining. The Worker has already said who it is and that the note is
   *  theirs; what is left is the socket. */
  async fetch(request: Request): Promise<Response> {
    const noteId = request.headers.get('x-nib-note')
    const spaceId = request.headers.get('x-nib-space')
    if (!noteId || !spaceId) return new Response('no note', { status: 400 })

    const kind = kindOf(request.headers.get('x-nib-kind'))
    const pair = new WebSocketPair()
    await this.enter(
      pair[1],
      { noteId, spaceId, kind },
      request.headers.get('x-nib-write') !== 'no',
    )

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The room's half of a socket, joined and greeted. Apart from `fetch` because
   *  it is the whole of what joining means, and because a test drives it without
   *  a runtime to make the pair or to carry a 101 answer. */
  async enter(server: WebSocket, held: Held, writes = true): Promise<void> {
    await this.open(held)

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ clients: [], mayWrite: writes } satisfies Attached)

    // The greeting, both halves at once: what this room holds, and who is in it.
    server.send(syncStep1(this.state.doc))
    const present = awarenessState(this.awareness)
    if (present) server.send(present)
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    // Everything a room says is bytes. A string is not this protocol.
    if (typeof message === 'string') return

    const said = new Uint8Array(message)

    // A reader is in the room and sees every keystroke as it is typed; what
    // they may not do is add one. The client does not offer it, and this is
    // why that is a matter of taste rather than of trust.
    if (!mayWrite(socket) && isEdit(said)) return

    await this.woken()
    const answer = receive(said, this.state.doc, this.awareness, socket)
    if (answer) socket.send(answer)
  }

  async webSocketClose(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    // The last device out settles what is left, rather than the words waiting
    // for whoever opens the note next. The socket that is closing is still in
    // the list while this runs.
    if (this.ctx.getWebSockets().length <= 1) {
      await this.woken()
      await this.settle()
    }
  }

  webSocketError(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)
  }

  /** The settle. An alarm rather than a timer, so a room the runtime put to sleep
   *  still writes down what was typed into it. */
  async alarm() {
    this.settleAt = null
    await this.woken()
    await this.settle()
  }

  /** The room as it stood, for an object that was put back into memory after
   *  sleeping: which note it is comes out of storage, and the document with it. */
  private async woken(): Promise<void> {
    if (this.opened) return this.opened

    const held = heldIn(await this.ctx.storage.get('note'))
    if (held) await this.open(held)
  }

  /** The room's document, read back out of storage or seeded from the note as the
   *  store holds it. Runs once; every later call waits on the same promise. */
  private open(held: Held): Promise<void> {
    if (this.opened) return this.opened

    this.held = held
    // Nothing else may run against this object until the document is whole: a
    // second join that saw an empty room would seed it a second time.
    this.opened = this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.put('note', held)

      // A room with nothing stored of its own is filled from the file as the store
      // holds it. Only ever the first time: a plane somebody emptied is empty, and
      // seeding it again would put every card back.
      if (!(await this.state.load())) {
        const object = await this.env.NOTES.get(noteKey(held.spaceId, held.noteId))
        const file = object ? await object.text() : ''
        await this.state.seed((doc) => fill(held.kind, doc, file))
      }

      // Sockets that were already here mean this object was asleep rather than
      // new. What it holds may be a moment behind them - the last keystrokes
      // before it slept were only in memory - so it asks each of them what they
      // have, and the answer puts them back. See `record` in state.ts.
      const waiting = this.ctx.getWebSockets()
      if (waiting.length) this.send(syncStep1(this.state.doc), null)
    })

    return this.opened
  }

  /** An update somebody made: passed on to everyone else, and written down.
   *
   *  Passed on first and by itself, because that is the part somebody is waiting
   *  for. Everything after it is bookkeeping, and none of it touches storage in
   *  the ordinary case: the update waits in memory until the settle, and the
   *  alarm is asked for once rather than once per keystroke. */
  private async spread(update: Uint8Array, origin: unknown) {
    this.send(syncUpdate(update), origin)
    await this.state.record(update)
    await this.settleSoon()
  }

  /** Puts a settle on the clock, once for each burst of typing. The pending time
   *  is remembered here as well as in the object, so a keystroke does not cost a
   *  storage read to find out that a settle is already coming. */
  private async settleSoon() {
    if (this.settleAt !== null && this.settleAt > Date.now()) return
    // Nothing is remembered after a sleep, so the object is asked once.
    if (this.settleAt === null && (await this.ctx.storage.getAlarm()) !== null) return

    this.settleAt = Date.now() + SETTLE_DELAY
    await this.ctx.storage.setAlarm(this.settleAt)
  }

  /** To every socket but the one it came from. */
  private send(message: Uint8Array, except: unknown) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue

      try {
        socket.send(message)
      } catch {
        // A socket the runtime has already given up on. Its close handler takes
        // the carets away; there is nothing to do about it here.
      }
    }
  }

  /** Which awareness entries a socket announced, kept on the socket itself so the
   *  room can take them away later even if it slept in between. */
  private announced(origin: unknown, added: readonly number[]) {
    if (!added.length || !isSocket(origin)) return

    const clients = [...new Set([...announcedBy(origin), ...added])]
    origin.serializeAttachment({ clients, mayWrite: mayWrite(origin) } satisfies Attached)
  }

  /** The file as it now stands, written into the note store the way any other save
   *  writes it: the bytes in R2, the row's version and the space's cursor moved on.
   *  Every device that is not in the room reads it as an ordinary edit made
   *  somewhere else, which is exactly what it is. */
  private async settle() {
    const held = this.held
    if (!held) return

    // What arrived since the last settle, written into the room's own storage.
    // The two copies move together: everything the note store holds is in the
    // room's snapshot too, and nothing is left only in memory.
    await this.state.flush()

    const note = await this.env.DB.prepare('select * from notes where id = ? and deleted = 0')
      .bind(held.noteId)
      .first<Note>()

    // The note was deleted while the room was open. There is nothing to write
    // it into, and putting it back is Recently deleted's job, not a room's.
    if (!note) return

    const settled = fileOf(held.kind, this.state.doc)
    const size = byteLength(settled)
    if (size > MAX_NOTE_BYTES) return

    // Only a note that grew can take an account past what it may keep, and
    // working out what an account is using reads every note it holds. A limit
    // nobody enforces is a number on a settings page; one worked out on every
    // settle is a note that is slow to write in.
    if (size > note.size) {
      const owner = await this.env.DB.prepare('select user_id from spaces where id = ?')
        .bind(note.space_id)
        .first<{ user_id: string }>()

      // The words stay in the room and in every editor showing it; what does not
      // happen is the account growing past its quota.
      if (owner && !(await fits(this.env, owner.user_id, size, note.size))) return
    }

    // Somebody saved the same note between the row being read above and the
    // write - a device that was offline pushing what it had, say. The room is
    // still holding the words, so the answer is to come round again and write
    // them on top of what landed rather than to write over it from a row that
    // was already stale.
    if (!(await saveNote(this.env, note, settled, note.path))) await this.settleSoon()
  }
}

/** What the awareness protocol reports when its map changes. */
interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function isSocket(value: unknown): value is WebSocket {
  return typeof value === 'object' && value !== null && 'serializeAttachment' in value
}
