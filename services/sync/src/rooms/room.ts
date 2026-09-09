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
import { fileOf, fill, kindOf, writesOf, type RoomKind } from './kind'
import { RoomState } from './state'

/** How long after the last keystroke the words are written into the note store.
 *  The same pause the app waits before it writes a note to disk, so somebody who
 *  has stopped typing sees one settle rather than two. */
const SETTLE_DELAY = 1_200

/** How many awareness entries one socket is remembered as having announced. A
 *  device is one caret and announces one; a handful covers a client that reloaded
 *  its document without closing the socket. The point of the number is that there
 *  is one: see `announced`. */
const MOST_ANNOUNCED = 32

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
 *  was let in to write, which the door decided and this object only enforces,
 *  and whose socket it is, which is the one thing about the person the room keeps.
 *
 *  `who` is an id and nothing else: the room cannot look anybody up and does not
 *  know what it names. What it is for is being told "this one is not in the space
 *  any more" and finding the sockets that answer to it; see `revoke`. */
interface Attached {
  clients: number[]
  mayWrite: boolean
  who: string
}

/** What the door decided about the person on the other end of a socket. */
export interface Joining {
  writes: boolean
  who: string
}

/** How long a row saying somebody has a file open is believed. Well past any
 *  sitting a room stays awake for, and a bound on rows a close never came for. */
const OPEN_FOR = 24 * 60 * 60 * 1000

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

/** Whose socket this is, or nothing for one joined before the room was told. */
function whoOf(socket: WebSocket): string {
  const held = attachedTo(socket)?.who
  return typeof held === 'string' ? held : ''
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

      this.announced(origin, changed)
      this.send(awarenessUpdate(this.awareness, clients), origin)
    })
  }

  /** Two things arrive here, and the headers say which. A device joining, which
   *  the Worker has already decided about; or a route saying that somebody's
   *  access to this file has ended or narrowed since it did. */
  async fetch(request: Request): Promise<Response> {
    const revoked = request.headers.get('x-nib-revoked')
    if (revoked) return await this.revoke(revoked, request.headers.get('x-nib-role') === 'read')

    const noteId = request.headers.get('x-nib-note')
    const spaceId = request.headers.get('x-nib-space')
    if (!noteId || !spaceId) return new Response('no note', { status: 400 })

    const kind = kindOf(request.headers.get('x-nib-kind'))
    const pair = new WebSocketPair()
    await this.enter(
      pair[1],
      { noteId, spaceId, kind },
      {
        writes: writesOf(request.headers.get('x-nib-write')),
        who: request.headers.get('x-nib-who') ?? '',
      },
    )

    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The room's half of a socket, joined and greeted. Apart from `fetch` because
   *  it is the whole of what joining means, and because a test drives it without
   *  a runtime to make the pair or to carry a 101 answer. */
  async enter(
    server: WebSocket,
    held: Held,
    joining: Joining = { writes: true, who: '' },
  ): Promise<void> {
    await this.open(held)

    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({
      clients: [],
      mayWrite: joining.writes,
      who: joining.who,
    } satisfies Attached)

    // Written down where a revocation can find it. Not a lock and not a session:
    // the row says only that this person has this file open, so that the route
    // that ends their access knows which rooms to tell.
    await this.remember(held, joining.who)

    // The greeting, both halves at once: what this room holds, and who is in it.
    server.send(syncStep1(this.state.doc))
    const present = awarenessState(this.awareness)
    if (present) server.send(present)
  }

  /** This person has this file open. */
  private async remember(held: Held, who: string): Promise<void> {
    if (!who) return

    // Rows a close never came for - an object the runtime dropped, a socket the
    // network took - are cleared by age as new ones arrive, the way the sessions
    // and the sign-in codes are.
    await this.env.DB.prepare('delete from room_sockets where opened_at < ?')
      .bind(Date.now() - OPEN_FOR)
      .run()

    await this.env.DB.prepare(
      `insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)
       on conflict(note_id, who) do update set opened_at = excluded.opened_at`,
    )
      .bind(held.noteId, held.spaceId, who, Date.now())
      .run()
  }

  /** And this person no longer has, unless another of their devices still does:
   *  the row is per person, and the room is the only thing that knows which of
   *  its sockets are whose. */
  private async forgetSocket(socket: WebSocket): Promise<void> {
    const who = whoOf(socket)
    const held = this.held
    if (!who || !held) return

    const others = this.ctx.getWebSockets().some((one) => one !== socket && whoOf(one) === who)
    if (others) return

    await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
      .bind(held.noteId, who)
      .run()
  }

  /** Somebody's access to this file ended, or narrowed to reading, while they had
   *  it open. The route that changed it says so and this happens inside that same
   *  request: what a socket cannot be asked to notice about itself.
   *
   *  A room with nobody in it is the common case by far - the route asks because a
   *  row said somebody was here - and it answers without waking the document. */
  private async revoke(who: string, toRead: boolean): Promise<Response> {
    const sockets = this.ctx.getWebSockets()
    if (!sockets.length) return new Response(null, { status: 204 })

    await this.woken()

    for (const socket of sockets) {
      if (whoOf(socket) !== who) continue

      if (toRead) {
        // Still in the room and still seeing every keystroke, which is what a
        // reader is; what they may no longer do is add one.
        socket.serializeAttachment({
          clients: announcedBy(socket),
          mayWrite: false,
          who,
        } satisfies Attached)
        continue
      }

      // Their caret goes with them, and the socket is closed rather than left to
      // find out. 1008 is what a policy that has changed under a connection is.
      forget(this.awareness, announcedBy(socket), socket)
      socket.close(1008, 'no longer in this space')
    }

    // A close this side asked for brings no close handler with it, so the row goes
    // from here.
    if (!toRead && this.held) {
      await this.env.DB.prepare('delete from room_sockets where note_id = ? and who = ?')
        .bind(this.held.noteId, who)
        .run()
    }

    return new Response(null, { status: 204 })
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

    // Which file this room is has to be known before the row can be taken away,
    // and an object that slept in the meantime does not know yet.
    await this.woken()
    await this.forgetSocket(socket)

    // The last device out settles what is left, rather than the words waiting
    // for whoever opens the note next. The socket that is closing is still in
    // the list while this runs.
    if (this.ctx.getWebSockets().length <= 1) await this.settle()
  }

  async webSocketError(socket: WebSocket) {
    forget(this.awareness, announcedBy(socket), socket)

    await this.woken()
    await this.forgetSocket(socket)
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
   *  room can take them away later even if it slept in between.
   *
   *  What it stopped announcing goes with what it started, and the list is capped.
   *  A socket's attachment has a hard ceiling of a couple of kilobytes, and a list
   *  that only ever grew would reach it: from anything sending awareness for a few
   *  hundred clients at once, which is one message. Past the ceiling the write
   *  throws, and it throws inside the handler for the message that caused it -
   *  which is a room one client can stop working for everybody in it. */
  private announced(origin: unknown, changed: AwarenessChange) {
    if (!isSocket(origin)) return
    if (!changed.added.length && !changed.removed.length) return

    const gone = new Set(changed.removed)
    const clients = [...new Set([...announcedBy(origin), ...changed.added])]
      .filter((one) => !gone.has(one))
      .slice(-MOST_ANNOUNCED)

    origin.serializeAttachment({
      clients,
      mayWrite: mayWrite(origin),
      who: whoOf(origin),
    } satisfies Attached)
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
