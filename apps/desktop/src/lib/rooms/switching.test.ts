import { describe, expect, test, vi } from 'vitest'
import { EditorState } from '@orden/editor'
import { receive, syncUpdate, TEXT } from '@orden/rooms'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number) => void
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

  elsewhere(at: number, words: string, socket: InstanceType<typeof sockets.FakeSocket>) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  get file(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

function words(note: InstanceType<typeof NoteDoc>): string {
  note.flush()
  return note.text
}

function paneOn(note: InstanceType<typeof NoteDoc>) {
  const view = {
    state: EditorState.create({ doc: note.live.text }),
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      view.state = view.state.update(spec).state
    },
    get words(): string {
      return view.state.doc.toString()
    },
  }

  note.live.join(view)
  return view
}

function socketOf(): InstanceType<typeof sockets.FakeSocket> {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('the room opened no socket')

  return socket
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function previewing(path: string, words: string): InstanceType<typeof NoteDoc> {
  return new NoteDoc(
    { kind: 'note', path, name: path.split('/').at(-1) ?? path, text: words, dirty: false },
    () => undefined,
  )
}

function joining(note: InstanceType<typeof NoteDoc>, server: Server, hash: string | null) {
  const arrivals = note.arrivals

  const room = new Room({
    noteId: server.path,
    token: 'session',
    note: note.live,
    hash,
    who: { name: 'Windows', accent: 'blue' },
    scheme: 'dark',
    onPeers: () => undefined,
    digest: (text: string) => Promise.resolve(text),
    holds: () => note.arrivals === arrivals,
    gone: () => undefined,
    refused: () => undefined,
    shut: () => undefined,
    apart: () => Promise.resolve('take' as const),
  })

  return { room, socket: socketOf() }
}

function carry(socket: InstanceType<typeof sockets.FakeSocket>, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

async function inTheRoom(note: InstanceType<typeof NoteDoc>, server: Server) {
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

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    carry(held.socket, a)

    expect(a.file).toBe('# A\n')

    held.room.leave()
  })

  test('does not send what is typed in the new note into the old note’s room', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')
    const held = await inTheRoom(note, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
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

    expect(a.file).not.toContain('# B')
    expect(b.file).not.toContain('# A')

    held.room.leave()
  })
})

describe('a room answering after the tab has moved on', () => {
  test('neither offers the new note’s words nor binds itself to them', async () => {
    const note = previewing('/space/a.md', '# A\n')
    const a = new Server('/space/a.md', '# A\n')

    const held = joining(note, a, '# A\n')
    held.socket.arrive()
    carry(held.socket, a)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    await settled()
    carry(held.socket, a)

    expect(a.file).toBe('# A\n')

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

    const there = previewing('/space/b.md', '# B\n')
    const second = await inTheRoom(there, b)

    expect(words(there)).toBe('# B\nwritten here\n')
    expect(b.file).toBe('# B\nwritten here\n')

    const a = new Server('/space/a.md', '# A\n')
    there.adopt({ path: '/space/a.md', name: 'a.md', text: '# A\n' })
    carry(second.socket, b)

    expect(b.file).toBe('# B\nwritten here\n')
    expect(a.file).toBe('# A\n')

    first.room.leave()
    second.room.leave()
  })
})

describe('pressing undo after the tab has moved on', () => {
  test('cannot reach the note the document came from', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.live.replace('# A\nwritten in a\n')
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })

    expect(note.live.undoable).toBe(0)
    expect(note.live.undo(pane)).toBe(false)

    expect(words(note)).toBe('# B\n')
    expect(pane.words).toBe('# B\n')
    expect(note.path).toBe('/space/b.md')
    expect(note.dirty).toBe(false)
  })

  test('takes back only what was typed in the note that is up', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    note.live.replace('# B\nwritten in b\n')

    expect(note.live.undo(pane)).toBe(true)
    expect(words(note)).toBe('# B\n')
    expect(pane.words).toBe('# B\n')

    expect(note.live.undo(pane)).toBe(false)
    expect(words(note)).toBe('# B\n')
  })

  test('leaves redo with nothing of the old note to put back', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.live.replace('# A\nwritten in a\n')
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })

    expect(note.live.redoable).toBe(0)
    expect(note.live.redo(pane)).toBe(false)
    expect(words(note)).toBe('# B\n')

    note.live.replace('# B\nwritten in b\n')
    expect(note.live.undo(pane)).toBe(true)
    expect(words(note)).toBe('# B\n')
    expect(note.live.redo(pane)).toBe(true)
    expect(words(note)).toBe('# B\nwritten in b\n')
  })

  test('cannot reach across the switch even after typing in the new note', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.live.replace('# A\nwritten in a\n')
    note.live.replace('# A\nwritten in a, twice\n')
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })
    note.live.replace('# B\nwritten in b\n')

    for (let press = 0; press < 6; press++) note.live.undo(pane)

    expect(words(note)).toBe('# B\n')
    expect(words(note)).not.toContain('# A')
  })

  test('a note re-read from disk is not a step to go back to', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.replace('# A, changed by another program\n', false)

    expect(note.live.undoable).toBe(0)
    expect(note.live.undo(pane)).toBe(false)
    expect(words(note)).toBe('# A, changed by another program\n')
    expect(note.dirty).toBe(false)
  })

  test('a version put back is a step to go back to, because somebody asked for it', () => {
    const note = previewing('/space/a.md', '# A, as it is now\n')
    const pane = paneOn(note)

    note.replace('# A, as it was\n')
    expect(note.dirty).toBe(true)

    expect(note.live.undo(pane)).toBe(true)
    expect(words(note)).toBe('# A, as it is now\n')
  })

  test('cannot reach across the switch through a rename’s re-read', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.live.replace('# A\nwritten in a\n')
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B\n' })

    note.replace('# B\nas the file now reads\n', false)
    note.path = '/space/renamed.md'
    note.name = 'renamed.md'

    for (let press = 0; press < 4; press++) note.live.undo(pane)

    expect(words(note)).toBe('# B\nas the file now reads\n')
    expect(words(note)).not.toContain('# A')
    expect(note.dirty).toBe(false)
  })

  test('cannot reach across the switch through a version put back', () => {
    const note = previewing('/space/a.md', '# A\n')
    const pane = paneOn(note)

    note.live.replace('# A\nwritten in a\n')
    note.adopt({ path: '/space/b.md', name: 'b.md', text: '# B, as it is now\n' })

    note.replace('# B, as it was\n')
    expect(note.live.undo(pane)).toBe(true)
    expect(words(note)).toBe('# B, as it is now\n')

    expect(note.live.undo(pane)).toBe(false)
    expect(words(note)).not.toContain('# A')
  })

  test('a room bringing another device’s words over is nobody’s undo', () => {
    const note = previewing('/space/b.md', '# B\n')
    const pane = paneOn(note)

    note.live.arrived([{ from: 3, to: 3, insert: ' from the phone' }])

    expect(note.live.undoable).toBe(0)
    expect(note.live.undo(pane)).toBe(false)
    expect(words(note)).toBe('# B from the phone\n')
  })
})
