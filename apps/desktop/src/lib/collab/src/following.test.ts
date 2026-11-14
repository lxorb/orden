import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { emptyCanvas } from '@orden/markdown/canvas'
import { isEdit, receive, syncUpdate, TEXT } from '@orden/rooms'
import { NOW_READS } from '@orden/sync-core'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { PlaneSurface } from '../../canvas/shared'

const sockets = vi.hoisted(() => {
  interface Wire {
    opened: () => void
    heard: (message: Uint8Array) => void
    closed: (code: number, said: string) => void
  }

  class FakeSocket {
    private sent: Uint8Array[] = []
    private up = false
    stopped = false

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

    went(code: number, said = '') {
      this.up = false
      this.wire.closed(code, said)
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
      this.stopped = true
    }
  }

  const opened: FakeSocket[] = []
  return { FakeSocket, opened }
})

vi.mock('../../collab-rooms/src/socket', () => ({ RoomSocket: sockets.FakeSocket }))
vi.mock('./who', () => ({
  deviceName: () => 'Windows',
  deviceAccent: () => 'blue',
  ownAccent: () => 'blue',
  personName: () => undefined,
  personFace: () => ({}),
}))
const session = vi.hoisted(() => ({ token: 'session', name: null, rechecked: 0, listed: 0 }))

vi.mock('../../accounts/src/account.svelte', () => ({
  account: Object.assign(session, {
    forgetWithSession: () => undefined,
    recheck: () => {
      session.rechecked += 1
      return Promise.resolve()
    },
    loadSpaces: () => {
      session.listed += 1
      return Promise.resolve()
    },
  }),
}))
vi.mock('../../theme/src/theme.svelte', () => ({ theme: { current: 'dark' } }))

const said: string[] = []

vi.mock('../../busy.svelte', () => ({
  busy: {
    failed: (reason: string) => said.push(reason),
    start: () => undefined,
  },
}))

const { inRooms, rooms } = await import('./rooms.svelte')
const { record } = await import('../../sync/record.svelte')
const { NoteDoc } = await import('../../workspace/documents.svelte')

type Doc = InstanceType<typeof NoteDoc>
type Socket = InstanceType<typeof sockets.FakeSocket>

class Server {
  readonly doc = new Y.Doc()
  private readonly awareness = new Awareness(this.doc)

  constructor(words: string) {
    if (words) this.doc.getText(TEXT).insert(0, words)
  }

  answer(message: Uint8Array): Uint8Array | null {
    return receive(message, this.doc, this.awareness, 'socket')
  }

  elsewhere(at: number, words: string, socket: Socket) {
    const before = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    socket.wire.heard(syncUpdate(Y.encodeStateAsUpdate(this.doc, before)))
  }

  get file(): string {
    return this.doc.getText(TEXT).toJSON()
  }
}

function documentOn(path: string, words: string, kind: 'note' | 'canvas' = 'note'): Doc {
  return new NoteDoc(
    { kind, path, name: path.split('/').at(-1) ?? path, text: words, dirty: false },
    () => undefined,
  )
}

function surface(): PlaneSurface {
  return {
    canvas: emptyCanvas(),
    shared: null,
    arrived: () => undefined,
    handsAre: () => undefined,
    historyIs: () => undefined,
  }
}

function latest(): Socket {
  const socket = sockets.opened.at(-1)
  if (!socket) throw new Error('no socket was opened')

  return socket
}

async function until(what: () => boolean, said: string): Promise<void> {
  for (let tries = 0; tries < 2000; tries++) {
    if (what()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }

  throw new Error(`gave up waiting for ${said}`)
}

function carry(socket: Socket, server: Server) {
  for (const message of socket.take()) {
    const back = server.answer(message)
    if (back) socket.wire.heard(back)
  }
}

function words(note: Doc): string {
  note.flush()
  return note.text
}

async function digestOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function following(note: Doc, server: Server, held = words(note)) {
  const hash = await digestOf(held)
  rooms.follow([{ key: note.key, noteId: 'note-1', note, hash, version: 1 }])

  const socket = latest()
  socket.arrive()
  carry(socket, server)
  await until(() => rooms.carries('note-1'), 'the room to catch up')
  carry(socket, server)

  return socket
}

beforeAll(async () => {
  await rooms.reach()
})

beforeEach(() => {
  rooms.clear()
  sockets.opened.length = 0
  session.token = 'session'
  session.rechecked = 0
  session.listed = 0
})

describe('a writer made a reader while the note is open in its room', () => {
  test('asks again what it may do, and joins the room again rather than redialling', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(NOW_READS)

    expect(socket.stopped).toBe(true)
    expect(session.listed).toBe(1)
    await until(() => sockets.opened.length === 2, 'the room joined again')
  })

  test('locks the note at once, before the spaces have been asked again', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    let answer = (): void => undefined
    const asked = new Promise<void>((done) => {
      answer = done
    })
    const loading = vi
      .spyOn((await import('../../accounts/src/account.svelte')).account, 'loadSpaces')
      .mockImplementation(() => asked)

    try {
      socket.went(NOW_READS)

      expect(note.reads).toBe(true)
      answer()
      await until(() => !note.reads, 'the note to write again once the spaces answer')
    } finally {
      answer()
      loading.mockRestore()
    }
  })

  test('shows the room’s words again, not what the room no longer took from it', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    note.live.replace('# A\ntyped after it was made a reader\n')
    note.flush()
    socket.take()
    socket.went(NOW_READS)

    await until(() => sockets.opened.length === 2, 'the room joined again')
    const back = latest()
    back.arrive()
    carry(back, server)
    await until(() => rooms.carries('note-1'), 'the room to catch up again')
    for (const message of back.take()) {
      if (!isEdit(message)) server.answer(message)
    }

    expect(server.file).toBe('# A\n')
    expect(words(note)).toBe('# A\n')
  })
})

describe('a space renamed while one of its notes is open in a room', () => {
  test('keeps carrying what is typed into it', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    note.live.replace('# A\nafter the rename\n')
    note.flush()
    carry(socket, server)

    expect(server.file).toBe('# A\nafter the rename\n')
  })

  test('and keeps bringing the other device’s words in', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    server.elsewhere(3, ' from the phone', socket)

    expect(words(note)).toBe('# A from the phone\n')
  })

  test('and does not leave the room, so the file sync is right to stand back', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    const before = sockets.opened.length
    note.path = '/Renamed/a.md'
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])

    expect(sockets.opened.length).toBe(before)
    expect(socket.open).toBe(true)
    expect(rooms.carries('note-1')).toBe(true)
  })
})

describe('a file put into a note whose room cannot be reached (#541)', () => {
  test('reaches the room once, from the other device, and the note holds it once', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(1006)
    expect(rooms.carries('note-1')).toBe(false)
    server.doc.getText(TEXT).insert(4, 'from the phone\n')

    rooms.letGoUnreached('note-1')
    note.replace(server.file, false)
    note.flush()

    expect(socket.stopped).toBe(true)
    const again = latest()
    expect(again).not.toBe(socket)
    again.arrive()
    carry(again, server)
    await until(() => rooms.carries('note-1'), 'the room joined again')
    carry(again, server)

    expect(server.file).toBe('# A\nfrom the phone\n')
    expect(words(note)).toBe('# A\nfrom the phone\n')
  })

  test('is not why a room that can be reached is let go of', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    const before = sockets.opened.length

    rooms.letGoUnreached('note-1')

    expect(sockets.opened.length).toBe(before)
    expect(socket.stopped).toBe(false)
    expect(rooms.carries('note-1')).toBe(true)
  })
})

describe('which shape of room a file joins', () => {
  test('is the file’s name, not what the tab was opened as', async () => {
    const note = documentOn('/Notes/Board.canvas', '{}', 'note')
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '{}', version: 1 }])

    expect(sockets.opened).toHaveLength(0)
  })

  test('waits for the plane a canvas is about, and then joins it', async () => {
    const note = documentOn('/Notes/Board.canvas', '{}', 'canvas')
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '{}', version: 1 }])
    expect(sockets.opened).toHaveLength(0)

    rooms.drawing(note.key, surface())
    expect(sockets.opened).toHaveLength(1)
  })

  test('is worked out again when the file’s name crosses the two kinds', async () => {
    const note = documentOn('/Notes/plan.md', '# Plan\n')
    const server = new Server('# Plan\n')
    await following(note, server)
    expect(sockets.opened).toHaveLength(1)

    note.path = '/Notes/plan.canvas'
    rooms.drawing(note.key, surface())
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# Plan\n', version: 1 }])

    expect(sockets.opened).toHaveLength(2)
    expect(sockets.opened[0]?.open).toBe(false)
  })
})

describe('a room the service threw away and will build again', () => {
  test('is joined again rather than reconnected to', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(1012)

    expect(sockets.opened).toHaveLength(2)
    expect(socket.stopped).toBe(true)
  })

  test('loses nothing that was typed while it was away', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(1012)
    note.live.replace('# A\ntyped while it was away\n')
    note.flush()

    const rebuilt = new Server('# A\n')
    const back = latest()
    back.arrive()
    carry(back, rebuilt)
    await until(() => rooms.carries('note-1'), 'the new room to catch up')
    carry(back, rebuilt)

    expect(rebuilt.file).toBe('# A\ntyped while it was away\n')
    expect(words(note)).toBe('# A\ntyped while it was away\n')
  })

  test('takes its own words back from the new room as its own, never as a copy', async () => {
    const { modes } = await import('../../modes.svelte')
    modes.conflicts = 'ask'
    try {
      const note = documentOn('/Notes/a.md', '# A\n')
      const server = new Server('# A\n')
      const socket = await following(note, server)
      note.live.replace('# A\ntyped in the room\n')
      note.flush()
      carry(socket, server)
      expect(server.file).toBe('# A\ntyped in the room\n')

      socket.went(1012)
      note.live.replace('# A\ntyped in the room\nand after it went\n')
      note.flush()

      const rebuilt = new Server('# A\ntyped in the room\n')
      const back = latest()
      back.arrive()
      carry(back, rebuilt)
      await until(() => rooms.carries('note-1'), 'the new room to catch up')
      carry(back, rebuilt)

      expect(record.clashes).toEqual([])
      expect(rebuilt.file).toBe('# A\ntyped in the room\nand after it went\n')
      expect(words(note)).toBe('# A\ntyped in the room\nand after it went\n')
    } finally {
      modes.conflicts = 'both'
      record.forgetEverything()
    }
  })

  test('takes the new room’s words when nothing was typed here since', async () => {
    const { modes } = await import('../../modes.svelte')
    modes.conflicts = 'ask'
    try {
      const note = documentOn('/Notes/a.md', '# A\n')
      const server = new Server('# A\n')
      const socket = await following(note, server)
      note.live.replace('# A\ntyped in the room\n')
      note.flush()
      carry(socket, server)

      socket.went(1012)

      const rebuilt = new Server('# A\nfrom the phone\n')
      const back = latest()
      back.arrive()
      carry(back, rebuilt)
      await until(() => rooms.carries('note-1'), 'the new room to catch up')

      expect(record.clashes).toEqual([])
      expect(words(note)).toBe('# A\nfrom the phone\n')
    } finally {
      modes.conflicts = 'both'
      record.forgetEverything()
    }
  })

  test('stays out of its room while a reader is being asked, and rejoins after', async () => {
    const { modes } = await import('../../modes.svelte')
    modes.conflicts = 'ask'

    try {
      const note = documentOn('/Notes/a.md', '# A\n')
      const server = new Server('# A\n')
      const socket = await following(note, server)

      socket.went(1012)
      note.live.replace('# A\ntyped while it was away\n')
      note.flush()

      const rebuilt = new Server('# A\nand something from the phone\n')
      const back = latest()
      back.arrive()
      carry(back, rebuilt)
      await until(() => !!record.clashes.length, 'the clash to reach the pane')
      carry(back, rebuilt)

      expect(words(note)).toBe('# A\ntyped while it was away\n')
      expect(rebuilt.file).toBe('# A\nand something from the phone\n')
      expect(rooms.carries('note-1')).toBe(false)
      expect(record.clashes.map((one) => one.theirs)).toEqual([
        '# A\nand something from the phone\n',
      ])

      const opened = sockets.opened.length
      rooms.follow([
        {
          key: note.key,
          noteId: 'note-1',
          note,
          hash: await digestOf('# A\nsettled by hand\n'),
          version: 2,
        },
      ])

      expect(sockets.opened.length).toBe(opened + 1)
    } finally {
      modes.conflicts = 'both'
      record.forgetEverything()
    }
  })

  test('does not count as being in a room while it is gone', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    expect(rooms.carries('note-1')).toBe(true)

    socket.went(1012)

    expect(rooms.carries('note-1')).toBe(false)
  })
})

describe('a room that will take no more keystrokes', () => {
  const TOO_LARGE = 1009
  const SAID = 'this note is as large as a note in a room may get'

  beforeEach(() => {
    said.length = 0
  })

  test('is let go rather than joined again', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)
    expect(rooms.carries('note-1')).toBe(true)

    socket.went(TOO_LARGE, SAID)

    expect(socket.stopped).toBe(true)
    expect(sockets.opened).toHaveLength(1)
    expect(rooms.carries('note-1')).toBe(false)
  })

  test('and says so once, in the app’s own words', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)

    expect(said).toEqual(['This note is as large as a note in a room may get.'])
  })

  test('and is not dialled again, to say so again, while the same note stays open', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 2 }])

    expect(sockets.opened).toHaveLength(1)
    expect(said).toHaveLength(1)
  })

  test('is tried again once the note is opened anew', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)
    rooms.follow([])
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 2 }])

    expect(sockets.opened).toHaveLength(2)
  })

  test('while the words carry on being written into the file', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const server = new Server('# A\n')
    const socket = await following(note, server)

    socket.went(TOO_LARGE, SAID)
    note.live.replace('# A\nstill typing\n')
    note.flush()

    expect(words(note)).toBe('# A\nstill typing\n')
  })
})

describe('a room the server shut this device out of', () => {
  const SHUT_OUT = 1008
  const SIGNED_OUT = 4401

  function open(note: Doc) {
    rooms.follow([{ key: note.key, noteId: 'note-1', note, hash: '# A\n', version: 1 }])
  }

  test('is not dialled again while the same note stays open', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const socket = await following(note, new Server('# A\n'))

    socket.went(SHUT_OUT, 'no longer in this space')
    open(note)

    expect(socket.stopped).toBe(true)
    expect(sockets.opened).toHaveLength(1)
    expect(rooms.carries('note-1')).toBe(false)
  })

  test('is joined again once the note is opened anew', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const socket = await following(note, new Server('# A\n'))

    socket.went(SHUT_OUT, 'no longer in this space')
    rooms.follow([])
    open(note)

    expect(sockets.opened).toHaveLength(2)
  })

  test('and for a session that ended, asks the account whether it still holds', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const socket = await following(note, new Server('# A\n'))

    socket.went(SIGNED_OUT, 'signed out')
    open(note)

    expect(socket.stopped).toBe(true)
    expect(sockets.opened).toHaveLength(1)
    expect(session.rechecked).toBe(1)
  })

  test('a room is dialled again with the session that took over, not the one it was opened with', async () => {
    const note = documentOn('/Notes/a.md', '# A\n')
    const socket = await following(note, new Server('# A\n'))

    session.token = 'upgraded'
    open(note)

    expect(socket.stopped).toBe(true)
    expect(latest().token).toBe('upgraded')
  })
})

describe('a file shared on its own', () => {
  const ID = 'shared-1'
  const tracked = (path: string) => ({ id: `tracked:${path}`, version: 3, hash: 'h' })

  function sharedNote(words: string): Doc {
    return new NoteDoc(
      { kind: 'note', path: null, name: 'one', text: words, dirty: false, shared: ID },
      () => undefined,
    )
  }

  function tabs(...notes: Doc[]) {
    return notes.map((note) => ({ key: note.key, path: note.path ?? '', note }))
  }

  test('is in its room under v2, and the notes the engine carries are not', () => {
    const mine = documentOn('/Notes/a.md', '# A\n')
    const theirs = sharedNote('# One\n')

    const v2 = inRooms(tabs(mine, theirs), null)
    expect(v2).toEqual([{ key: theirs.key, note: theirs, noteId: ID, hash: null, version: 0 }])

    const v1 = inRooms(tabs(mine, theirs), tracked)
    expect(v1.map((one) => one.noteId)).toEqual(['tracked:/Notes/a.md', ID])
  })

  test('carries what is typed into it to the room under v2', async () => {
    const note = sharedNote('# One\n')
    const server = new Server('# One\n')
    rooms.follow(inRooms(tabs(note), null))

    const socket = latest()
    expect(socket.noteId).toBe(ID)
    socket.arrive()
    carry(socket, server)
    await until(() => rooms.carries(ID), 'the room to catch up')
    carry(socket, server)

    note.live.replace('# One\nfrom the one person\n')
    note.flush()
    carry(socket, server)

    expect(server.file).toBe('# One\nfrom the one person\n')
  })

  test('keeps its room when the engine changes under it', async () => {
    const note = sharedNote('# One\n')
    const server = new Server('# One\n')
    rooms.follow(inRooms(tabs(note), tracked))
    const socket = latest()
    socket.arrive()
    carry(socket, server)
    await until(() => rooms.carries(ID), 'the room to catch up')

    rooms.follow(inRooms(tabs(note), null))
    rooms.follow(inRooms(tabs(note), tracked))

    expect(sockets.opened).toHaveLength(1)
    expect(socket.open).toBe(true)
    expect(rooms.carries(ID)).toBe(true)
  })
})
