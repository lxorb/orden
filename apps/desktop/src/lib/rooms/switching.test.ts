/** Switching between notes while their rooms are live.
 *
 *  One document, two notes. A single click in the file list does not open a tab: it
 *  reuses the one preview tab, and the document in it takes the new note on rather
 *  than being swapped for another - see `adopt` in workspace/documents.svelte.ts.
 *  So the words a room is joined to can become another file's words between one
 *  frame and the next, while the pairing of documents to rooms is an effect and
 *  catches up a beat later.
 *
 *  That beat is what these tests are about. Everything in it is real: the document,
 *  the shared text every pane is a window onto, the room, the meeting when it
 *  answers, and the binding between the two. Only the socket is stood in for, and
 *  the other end of it is the room in the Worker driven by the very same protocol
 *  module both ends use.
 *
 *  What every one of them asserts is the same sentence, which is the one thing that
 *  must never fail: each note's room holds that note's words and nobody else's. */

import { describe, expect, test, vi } from 'vitest'
import { receive, syncUpdate, TEXT } from '@nib/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

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

    stop() {
      this.up = false
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('./socket', () => ({ RoomSocket: sockets.FakeSocket }))

const { Room } = await import('./room')
const { NoteDoc } = await import('../workspace/documents.svelte')

/** The room in the Worker, as far as the protocol is concerned, and the file it
 *  settles into.
 *
 *  `file` is what the Durable Object would write into the account a moment after
 *  the typing stops: `fileOf` of the document it holds, under the path of the note
 *  the room is about. Which is why reading it is the whole test - a room that has
 *  taken another note's words on has already lost this note's. */
class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(
    readonly path: string,
    words: string,
  ) {
    if (words) this.doc.getText(TEXT).insert(0, words)
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  /** Somebody else writing in this note, on their own device, and the room passing
   *  it on to this one. */
  elsewhere(at: number, words: string, socket: InstanceType<typeof sockets.FakeSocket>) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  /** What a settle would write into this note's file. */
  get file(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

/** The words of a document as anything that writes them down reads them: brought
 *  up to what the panes hold first, which is what `flush` is for. */
function words(note: InstanceType<typeof NoteDoc>): string {
  note.flush()
  return note.text
}

function socketOf(): InstanceType<typeof sockets.FakeSocket> {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the room opened no socket')

  return socket
}

/** Long enough for the hash and the greeting to have been answered. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** The one preview tab's document, holding a note out of a space. */
function previewing(path: string, words: string): InstanceType<typeof NoteDoc> {
  return new NoteDoc(
    { kind: 'note', path, name: path.split('/').at(-1) ?? path, text: words, dirty: false },
    () => undefined,
    // Every note here is in a space, which is what a room is ever about.
    () => true,
  )
}

/** One note in a room, as the app joins it: the document's words, the id the room
 *  is named by, and the account's hash of the file as of the last sync.
 *
 *  `holds` is what `rooms.svelte.ts` hands over: whether the document is still on
 *  the file this room was joined for. The pairing is worked out in an effect, so it
 *  cannot be synchronous with a click; this is how a room finds out at once. */
function joining(note: InstanceType<typeof NoteDoc>, server: Server, hash: string | null) {
  const arrivals = note.arrivals
  const path = note.path

  const room = new Room({
    noteId: server.path,
    token: 'session',
    note: note.live,
    hash,
    who: { name: 'Windows', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    digest: (text: string) => Promise.resolve(text),
    holds: () => note.arrivals === arrivals && note.path === path,
  })

  return { room, socket: socketOf() }
}

/** Everything the device has said, into the room, and everything the room says
 *  back into the device. What the network does, done by hand. */
function carry(socket: InstanceType<typeof sockets.FakeSocket>, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

/** A document joined to its room and caught up with it: the greeting answered, the
 *  file met against what the room held, and every keystroke from here going both
 *  ways. Where every test below starts. */
async function inTheRoom(note: InstanceType<typeof NoteDoc>, server: Server) {
  // The hash the account holds is the file itself; see `digest` above. So the note
  // reads as untouched, which is a note with nothing of its own to offer.
  const held = joining(note, server, note.text)
  held.socket.arrive()
  carry(held.socket, server)
  await settled()
  carry(held.socket, server)

  return held
}

describe('a single click moving the preview tab on to another note', () => {
  test('leaves the note it came from holding its own words', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const held = await inTheRoom(note, a)

    // The click. The document takes the other note on, in the same tab and in the
    // same document, which is what the preview tab is.
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    carry(held.socket, a)

    // The room for a.md is about a.md. Nothing that happened to the tab is an edit
    // to it, and a settle now would write this into the account.
    expect(a.file).toBe('# A\n')

    held.room.leave()
  })

  test('does not send what is typed in the new note into the old note’s room', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const held = await inTheRoom(note, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    // Emil carries on typing before the pairing has caught up.
    note.live.replace('# B\nwritten in b\n')
    carry(held.socket, a)

    expect(a.file).toBe('# A\n')

    held.room.leave()
  })

  test('does not take the old note’s words into the new note', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const held = await inTheRoom(note, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })

    // Another device writes in a.md in that same beat. It is not this document's
    // note any more, so nothing it says belongs in these words.
    a.elsewhere(3, ' from elsewhere', held.socket)
    carry(held.socket, a)

    expect(words(note)).toBe('# B\n')
    expect(a.file).not.toContain('# B')

    held.room.leave()
  })

  test('both notes keep their own words once the pairing has caught up', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const first = await inTheRoom(note, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    carry(first.socket, a)

    // The effect catches up: the room for the note the document was on is left,
    // and the room for the one it is on now is joined.
    first.room.leave()
    const b = new Server('/space/b.md', '# B\n')
    const second = await inTheRoom(note, b)

    note.live.replace('# B\nwritten in b\n')
    carry(second.socket, b)
    for (const message of second.socket.take()) b.answer(message)

    expect(b.file).toBe('# B\nwritten in b\n')
    expect(a.file).toBe('# A\n')

    second.room.leave()
  })

  test('switching back and forth leaves each note with only its own words', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const b = new Server('/space/b.md', '# B\n')

    let held = await inTheRoom(note, a)
    note.live.replace('# A\nwritten in a\n')
    carry(held.socket, a)
    for (const message of held.socket.take()) a.answer(message)

    // Five clicks, alternating, each one a document taking another note on with
    // the room it was in still joined.
    for (const [at, next] of [b, a, b, a, b].entries()) {
      const other = next === a ? '# A\nwritten in a\n' : '# B\n'
      note.adopt({ path: next.path, name: next.path, text: other })
      carry(held.socket, next === a ? b : a)

      held.room.leave()
      held = await inTheRoom(note, next)
      note.live.replace(`${other}line ${at}\n`)
      carry(held.socket, next)
      for (const message of held.socket.take()) next.answer(message)
    }

    // Whatever was typed last in each note, and never a word of the other.
    expect(a.file).not.toContain('# B')
    expect(b.file).not.toContain('# A')

    held.room.leave()
  })
})

describe('a room answering after the tab has moved on', () => {
  test('neither offers the new note’s words nor binds itself to them', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')

    // The room is joined and the greeting is in the air. The hash is answered
    // asynchronously, which is the moment the click lands in.
    const held = joining(note, a, '# A\n')
    held.socket.arrive()
    carry(held.socket, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    await settled()
    carry(held.socket, a)

    expect(a.file).toBe('# A\n')

    // And the room it was left for is the one the keystrokes reach.
    held.room.leave()
    const b = new Server('/space/b.md', '# B\n')
    const second = await inTheRoom(note, b)

    note.live.replace('# B\nwritten in b\n')
    carry(second.socket, b)
    for (const message of second.socket.take()) b.answer(message)

    expect(b.file).toBe('# B\nwritten in b\n')
    expect(a.file).toBe('# A\n')

    second.room.leave()
  })

  test('a room that has been left carries nothing at all', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')

    const held = joining(note, a, '# A\n')
    held.socket.arrive()
    carry(held.socket, a)

    // Signing out, the last tab closing: the room goes while its greeting is in
    // the air, and what it was about to do must not happen behind it.
    held.room.leave()
    note.live.replace('# A\nwritten after leaving\n')
    await settled()
    carry(held.socket, a)

    expect(a.file).toBe('# A\n')
  })
})

describe('two devices in one note', () => {
  test('the second one is handed that note and never the other', async () => {
    const here = previewing('/space/b.md', '# B\n')
    const b = new Server('/space/b.md', '# B\n')
    const first = await inTheRoom(here, b)

    here.live.replace('# B\nwritten here\n')
    carry(first.socket, b)
    for (const message of first.socket.take()) b.answer(message)

    // A phone opening the same note, its own copy of the file a sync left behind.
    const there = previewing('/space/b.md', '# B\n')
    const second = await inTheRoom(there, b)

    expect(words(there)).toBe('# B\nwritten here\n')
    expect(b.file).toBe('# B\nwritten here\n')

    // And the phone switching notes does not put b.md's words into a.md either.
    const a = new Server('/space/a.md', '# A\n')
    there.adopt({ path: '/space/a.md', name: 'a.md', text: '# A\n' })
    carry(second.socket, b)

    expect(b.file).toBe('# B\nwritten here\n')
    expect(a.file).toBe('# A\n')

    first.room.leave()
    second.room.leave()
  })
})
