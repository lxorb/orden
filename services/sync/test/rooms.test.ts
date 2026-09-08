import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { type Canvas, type InkStroke, readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { stamped } from '@nib/markdown/canvas-merge'
import { awarenessUpdate, receive, subprotocol, syncStep1, syncUpdate, TEXT } from '@nib/rooms'
import { pushPlane, readPlane } from '@nib/rooms/plane'
import * as Y from 'yjs'
import { NoteRoom } from '../src/rooms/room'
import { call, signIn, type ShareView, type TestEnv, testEnv } from './harness'
import { doorway, FakeSocket, type FakeState, join, room, say } from './room'

/** What the note holds before anybody writes in it. */
const OPENING = '# Together\n'

/** A device in a room, the way the app's client is one: its own document, its own
 *  awareness, and the same protocol run over whatever the room says. */
class Device {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly text = this.doc.getText(TEXT)

  constructor(readonly socket: FakeSocket) {}

  get words(): string {
    return this.text.toJSON()
  }

  /** What this device would send after typing: the update its own document made. */
  type(at: number, words: string): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    this.text.insert(at, words)
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }
}

/** A device joining, through the whole handshake: the room says what it holds and
 *  who is in it, the device says what it holds, and both catch up. */
async function arrive(
  made: NoteRoom,
  state: FakeState,
  note: { id: string; spaceId: string },
): Promise<Device> {
  const device = new Device(await join(made, note))
  await say(made, state, device.socket, syncStep1(device.doc))
  await settle(made, state, [device])
  return device
}

/** Everything waiting on the wire, in both directions, until nothing is left. */
async function settle(made: NoteRoom, state: FakeState, devices: readonly Device[]) {
  for (let round = 0; round < 12; round++) {
    let moved = false

    for (const device of devices) {
      for (const message of device.socket.take()) {
        moved = true
        const answer = receive(message, device.doc, device.awareness, 'room')
        if (answer) await say(made, state, device.socket, answer)
      }
    }

    if (!moved) return
  }

  throw new Error('the room and the devices never stopped talking')
}

describe('a room', () => {
  let env: TestEnv
  let token: string
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'writer@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'together.md', content: '# Together\n' },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  test('opens on the note as the store holds it', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    expect(one.words).toBe('# Together\n')
  })

  test('carries what one device types to the other', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(11, 'from one\n'))
    await settle(made, state, [one, two])

    expect(two.words).toBe('# Together\nfrom one\n')
  })

  test('settles two devices typing in the same place into one text', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    // Both write at the end of the same line before either has heard the other.
    const first = one.type(11, 'one\n')
    const second = two.type(11, 'two\n')

    await say(made, state, one.socket, first)
    await say(made, state, two.socket, second)
    await settle(made, state, [one, two])

    expect(one.words).toBe(two.words)
    expect(one.words).toContain('one')
    expect(one.words).toContain('two')
  })

  test('keeps both when one device was away while the other wrote', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'written here\n'))
    await settle(made, state, [one])

    // A device that had the note open all along, offline, and now reconnects.
    const away = new Device(new FakeSocket())
    Y.applyUpdate(away.doc, Y.encodeStateAsUpdate(one.doc))
    const alone = away.type(away.words.length, 'written there\n')

    const back = await arrive(made, state, { id: noteId, spaceId })
    Y.applyUpdate(back.doc, Y.encodeStateAsUpdate(away.doc))
    await say(made, state, back.socket, alone)
    await settle(made, state, [one, back])

    expect(back.words).toContain('written here')
    expect(back.words).toContain('written there')
    expect(one.words).toBe(back.words)
  })

  test('writes the words into the note store when the typing stops', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(11, 'settled\n'))
    expect(state.takeAlarm()).not.toBeNull()

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nsettled\n')
    // An ordinary save: the version moved on, so every device that is not in the
    // room reads it as an edit made somewhere else.
    expect(read.json.note.version).toBe(2)
  })

  test('writes nothing when the words did not change', async () => {
    const { room: made, state } = room(env)
    await arrive(made, state, { id: noteId, spaceId })

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.note.version).toBe(1)
  })

  test('settles when the last device leaves', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'and then away\n'))

    await made.webSocketClose(one.socket as unknown as WebSocket)

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nand then away\n')
  })

  test('folds the pile of updates into one snapshot', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    for (let at = 0; at < 240; at++) {
      await say(made, state, one.socket, one.type(11 + at, 'x'))
    }

    const kept = [...state.kept.keys()]
    expect(kept.filter((key) => key.startsWith('state:')).length).toBeGreaterThan(0)
    expect(kept.filter((key) => key.startsWith('log:')).length).toBeLessThan(240)
  })

  test('reads itself back after the runtime has put it to sleep', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'slept on it\n'))
    // The settle is where what arrived reaches storage; see `record` in state.ts.
    await made.alarm()

    // A second room over the same storage is what waking up looks like: every
    // field is gone, and what matters came back out of the object.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(woken, state, { id: noteId, spaceId })

    expect(back.words).toBe('# Together\nslept on it\n')
  })

  test('asks the devices that were here for what it slept through', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    // Typed, and no settle: those keystrokes are in the room's memory and in this
    // device, and nowhere else.
    await say(made, state, one.socket, one.type(11, 'never written down\n'))
    one.socket.take()

    // The same storage, a new object, and the device still connected. Its greeting
    // is what asks the device to say what it has.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await woken.webSocketMessage(
      one.socket as unknown as WebSocket,
      syncStep1(one.doc).slice().buffer,
    )
    await state.idle()
    await settle(woken, state, [one])

    await woken.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nnever written down\n')
  })

  test('takes a caret away when its device leaves', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    one.awareness.setLocalStateField('user', { name: 'One' })
    await say(made, state, one.socket, awarenessUpdate(one.awareness, [one.doc.clientID]))
    await settle(made, state, [one, two])
    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(true)

    await made.webSocketClose(one.socket as unknown as WebSocket)
    await settle(made, state, [two])

    expect(two.awareness.getStates().has(one.doc.clientID)).toBe(false)
  })
})

describe('a reader in a room', () => {
  let env: TestEnv
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    const token = await signIn(env, 'owner@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'together.md', content: OPENING },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  /** A device the door let in to read and not to write; see rooms/index.ts. */
  async function reading(made: NoteRoom, state: FakeState): Promise<Device> {
    const device = new Device(await join(made, { id: noteId, spaceId }, false))
    await say(made, state, device.socket, syncStep1(device.doc))
    await settle(made, state, [device])
    return device
  }

  test('is given what the room holds', async () => {
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    expect(reader.words).toBe(OPENING)
  })

  test('sees what somebody else writes, as it is written', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    await say(made, state, writer.socket, writer.type(OPENING.length, 'a line'))
    await settle(made, state, [writer, reader])

    expect(reader.words).toBe(`${OPENING}a line`)
  })

  test('cannot write into it, and nobody else hears them try', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)
    writer.socket.take()

    await say(made, state, reader.socket, reader.type(0, 'not mine to write'))
    await settle(made, state, [writer])

    expect(writer.words).toBe(OPENING)
    expect(writer.socket.take()).toEqual([])
  })

  test('cannot write into it by having been away, either', async () => {
    // What a device that was closed sends to put its own words back is an
    // ordinary update, so it is refused in exactly the same way.
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    reader.text.insert(0, 'written while away')
    await say(made, state, reader.socket, syncStep1(reader.doc))
    await settle(made, state, [reader])

    const { room: again, state: theirs } = room(env)
    theirs.kept.set('note', { noteId, spaceId })
    const after = await arrive(again, theirs, { id: noteId, spaceId })
    expect(after.words).not.toContain('written while away')
  })

  test('leaves the note in the store as it was', async () => {
    const { room: made, state } = room(env)
    const reader = await reading(made, state)

    await say(made, state, reader.socket, reader.type(0, 'no'))
    await state.idle()
    await made.alarm()

    const token = await signIn(env, 'looking@example.com')
    // Read through the database, because the account that owns it has already
    // used its one code above and asking for a second inside the resend gap
    // gets none.
    env.db.exec(
      `insert into space_members (space_id, email, role, created_at)
       values ('${spaceId}', 'looking@example.com', 'read', 1)`,
    )
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe(OPENING)
  })

  test('still has a caret, which everybody else sees', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    reader.awareness.setLocalStateField('who', { name: 'Ada', accent: 'violet' })
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])

    expect(writer.awareness.getStates().get(reader.doc.clientID)).toEqual({
      who: { name: 'Ada', accent: 'violet' },
    })
  })
})

describe('the door to a room', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  test('lets in whoever the space was shared with, and says what they may do', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const space = await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })
    const spaceId = space.json.space.id
    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token: owner,
      body: { path: 'shared.md', content: 'together' },
    })
    const noteId = note.json.note.id

    const sessions: Record<string, string> = { owner }
    for (const role of ['write', 'read'] as const) {
      const email = `${role}@example.com`
      await call(env, `/v1/spaces/${spaceId}/share/invite`, { token: owner, body: { email, role } })
      sessions[role] = await signIn(env, email)
    }

    for (const [who, writes] of [
      ['owner', 'yes'],
      ['write', 'yes'],
      ['read', 'no'],
    ] as const) {
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(sessions[who] ?? ''),
        },
      })

      expect(answer.status, who).toBe(200)
      expect(door.asked.at(-1)?.get('x-nib-write'), who).toBe(writes)
      expect(door.asked.at(-1)?.get('x-nib-space'), who).toBe(spaceId)
    }

    // And somebody nobody shared it with is a note that is not there.
    const outside = await signIn(env, 'nobody@example.com')
    const refused = await call(env, `/rooms/${noteId}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(outside) },
    })
    expect(refused.status).toBe(404)
  })

  test('lets in a guest a link let in, at what the link said', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })).json
      .space.id
    const noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'shared.md', content: 'together' },
      })
    ).json.note.id

    /** Somebody with no account who followed the space's link. */
    async function guest(role: 'write' | 'read', mode: 'open' | 'approval'): Promise<string> {
      const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
        method: 'PUT',
        token: owner,
        body: { role, mode },
      })
      const token = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
      const walked = await call(env, `/v1/join/${token}`, { method: 'POST', body: { name: 'Ada' } })

      return walked.json.token
    }

    for (const [role, writes] of [
      ['write', 'yes'],
      ['read', 'no'],
    ] as const) {
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(await guest(role, 'open')),
        },
      })

      expect(answer.status, role).toBe(200)
      expect(door.asked.at(-1)?.get('x-nib-write'), role).toBe(writes)
      expect(door.asked.at(-1)?.get('x-nib-space'), role).toBe(spaceId)
    }

    // A canvas is the same door and the same guest: the kind is read off the
    // file's name in the very query that answered the guest's session.
    const boardId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'Board.canvas', content: '' },
      })
    ).json.note.id

    const drawing = await call(env, `/rooms/${boardId}`, {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': subprotocol(await guest('write', 'open')),
      },
    })

    expect(drawing.status).toBe(200)
    expect(door.asked.at(-1)?.get('x-nib-kind')).toBe('plane')
    expect(door.asked.at(-1)?.get('x-nib-write')).toBe('yes')

    // Waiting on the owner is not being in, so the note is not there yet.
    const waiting = await call(env, `/rooms/${noteId}`, {
      headers: {
        upgrade: 'websocket',
        'sec-websocket-protocol': subprotocol(await guest('write', 'approval')),
      },
    })
    expect(waiting.status).toBe(404)
  })

  test('turns away a socket with no session', async () => {
    const answer = await call(env, '/rooms/whatever', {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol('not-a-token') },
    })

    expect(answer.status).toBe(401)
  })

  test('turns away a note that belongs to another account', async () => {
    const mine = await signIn(env, 'mine@example.com')
    const theirs = await signIn(env, 'theirs@example.com')

    const space = await call(env, '/v1/spaces', { token: theirs, body: { name: 'Theirs' } })
    const note = await call(env, `/v1/spaces/${space.json.space.id}/notes`, {
      token: theirs,
      body: { path: 'secret.md', content: 'shh' },
    })

    const answer = await call(env, `/rooms/${note.json.note.id}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(mine) },
    })

    expect(answer.status).toBe(404)
  })

  test('is not a page to be read', async () => {
    const token = await signIn(env, 'reader@example.com')
    const answer = await call(env, '/rooms/whatever', {
      headers: { 'sec-websocket-protocol': subprotocol(token) },
    })

    expect(answer.status).toBe(426)
  })

  test('says which shape the room holds, from the name of the file', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const token = await signIn(env, 'both@example.com')
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    const spaceId = space.json.space.id

    for (const [path, kind] of [
      ['a.md', 'words'],
      ['Board.canvas', 'plane'],
    ] as const) {
      const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path, content: '' },
      })

      await call(env, `/rooms/${note.json.note.id}`, {
        headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
      })

      expect(door.asked.at(-1)?.get('x-nib-kind'), path).toBe(kind)
    }
  })
})

/** A device on a plane, the way the app's client is one: its own document, and the
 *  same two maps both ends of the real thing ask for. */
class Plane {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  constructor(readonly socket: FakeSocket) {}

  get canvas(): Canvas {
    return readPlane(this.doc)
  }

  /** What this device would send after drawing: the update its own document made. */
  draws(...strokes: InkStroke[]): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    const was = this.canvas
    const now = { ...was, ink: [...was.ink, ...strokes] }
    this.doc.transact(() => pushPlane(this.doc, was, stamped(was, now, 5000)))
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }

  /** A card moved, which is an edit to an object rather than one more of them. */
  moves(id: string, x: number, y: number): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    const was = this.canvas
    const now = {
      ...was,
      nodes: was.nodes.map((node) => (node.id === id ? { ...node, x, y } : node)),
    }
    this.doc.transact(() => pushPlane(this.doc, was, stamped(was, now, 6000)))
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }
}

function penStroke(id: string, count: number, colour = '1'): InkStroke {
  return {
    id,
    tool: 'pen',
    color: colour,
    size: 6,
    points: Array.from({ length: count }, (_, at) => ({
      x: at * 4,
      y: at * 2,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      t: at * 8,
    })),
  }
}

async function onPlane(
  made: NoteRoom,
  state: FakeState,
  note: { id: string; spaceId: string },
  writes = true,
): Promise<Plane> {
  const device = new Plane(await join(made, { ...note, kind: 'plane' }, writes))
  await say(made, state, device.socket, syncStep1(device.doc))
  await drain(made, state, [device])
  return device
}

/** Everything waiting on the wire, in both directions, until nothing is left.
 *  The same as `settle` above; a plane's devices are another shape. */
async function drain(made: NoteRoom, state: FakeState, devices: readonly Plane[]) {
  for (let round = 0; round < 12; round++) {
    let moved = false

    for (const device of devices) {
      for (const message of device.socket.take()) {
        moved = true
        const answer = receive(message, device.doc, device.awareness, 'room')
        if (answer) await say(made, state, device.socket, answer)
      }
    }

    if (!moved) return
  }

  throw new Error('the room and the devices never stopped talking')
}

describe('a canvas in a room', () => {
  let env: TestEnv
  let token: string
  let spaceId: string
  let noteId: string

  /** A canvas with one card and one stroke already on it. */
  const DRAWN: Canvas = {
    nodes: [{ id: 'card', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a card' }],
    edges: [],
    ink: [penStroke('first', 5)],
    at: { card: 1000, first: 1000 },
    gone: {},
  }

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'drawer@example.com')

    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    spaceId = space.json.space.id

    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'Board.canvas', content: writeCanvas(DRAWN) },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  test('opens on the file as the store holds it', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    expect(writeCanvas(one.canvas)).toBe(writeCanvas(DRAWN))
  })

  test('carries a stroke to the other device, whole', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.draws(penStroke('mine', 300, '2')))
    await drain(made, state, [one, two])

    const held = two.canvas.ink.find((stroke) => stroke.id === 'mine')
    expect(held?.points).toHaveLength(300)
    expect(held?.color).toBe('2')
  })

  test('keeps both strokes when two devices draw at once', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const first = one.draws(penStroke('from-one', 8))
    const second = two.draws(penStroke('from-two', 8))
    await say(made, state, one.socket, first)
    await say(made, state, two.socket, second)
    await drain(made, state, [one, two])

    for (const device of [one, two]) {
      expect(device.canvas.ink.map((stroke) => stroke.id)).toEqual([
        'first',
        'from-one',
        'from-two',
      ])
    }
  })

  test('one card moved on one device and coloured on the other keeps both', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const moved = one.moves('card', 400, 120)
    const coloured = (() => {
      const was = two.canvas
      const before = Y.encodeStateVector(two.doc)
      const now = {
        ...was,
        nodes: was.nodes.map((node) => (node.id === 'card' ? { ...node, color: '5' } : node)),
      }
      two.doc.transact(() => pushPlane(two.doc, was, stamped(was, now, 6000)))
      return syncUpdate(Y.encodeStateAsUpdate(two.doc, before))
    })()

    await say(made, state, one.socket, moved)
    await say(made, state, two.socket, coloured)
    await drain(made, state, [one, two])

    for (const device of [one, two]) {
      expect(device.canvas.nodes[0]).toMatchObject({ x: 400, y: 120, color: '5' })
    }
  })

  test('writes the canvas into the note store when the drawing stops', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.draws(penStroke('settled', 12, '3')))
    expect(state.takeAlarm()).not.toBeNull()

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    // Exactly the file the app would have written from the same plane, so
    // Obsidian, the exports and an offline device's merge all read it as one.
    expect(read.json.content).toBe(writeCanvas(one.canvas))
    expect(readCanvas(read.json.content).ink.map((stroke) => stroke.id)).toEqual([
      'first',
      'settled',
    ])
    expect(read.json.note.version).toBe(2)
  })

  test('writes nothing when nobody drew', async () => {
    const { room: made, state } = room(env)
    await onPlane(made, state, { id: noteId, spaceId })

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.note.version).toBe(1)
  })

  test('a reader sees every stroke and can add none', async () => {
    const { room: made, state } = room(env)
    const writer = await onPlane(made, state, { id: noteId, spaceId })
    const reader = await onPlane(made, state, { id: noteId, spaceId }, false)

    await say(made, state, writer.socket, writer.draws(penStroke('theirs', 6)))
    await drain(made, state, [writer, reader])
    expect(reader.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'theirs'])

    // And what the reader draws goes nowhere at all.
    writer.socket.take()
    await say(made, state, reader.socket, reader.draws(penStroke('refused', 6)))
    await drain(made, state, [writer])

    expect(writer.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'theirs'])

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(readCanvas(read.json.content).ink.map((stroke) => stroke.id)).toEqual([
      'first',
      'theirs',
    ])
  })

  test('folds the pile of strokes into one snapshot', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })

    for (let at = 0; at < 240; at++) {
      await say(made, state, one.socket, one.draws(penStroke(`s${at}`, 4)))
    }

    const kept = [...state.kept.keys()]
    expect(kept.filter((key) => key.startsWith('state:')).length).toBeGreaterThan(0)
    expect(kept.filter((key) => key.startsWith('log:')).length).toBeLessThan(240)
    // And nothing was lost to the folding.
    expect(one.canvas.ink).toHaveLength(241)
  })

  test('reads itself back after the runtime has put it to sleep', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.draws(penStroke('slept-on', 20)))
    await made.alarm()

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await onPlane(woken, state, { id: noteId, spaceId })

    expect(back.canvas.ink.map((stroke) => stroke.id)).toEqual(['first', 'slept-on'])
    // And it knows it is a plane rather than a note, which is what it kept.
    expect(back.canvas.nodes[0]?.id).toBe('card')
  })

  test('a card deleted here stays deleted there', async () => {
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: noteId, spaceId })
    const two = await onPlane(made, state, { id: noteId, spaceId })

    const before = one.canvas
    const without = { ...before, nodes: [] }
    const sent = (() => {
      const mark = Y.encodeStateVector(one.doc)
      one.doc.transact(() => pushPlane(one.doc, before, stamped(before, without, 7000)))
      return syncUpdate(Y.encodeStateAsUpdate(one.doc, mark))
    })()

    await say(made, state, one.socket, sent)
    await drain(made, state, [one, two])

    expect(two.canvas.nodes).toEqual([])
    expect(two.canvas.gone.card).toBe(7000)

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(readCanvas(read.json.content).gone.card).toBe(7000)
  })
})
