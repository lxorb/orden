import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import { awarenessUpdate, receive, syncStep1, syncUpdate, TEXT } from '@nib/rooms'
import * as Y from 'yjs'
import { NoteRoom } from '../src/rooms/room'
import { call, type Reply, signIn, type TestEnv, testEnv } from './harness'
import { FakeSocket, type FakeState, join, room, say } from './room'

/** A device in a room, the way the app's client is one: its own document, its own
 *  awareness, and the same protocol run over whatever the room says. */
class Device {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly text = this.doc.getText(TEXT)

  constructor(readonly socket: FakeSocket) {}

  get words(): string {
    return this.text.toString()
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

    // A second room over the same storage is what waking up looks like: every
    // field is gone, and what matters came back out of the object.
    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(woken, state, { id: noteId, spaceId })

    expect(back.words).toBe('# Together\nslept on it\n')
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

describe('the door to a room', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  test('turns away a socket with no session', async () => {
    const answer = await call<Reply>(env, '/rooms/whatever', {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': 'nib.token.not-a-token' },
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

    const answer = await call<Reply>(env, `/rooms/${note.json.note.id}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': `nib.token.${mine}` },
    })

    expect(answer.status).toBe(404)
  })

  test('is not a page to be read', async () => {
    const token = await signIn(env, 'reader@example.com')
    const answer = await call<Reply>(env, '/rooms/whatever', {
      headers: { 'sec-websocket-protocol': `nib.token.${token}` },
    })

    expect(answer.status).toBe(426)
  })
})
