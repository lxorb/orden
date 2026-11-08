import { describe, expect, test, vi } from 'vitest'
import { SharedDoc, setPeers } from '@orden/editor'
import { awarenessUpdate, receive, TEXT } from '@orden/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { Settling } from './apart'

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

    arrive() {
      this.up = true
      this.wire.opened()
    }

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

class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(words: string) {
    if (words) this.doc.getText(TEXT).insert(0, words)
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  somebodyAt(at: number): Uint8Array {
    const text = this.doc.getText(TEXT)
    const place = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, at))
    this.awareness.setLocalState({
      who: { name: 'iPad', accent: 'orange' },
      caret: { anchor: place, head: place },
    })
    return awarenessUpdate(this.awareness, [this.doc.clientID])
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

function joining(
  file: string,
  words: string,
  { held = file, answer = 'offer' }: { held?: string; answer?: Settling } = {},
) {
  const note = new SharedDoc(file)
  const server = new Server(words)
  const asked: string[] = []

  const room = new Room({
    noteId: 'n1',
    token: 'session',
    note,
    hash: held,
    who: { name: 'Mac', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    digest: (text: string) => Promise.resolve(text),
    holds: () => true,
    apart: (theirs: string) => {
      asked.push(theirs)
      return Promise.resolve(answer)
    },
    gone: () => undefined,
    refused: () => undefined,
    shut: () => undefined,
  })

  return { note, room, server, asked, socket: socketOf() }
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('a note typed in while the room is still answering', () => {
  test('keeps what was typed, and the room ends up holding it', async () => {
    const { note, room, server, asked, socket } = joining('one\n', 'one\n')
    socket.arrive()

    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()

    for (const message of socket.take()) server.answer(message)

    expect(note.text.toString()).toBe('one\ntyped here\n')
    expect(server.words).toBe(note.text.toString())
    expect(asked).toEqual([])

    room.leave()
  })

  test('keeps a deletion made in that moment too', async () => {
    const { note, room, server, socket } = joining('one\ntwo\n', 'one\ntwo\n')
    socket.arrive()

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

  test('takes the room as it is when the file was written with Windows line endings and is unchanged here', async () => {
    const { note, room, server, asked, socket } = joining('one\n', 'one\ntwo from elsewhere\n', {
      held: 'one\r\n',
    })
    socket.arrive()

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()
    for (const message of socket.take()) server.answer(message)

    expect(asked).toEqual([])
    expect(note.text.toString()).toBe('one\ntwo from elsewhere\n')
    expect(server.words).toBe(note.text.toString())

    room.leave()
  })

  test('asks the rule when the room has moved on as well', async () => {
    const { note, room, server, asked, socket } = joining('one\n', 'one\ntwo from elsewhere\n')
    socket.arrive()

    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()
    for (const message of socket.take()) server.answer(message)

    expect(asked).toEqual(['one\ntwo from elsewhere\n'])
    expect(note.text.toString()).toBe('one\ntyped here\n')
    expect(server.words).toBe(note.text.toString())

    room.leave()
  })

  test('leaves both copies exactly as they are for the rule that waits', async () => {
    const { note, room, server, asked, socket } = joining('one\n', 'one\ntwo from elsewhere\n', {
      answer: 'wait',
    })
    socket.arrive()
    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()
    for (const message of socket.take()) server.answer(message)

    expect(asked).toEqual(['one\ntwo from elsewhere\n'])
    expect(note.text.toString()).toBe('one\ntyped here\n')
    expect(server.words).toBe('one\ntwo from elsewhere\n')
    expect(room.settled).toBe(false)

    room.leave()
  })

  test("shows nobody's caret while it waits, and says nothing of its own (#542)", async () => {
    const { note, room, server, socket } = joining('one\n', 'one\ntwo from elsewhere\n', {
      answer: 'wait',
    })
    const shown: unknown[][] = []
    const announce = note.announce.bind(note)
    note.announce = (effects) => {
      for (const effect of effects) if (effect.is(setPeers)) shown.push([...effect.value])
      announce(effects)
    }
    socket.arrive()
    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])
    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()
    for (const message of socket.take()) server.answer(message)

    socket.wire.heard(server.somebodyAt(server.words.length))
    room.moved(3, 3)
    await settled()

    expect(room.settled).toBe(false)
    expect(shown.at(-1)).toEqual([])
    expect(shown.flat()).toEqual([])
    const said = socket.take().map((one) => server.answer(one))
    expect(said.every((one) => one === null)).toBe(true)

    room.leave()
  })

  test("shows the others' carets once the note is joined to the room", async () => {
    const { note, room, server, socket } = joining('one\n', 'one\n')
    const shown: unknown[][] = []
    const announce = note.announce.bind(note)
    note.announce = (effects) => {
      for (const effect of effects) if (effect.is(setPeers)) shown.push([...effect.value])
      announce(effects)
    }
    socket.arrive()
    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()

    socket.wire.heard(server.somebodyAt(2))
    expect(room.settled).toBe(true)
    expect(shown.at(-1)).toMatchObject([{ name: 'iPad', head: 2 }])

    room.leave()
  })

  test('takes the room&apos;s words for the rule that lets the later copy stand', async () => {
    const { note, room, server, asked, socket } = joining('one\n', 'one\ntwo from elsewhere\n', {
      answer: 'take',
    })
    socket.arrive()
    note.edit([{ from: 4, to: 4, insert: 'typed here\n' }])

    for (const message of socket.take()) {
      const back = server.answer(message)
      if (back) socket.wire.heard(back)
    }
    await settled()
    for (const message of socket.take()) server.answer(message)

    expect(asked).toEqual(['one\ntwo from elsewhere\n'])
    expect(note.text.toString()).toBe('one\ntwo from elsewhere\n')
    expect(server.words).toBe(note.text.toString())
    expect(room.settled).toBe(true)

    room.leave()
  })
})

describe('a room whose connection has gone', () => {
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

    socket.drop()
    expect(room.settled).toBe(false)

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
