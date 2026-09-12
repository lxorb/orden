import { describe, expect, test, vi } from 'vitest'
import { SharedDoc } from '@nib/editor'
import { receive, TEXT } from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

/** Joining a room, with the socket stood in for.
 *
 *  What these tests are about is the one moment worth reading carefully: the room
 *  answers with what it holds, and the words on this device and the words in the
 *  room have to be brought together. A WebSocket has nothing to do with that, so
 *  the socket here is a pair of hands - the test is the other end of it, and plays
 *  the room in the Worker with the very same protocol module both ends use.
 *
 *  The case each of them is about is the gap between the two. Joining is a round
 *  trip, somebody is typing the whole time, and what they type in that moment must
 *  survive and must reach the room. */

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: () => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false

    constructor(
      readonly noteId: string,
      readonly token: string,
      readonly wire: Wire,
    ) {
      opened.push(this)
    }

    get open(): boolean {
      return this.up
    }

    /** The socket is up, which is where a room starts saying anything. Its own
     *  call rather than part of `start`, because a connection takes a moment to
     *  come up and the app carries on meanwhile. */
    arrive() {
      this.up = true
      this.wire.opened()
    }

    /** Everything said since the last time this was asked. */
    take(): Uint8Array[] {
      const said = this.sent
      this.sent = []
      return said
    }

    start() {
      // The real one connects here; this one waits to be told it is up.
    }

    send(message: Uint8Array): boolean {
      if (!this.up) return false

      this.sent.push(message)
      return true
    }

    /** The connection went, which the real one answers by trying again. */
    drop() {
      this.up = false
      this.wire.closed()
    }

    stop() {
      this.up = false
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))

const { Room } = await import('./room')

/** The other end: a room in the Worker, as far as the protocol is concerned. */
class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(words: string) {
    if (words) this.doc.getText(TEXT).insert(0, words)
  }

  /** One message applied, and whatever the protocol wrote back. */
  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  get words(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

function socketOf(): InstanceType<typeof sockets.FakeSocket> {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the room opened no socket')

  return socket
}

/** A device with `file` on its disk, joining a room that holds `words`.
 *
 *  The hash the account holds is the file itself: what the room asks is whether
 *  the words this device holds are still exactly what the account last handed it,
 *  and a digest that answers with the text says so without a real one. */
function joining(file: string, words: string) {
  const note = new SharedDoc(file)
  const server = new Server(words)

  const room = new Room({
    noteId: 'n1',
    token: 'session',
    note,
    hash: file,
    who: { name: 'Mac', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    digest: (text: string) => Promise.resolve(text),
    // One note the whole way through here; a tab moving on to another one is
    // switching.test.ts, and a room the service rebuilt is following.test.ts.
    holds: () => true,
    gone: () => undefined,
  })

  return { note, room, server, socket: socketOf() }
}

/** Long enough for the hash and the greeting to have been answered. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a note typed in while the room is still answering', () => {
  test('keeps what was typed, and the room ends up holding it', async () => {
    const { note, room, server, socket } = joining('one\n', 'one\ntwo from elsewhere\n')
    socket.arrive()

    // Somebody types between the greeting and the answer, which is a round trip.
    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()

    // Everything the device has said since, into the room.
    for (const message of socket.take()) server.answer(message)

    expect(note.text.toString()).toBe('one\ntyped here\n')
    // The whole of being settled: the two copies say the same thing, so every
    // keystroke from here on goes both ways.
    expect(server.words).toBe(note.text.toString())

    room.leave()
  })

  test('keeps a deletion made in that moment too', async () => {
    const { note, room, server, socket } = joining('one\ntwo\n', 'one\ntwo\nthree\n')
    socket.arrive()

    // The first line, cut while the room was answering.
    note.edit([{ from: 0, to: 4, insert: '' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()

    for (const message of socket.take()) server.answer(message)

    expect(note.text.toString()).toBe('two\n')
    expect(server.words).toBe(note.text.toString())

    room.leave()
  })
})

describe('a room whose connection has gone', () => {
  /** A device that has joined and caught up. */
  async function joined() {
    const held = joining('one\n', 'one\n')
    held.socket.arrive()

    for (const message of held.socket.take()) {
      const back = held.server.answer(message)
      if (back) held.socket.wire.heard(back)
    }
    await settled()

    return held
  }

  test('is not one the file sync may leave the note to', async () => {
    const { room, socket } = await joined()
    expect(room.settled).toBe(true)

    // Nothing written from here reaches anybody while the socket is away, and
    // the room cannot write the note into the account either. So the file is the
    // only way these words travel, and a pass has to carry them.
    socket.drop()
    expect(room.settled).toBe(false)

    // And it is again the moment the connection is back.
    socket.arrive()
    expect(room.settled).toBe(true)

    room.leave()
  })
})

describe('a note nobody touched while the room was answering', () => {
  test('takes the room’s words, which is what the room is for', async () => {
    const { note, room, server, socket } = joining('one\n', 'one\ntwo from elsewhere\n')
    socket.arrive()

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()

    expect(note.text.toString()).toBe('one\ntwo from elsewhere\n')
    expect(server.words).toBe(note.text.toString())

    room.leave()
  })
})
