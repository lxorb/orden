/** A room, driven without a Durable Object under it.
 *
 *  The class the Worker exports is a plain one: a constructor that takes the
 *  object's state and the bindings, and methods the runtime calls when a socket
 *  says something. Give it a state that keeps its storage in a Map and sockets
 *  that keep what was sent to them in an array, and everything the room does can
 *  be watched from a test - the handshake, two clients converging, the log
 *  folding into a snapshot, the settle writing the note.
 *
 *  What this stands in for is the runtime, not the protocol: the messages that
 *  cross are the real ones, encoded and decoded by the same @nib/rooms both ends
 *  of the real thing use. The room really is running against workerd in the
 *  end-to-end test, where two browsers type into one note; see
 *  test/e2e/collaborate.py. */

import { NoteRoom } from '../src/rooms/room'
import type { Env } from '../src/types'

/** What the room sends down a socket, and what a test reads back. */
export class FakeSocket {
  readonly sent: Uint8Array[] = []
  closed = false
  /** What the room attached to this socket, which the real runtime keeps for it
   *  across a sleep. */
  private attachment: unknown = null

  send(data: Uint8Array | string) {
    if (typeof data !== 'string') this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  serializeAttachment(value: unknown) {
    this.attachment = value
  }

  deserializeAttachment(): unknown {
    return this.attachment
  }

  /** Everything sent since the last time a test looked. */
  take(): Uint8Array[] {
    return this.sent.splice(0, this.sent.length)
  }
}

/** A Durable Object's state, as much of it as a room uses. */
export class FakeState {
  readonly kept = new Map<string, unknown>()
  private sockets: FakeSocket[] = []
  private alarm: number | null = null

  readonly storage = {
    get: (key: string): Promise<unknown> => Promise.resolve(this.kept.get(key)),
    list: (options: { prefix: string }): Promise<Map<string, unknown>> => {
      const found = new Map<string, unknown>()
      for (const [key, value] of this.kept) {
        if (key.startsWith(options.prefix)) found.set(key, value)
      }
      return Promise.resolve(found)
    },
    put: (first: string | Record<string, unknown>, second?: unknown): Promise<void> => {
      const entries = typeof first === 'string' ? { [first]: second } : first
      for (const [key, value] of Object.entries(entries)) this.kept.set(key, value)
      return Promise.resolve()
    },
    delete: (keys: string | string[]): Promise<number> => {
      let gone = 0
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (this.kept.delete(key)) gone++
      }
      return Promise.resolve(gone)
    },
    getAlarm: (): Promise<number | null> => Promise.resolve(this.alarm),
    setAlarm: (at: number): Promise<void> => {
      this.alarm = at
      return Promise.resolve()
    },
    deleteAlarm: (): Promise<void> => {
      this.alarm = null
      return Promise.resolve()
    },
  }

  /** Whether a settle is pending, and taking it means it has fired. */
  takeAlarm(): number | null {
    const at = this.alarm
    this.alarm = null
    return at
  }

  acceptWebSocket(socket: FakeSocket) {
    this.sockets.push(socket)
  }

  getWebSockets(): FakeSocket[] {
    return this.sockets
  }

  /** A socket the runtime has finished with, taken out of the list the way the
   *  real one is once its close handler has run. */
  drop(socket: FakeSocket) {
    this.sockets = this.sockets.filter((one) => one !== socket)
  }

  blockConcurrencyWhile<T>(work: () => Promise<T>): Promise<T> {
    return work()
  }

  waitUntil(work: Promise<unknown>) {
    this.pending.push(work)
  }

  private readonly pending: Promise<unknown>[] = []

  /** Everything the room asked to finish after the message it was handling. The
   *  runtime waits for these; a test has to say when. */
  async idle(): Promise<void> {
    while (this.pending.length) await Promise.all(this.pending.splice(0, this.pending.length))
  }
}

/** A room and the state under it, with the pair typed as the runtime types them.
 *  The casts are here and nowhere else: this file is the stand-in, so it is where
 *  the shapes are promised to line up. */
export function room(env: Env): { room: NoteRoom; state: FakeState } {
  const state = new FakeState()
  const made = new NoteRoom(state as unknown as DurableObjectState, env)
  return { room: made, state }
}

/** A device joining, with everything the room greeted it with waiting on it.
 *  `writes` is what the door decided; see rooms/index.ts. */
export async function join(
  made: NoteRoom,
  note: { id: string; spaceId: string },
  writes = true,
): Promise<FakeSocket> {
  const socket = new FakeSocket()
  await made.enter(
    socket as unknown as WebSocket,
    { noteId: note.id, spaceId: note.spaceId },
    writes,
  )
  return socket
}

/** A namespace that leads nowhere, so the door can be watched deciding without a
 *  runtime to make a Durable Object in. What it keeps is the headers the door
 *  sent, which are the whole of what it tells a room. */
export function doorway(): { ROOMS: DurableObjectNamespace; asked: Headers[] } {
  const asked: Headers[] = []

  const stub = {
    fetch: (request: Request) => {
      asked.push(request.headers)
      // Not 101: a Response cannot be built with that status outside the
      // runtime, and the door only passes on whatever it is handed.
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  }

  const namespace = {
    idFromName: () => 'one',
    get: () => stub,
  }

  return { ROOMS: namespace as unknown as DurableObjectNamespace, asked }
}

/** A message from a socket to the room, with whatever it set going settled. */
export async function say(
  made: NoteRoom,
  state: FakeState,
  socket: FakeSocket,
  message: Uint8Array,
): Promise<void> {
  // Copied, because a view onto a larger buffer is not what a socket delivers.
  await made.webSocketMessage(socket as unknown as WebSocket, message.slice().buffer)
  await state.idle()
}
