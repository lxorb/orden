import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { type Canvas, type InkStroke, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { stamped } from '@orden/markdown/canvas-merge'
import { awarenessUpdate, receive, subprotocol, syncStep1, syncUpdate, TEXT } from '@orden/rooms'
import { pushPlane, readPlane } from '@orden/rooms/plane'
import * as Y from 'yjs'
import { sha256 } from '../src/crypto'
import { BEAT, BEAT_ANSWER, NOW_READS } from '@orden/sync-core'
import { roomsRevoked } from '../src/rooms'
import { MOST_DOCUMENT_BYTES, TOO_LARGE_IN_A_ROOM } from '../src/rooms/state'
import { writesOf } from '../src/rooms/kind'
import { NoteRoom } from '../src/rooms/room'
import { call, signIn, type ShareView, type TestEnv, testEnv } from './harness'
import { doorway, FakeSocket, type FakeState, join, room, running, say } from './room'

const OPENING = '# Together\n'

class Device {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)
  readonly text = this.doc.getText(TEXT)

  constructor(readonly socket: FakeSocket) {}

  get words(): string {
    return this.text.toJSON()
  }

  type(at: number, words: string): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    this.text.insert(at, words)
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }

  erase(at: number, length: number): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    this.text.delete(at, length)
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }
}

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

  test('answers a device’s beat by itself, so a quiet connection can be told from a dead one', () => {
    const { state } = room(env)

    expect(state.autoResponse).toEqual({ request: BEAT, response: BEAT_ANSWER })
  })

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

  describe('a note something wrote without going through the room', () => {
    async function overwritten() {
      const { room: made, state } = room(env)
      const inside = await arrive(made, state, { id: noteId, spaceId })

      await say(made, state, inside.socket, inside.type(11, 'from the room\n'))
      await made.alarm()

      const held = await call(env, `/v1/notes/${noteId}`, { token })
      expect(held.json.note.version).toBe(2)

      const pushed = await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: {
          path: 'together.md',
          content: '# Together\nfrom the other device\n',
          baseVersion: 2,
        },
      })
      expect(pushed.status).toBe(200)
      expect(pushed.json.note.version).toBe(3)

      await say(made, state, inside.socket, inside.type(inside.words.length, 'and more\n'))
      await made.alarm()

      return { made, state, inside }
    }

    test('is kept beside the note when the room settles over it', async () => {
      await overwritten()

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      const notes = (page.json.notes as { id: string; path: string }[]).filter(
        (one) => one.path !== 'together.md',
      )

      expect(notes).toHaveLength(1)
      expect(notes[0]?.path).toMatch(/^together \(from another device \d{4}-\d\d-\d\d\)\.md$/)

      const beside = await call(env, `/v1/notes/${notes[0]?.id}`, { token })
      expect(beside.json.content).toBe('# Together\nfrom the other device\n')
    })

    test('and the room&apos;s own words are what the note ends up holding', async () => {
      await overwritten()

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\nfrom the room\nand more\n')
    })

    test('is copied once however many times the same words are offered again', async () => {
      const { made, state, inside } = await overwritten()

      for (const line of ['once more\n', 'and again\n']) {
        await call(env, `/v1/notes/${noteId}`, {
          token,
          method: 'PUT',
          body: {
            path: 'together.md',
            content: '# Together\nfrom the other device\n',
            baseVersion: (await call(env, `/v1/notes/${noteId}`, { token })).json.note.version,
          },
        })

        await say(made, state, inside.socket, inside.type(inside.words.length, line))
        await made.alarm()
      }

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      const notes = (page.json.notes as { path: string; deleted?: boolean }[]).filter(
        (one) => !one.deleted && one.path !== 'together.md',
      )

      expect(notes).toHaveLength(1)
    })

    test('settles as it always did when nothing else has written the note', async () => {
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id: noteId, spaceId })

      await say(made, state, one.socket, one.type(11, 'one\n'))
      await made.alarm()
      await say(made, state, one.socket, one.type(one.words.length, 'two\n'))
      await made.alarm()

      const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
      expect(page.json.notes).toHaveLength(1)

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\none\ntwo\n')
      expect(read.json.note.version).toBe(3)
    })
  })

  describe('a note written with Windows line endings', () => {
    async function crlfNote(content = '# Lines\r\none\r\ntwo\r\n'): Promise<string> {
      const made = await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path: 'lines.md', content },
      })
      return made.json.note.id
    }

    test('is held with the line endings an editor counts, so a change lands where it was typed', async () => {
      const id = await crlfNote()
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id, spaceId })
      const two = await arrive(made, state, { id, spaceId })

      expect(one.words).toBe('# Lines\none\ntwo\n')

      await say(made, state, one.socket, one.type(one.words.indexOf('two'), 'between\n'))
      await settle(made, state, [one, two])

      expect(two.words).toBe('# Lines\none\nbetween\ntwo\n')
    })

    test('is written back with the line endings it had', async () => {
      const id = await crlfNote()
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id, spaceId })

      await made.alarm()
      expect((await call(env, `/v1/notes/${id}`, { token })).json.note.version).toBe(1)

      await say(made, state, one.socket, one.type(one.words.length, 'three\n'))
      await made.alarm()

      const read = await call(env, `/v1/notes/${id}`, { token })
      expect(read.json.content).toBe('# Lines\r\none\r\ntwo\r\nthree\r\n')
    })

    test('takes in a change pushed while it slept without a stray carriage return', async () => {
      const id = await crlfNote()
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id, spaceId })
      state.drop(one.socket)
      await made.webSocketClose(one.socket as unknown as WebSocket)

      const pushed = await call(env, `/v1/notes/${id}`, {
        token,
        method: 'PUT',
        body: { path: 'lines.md', content: '# Lines\r\none\r\npushed\r\ntwo\r\n', baseVersion: 1 },
      })
      expect(pushed.status).toBe(200)

      const woken = new NoteRoom(state as unknown as DurableObjectState, env)
      const back = await arrive(woken, state, { id, spaceId })

      expect(back.words).toBe('# Lines\none\npushed\ntwo\n')
    })

    test('held with its carriage returns from before is evened out once nobody is in it', async () => {
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id: noteId, spaceId })
      await say(made, state, one.socket, one.type(11, 'old\r\nroom\r\n'))
      await made.alarm()

      const kept = (await state.storage.get('note')) as Record<string, unknown>
      delete kept.lines
      await state.storage.put('note', kept)

      const raw = new NoteRoom(state as unknown as DurableObjectState, env)
      const during = await arrive(raw, state, { id: noteId, spaceId })
      expect(during.words).toBe('# Together\nold\r\nroom\r\n')

      for (const gone of [one, during]) {
        state.drop(gone.socket)
        await raw.webSocketClose(gone.socket as unknown as WebSocket)
      }

      const woken = new NoteRoom(state as unknown as DurableObjectState, env)
      const back = await arrive(woken, state, { id: noteId, spaceId })
      expect(back.words).toBe('# Together\nold\nroom\n')
    })
  })

  async function held(): Promise<string[]> {
    const page = await call(env, `/v1/spaces/${spaceId}/changes?since=0`, { token })
    return (page.json.notes as { path: string; deleted?: boolean }[])
      .filter((one) => !one.deleted)
      .map((one) => one.path)
      .sort()
  }

  describe('a note pushed as a file while its room held it', () => {
    test('is not copied when the settle would drop none of it', async () => {
      const { room: made, state } = room(env)
      const inside = await arrive(made, state, { id: noteId, spaceId })

      await say(made, state, inside.socket, inside.type(11, 'one\n'))

      const pushed = await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: { path: 'together.md', content: '# Together\none\n', baseVersion: 1 },
      })
      expect(pushed.json.note.version).toBe(2)

      await say(made, state, inside.socket, inside.type(inside.words.length, 'two\n'))
      await made.alarm()

      expect(await held()).toEqual(['together.md'])

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\none\ntwo\n')
    })

    test.fails('is copied when the settle takes back words the push had in it', async () => {
      const { room: made, state } = room(env)
      const inside = await arrive(made, state, { id: noteId, spaceId })

      await say(made, state, inside.socket, inside.type(11, 'one\ntwo\n'))

      await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: { path: 'together.md', content: '# Together\none\ntwo\n', baseVersion: 1 },
      })

      await say(made, state, inside.socket, inside.erase(15, 4))
      await made.alarm()

      expect(await held()).toEqual(['together.md'])
    })

    test('stands as it is when the room has nothing of its own to say', async () => {
      const { room: made, state } = room(env)
      const inside = await arrive(made, state, { id: noteId, spaceId })

      await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: {
          path: 'together.md',
          content: '# Together\ntyped while the room was joining\n',
          baseVersion: 1,
        },
      })

      await made.webSocketClose(inside.socket as unknown as WebSocket)

      expect(await held()).toEqual(['together.md'])

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\ntyped while the room was joining\n')
    })
  })

  describe('a room that wakes up behind the note', () => {
    async function pushedWhileAsleep() {
      const { room: made, state } = room(env)
      const one = await arrive(made, state, { id: noteId, spaceId })
      await say(made, state, one.socket, one.type(11, 'from the room\n'))
      await made.alarm()

      await made.webSocketClose(one.socket as unknown as WebSocket)
      state.drop(one.socket)

      await call(env, `/v1/notes/${noteId}`, {
        token,
        method: 'PUT',
        body: {
          path: 'together.md',
          content: '# Together\nfrom the room\nand while it slept\n',
          baseVersion: 2,
        },
      })

      const woken = new NoteRoom(state as unknown as DurableObjectState, env)
      return { woken, state }
    }

    test('opens on the note as the store now holds it', async () => {
      const { woken, state } = await pushedWhileAsleep()
      const back = await arrive(woken, state, { id: noteId, spaceId })

      expect(back.words).toBe('# Together\nfrom the room\nand while it slept\n')
    })

    test('and what is typed next is written on top of it, with no copy beside', async () => {
      const { woken, state } = await pushedWhileAsleep()
      const back = await arrive(woken, state, { id: noteId, spaceId })

      await say(woken, state, back.socket, back.type(back.words.length, 'and more\n'))
      await woken.alarm()

      expect(await held()).toEqual(['together.md'])

      const read = await call(env, `/v1/notes/${noteId}`, { token })
      expect(read.json.content).toBe('# Together\nfrom the room\nand while it slept\nand more\n')
    })
  })

  test('writes the words into the note store when the typing stops', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(11, 'settled\n'))
    expect(state.takeAlarm()).not.toBeNull()

    await made.alarm()

    const read = await call(env, `/v1/notes/${noteId}`, { token })
    expect(read.json.content).toBe('# Together\nsettled\n')
    expect(read.json.note.version).toBe(2)
  })

  function versionsOf(id: string): { by: string }[] {
    return env.db
      .prepare('select by from note_versions where note_id = ? order by at desc')
      .all(id) as { by: string }[]
  }

  function longAgo() {
    env.db.exec('update note_versions set at = at - 600000')
  }

  test('says which device was typing when it settled', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    one.awareness.setLocalStateField('who', { name: 'Ada’s Mac', accent: 'violet' })
    await say(made, state, one.socket, awarenessUpdate(one.awareness, [one.doc.clientID]))
    await say(made, state, one.socket, one.type(11, 'typed here\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('Ada’s Mac')
  })

  test('and names the one of them who was typing, not the room', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    const two = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    for (const [device, who] of [
      ['Ada’s Mac', one],
      ['Bella’s phone', two],
    ] as const) {
      who.awareness.setLocalStateField('who', { name: device, accent: 'violet' })
      await say(made, state, who.socket, awarenessUpdate(who.awareness, [who.doc.clientID]))
    }
    await settle(made, state, [one, two])

    await say(made, state, two.socket, two.type(11, 'from the phone\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('Bella’s phone')
  })

  test('and names nobody when nothing in the room said what it was', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    longAgo()
    await say(made, state, one.socket, one.type(11, 'from nowhere\n'))
    await made.alarm()

    const kept = versionsOf(noteId)
    expect(kept[0]?.by).toBe('')
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
    await made.alarm()

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(woken, state, { id: noteId, spaceId })

    expect(back.words).toBe('# Together\nslept on it\n')
  })

  test('asks the devices that were here for what it slept through', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(11, 'never written down\n'))
    one.socket.take()

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

  test('cannot speak for somebody else’s caret, only for its own', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const other = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    env.db.exec('update note_versions set at = at - 600000')
    writer.awareness.setLocalStateField('who', { name: 'Ada Mac' })
    await say(made, state, writer.socket, awarenessUpdate(writer.awareness, [writer.doc.clientID]))

    const posing = new Y.Doc()
    posing.clientID = writer.doc.clientID
    const forged = new Awareness(posing)
    for (let one = 0; one < 5; one++) forged.setLocalStateField('who', { name: `Mallory ${one}` })
    reader.awareness.setLocalStateField('who', { name: 'Reader' })
    applyAwarenessUpdate(reader.awareness, encodeAwarenessUpdate(forged, [forged.clientID]), 'me')
    const both = [writer.doc.clientID, reader.doc.clientID]
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, both))
    await settle(made, state, [writer, other, reader])

    expect(other.awareness.getStates().get(writer.doc.clientID)).toEqual({
      who: { name: 'Ada Mac' },
    })
    expect(other.awareness.getStates().get(reader.doc.clientID)).toEqual({
      who: { name: 'Reader' },
    })

    await say(made, state, writer.socket, writer.type(11, 'typed here\n'))
    await made.alarm()
    const kept = env.db
      .prepare('select by from note_versions where note_id = ? order by at desc')
      .all(noteId) as { by: string }[]
    expect(kept[0]?.by).toBe('Ada Mac')
  })

  test('cannot make the room remember an unbounded list of carets', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    const crowd = new Awareness(new Y.Doc())
    crowd.setLocalState(null)
    for (let one = 0; one < 400; one++) {
      const each = new Awareness(new Y.Doc())
      each.setLocalStateField('who', { name: `n${one}` })
      applyAwarenessUpdate(crowd, encodeAwarenessUpdate(each, [each.doc.clientID]), 'crowd')
    }

    const named = [...crowd.getStates().keys()]
    expect(named.length).toBeGreaterThan(300)
    await say(made, state, reader.socket, awarenessUpdate(crowd, named))
    await settle(made, state, [writer, reader])

    const kept = reader.socket.deserializeAttachment() as { clients: number[]; mayWrite: boolean }
    expect(kept.clients.length).toBeLessThanOrEqual(32)
    expect(JSON.stringify(kept).length).toBeLessThan(2048)
    expect(kept.mayWrite).toBe(false)
  })

  test('forgets a caret its socket stopped announcing', async () => {
    const { room: made, state } = room(env)
    const writer = await arrive(made, state, { id: noteId, spaceId })
    const reader = await reading(made, state)

    reader.awareness.setLocalStateField('who', { name: 'Ada' })
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])
    expect((reader.socket.deserializeAttachment() as { clients: number[] }).clients).toContain(
      reader.doc.clientID,
    )

    reader.awareness.setLocalState(null)
    await say(made, state, reader.socket, awarenessUpdate(reader.awareness, [reader.doc.clientID]))
    await settle(made, state, [writer, reader])

    expect((reader.socket.deserializeAttachment() as { clients: number[] }).clients).toEqual([])
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
      expect(door.asked.at(-1)?.get('x-orden-write'), who).toBe(writes)
      expect(door.asked.at(-1)?.get('x-orden-space'), who).toBe(spaceId)
    }

    const outside = await signIn(env, 'nobody@example.com')
    const refused = await call(env, `/rooms/${noteId}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(outside) },
    })
    expect(refused.status).toBe(404)
  })

  test('tells the room the device the session proves, the way a tree op names it (#413)', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const token = await signIn(env, 'owner@example.com')
    const space = await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })
    const spaceId = space.json.space.id
    const note = await call(env, `/v1/spaces/${spaceId}/notes`, {
      token,
      body: { path: 'mine.md', content: 'mine' },
    })
    const noteId = note.json.note.id
    const told = async (device: string) => {
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': `${subprotocol(token)}, nib.device.${device}`,
        },
      })
      expect(answer.status).toBe(200)
      return door.asked.at(-1)?.get('x-orden-device-id')
    }

    const hash = await sha256(token)
    expect(await told('laptop')).toBe(`session:${hash.slice(0, 16)}`)

    const session = env.db
      .prepare('select id, user_id from sessions where token_hash = ?')
      .get(hash) as {
      id: string
      user_id: string
    }
    env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, created_at)
         values ('laptop', ?, ?, 'Laptop', 'web', 1)`,
      )
      .run(session.user_id, session.id)
    expect(await told('laptop')).toBe('laptop')
    expect(await told('somebody-else')).toBe('laptop')
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
      expect(door.asked.at(-1)?.get('x-orden-write'), role).toBe(writes)
      expect(door.asked.at(-1)?.get('x-orden-space'), role).toBe(spaceId)
    }

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
    expect(door.asked.at(-1)?.get('x-orden-kind')).toBe('plane')
    expect(door.asked.at(-1)?.get('x-orden-write')).toBe('yes')

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

  test('only the word yes says a socket may write', () => {
    expect(writesOf('yes')).toBe(true)

    for (const said of ['no', null, undefined, '', 'YES', 'true', 'maybe', 1, {}]) {
      expect(writesOf(said), JSON.stringify(said ?? null)).toBe(false)
    }
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

      expect(door.asked.at(-1)?.get('x-orden-kind'), path).toBe(kind)
    }
  })

  test('lets somebody who holds both the space and the file in at the stronger', async () => {
    for (const [space, item, writes] of [
      ['read', 'write', 'yes'],
      ['write', 'read', 'yes'],
      ['read', 'read', 'no'],
    ] as const) {
      const door = doorway()
      env.close()
      env = testEnv({ ROOMS: door.ROOMS })

      const owner = await signIn(env, 'owner@example.com')
      const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } }))
        .json.space.id
      const noteId = (
        await call(env, `/v1/spaces/${spaceId}/notes`, {
          token: owner,
          body: { path: 'both.md', content: 'together' },
        })
      ).json.note.id

      const email = 'both@example.com'
      await call(env, `/v1/spaces/${spaceId}/share/invite`, {
        token: owner,
        body: { email, role: space },
      })
      await call(env, `/v1/spaces/${spaceId}/share/invite?item=${noteId}`, {
        token: owner,
        body: { email, role: item },
      })

      expect(
        env.db.prepare('select count(*) as held from space_members where email = ?').get(email),
      ).toEqual({ held: 2 })

      const said = `${space} of the space, ${item} of the file`
      const answer = await call(env, `/rooms/${noteId}`, {
        headers: {
          upgrade: 'websocket',
          'sec-websocket-protocol': subprotocol(await signIn(env, email)),
        },
      })

      expect(answer.status, said).toBe(200)
      expect(door.asked, said).toHaveLength(1)
      expect(door.asked[0]?.get('x-orden-space'), said).toBe(spaceId)
      expect(door.asked[0]?.get('x-orden-write'), said).toBe(writes)
    }
  })

  test('asks the same three things however many shares somebody has', async () => {
    const door = doorway()
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const owner = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Notes' } })).json
      .space.id

    const notes: string[] = []
    for (let made = 0; made < 8; made++) {
      notes.push(
        (
          await call(env, `/v1/spaces/${spaceId}/notes`, {
            token: owner,
            body: { path: `note-${made}.md`, content: 'x' },
          })
        ).json.note.id,
      )
    }

    const email = 'many@example.com'
    for (const noteId of notes) {
      await call(env, `/v1/spaces/${spaceId}/share/invite?item=${noteId}`, {
        token: owner,
        body: { email, role: 'write' },
      })
    }

    const token = await signIn(env, email)
    const answer = await call(env, `/rooms/${notes[0] ?? ''}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })

    expect(answer.status).toBe(200)
    expect(door.asked[0]?.get('x-orden-write')).toBe('yes')
    expect(env.widest().count).toBeLessThan(20)
  })
})

class Plane {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  constructor(readonly socket: FakeSocket) {}

  get canvas(): Canvas {
    return readPlane(this.doc)
  }

  draws(...strokes: InkStroke[]): Uint8Array {
    const before = Y.encodeStateVector(this.doc)
    const was = this.canvas
    const now = { ...was, ink: [...was.ink, ...strokes] }
    this.doc.transact(() => pushPlane(this.doc, was, stamped(was, now, 5000)))
    return syncUpdate(Y.encodeStateAsUpdate(this.doc, before))
  }

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

describe('somebody who stops being in the space while the file is open', () => {
  const WRITER = 'writer@example.com'

  let env: TestEnv
  let live: ReturnType<typeof running>
  let owner: string
  let writer: string
  let writerId: string
  let spaceId: string
  let noteId: string

  beforeEach(async () => {
    env = testEnv()
    live = running(env)
    env.ROOMS = live.ROOMS

    owner = await signIn(env, 'owner@example.com')
    spaceId = (await call(env, '/v1/spaces', { token: owner, body: { name: 'Plans' } })).json.space
      .id
    noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'together.md', content: OPENING },
      })
    ).json.note.id

    await call(env, `/v1/spaces/${spaceId}/share/invite`, {
      token: owner,
      body: { email: WRITER, role: 'write' },
    })
    writer = await signIn(env, WRITER)
    writerId = (await call(env, '/v1/me', { token: writer })).json.user.id
  })

  afterEach(() => env.close())

  async function open(who: string, writes = true): Promise<FakeSocket> {
    const { room: made } = live.of(noteId)
    return await join(made, { id: noteId, spaceId, who }, writes)
  }

  test('is written down as having it open, and not once they have closed it', async () => {
    const socket = await open(writerId)

    const held = env.db
      .prepare('select space_id, who from room_sockets where note_id = ?')
      .all(noteId)
    expect(held).toEqual([{ space_id: spaceId, who: writerId }])

    const { room: made } = live.of(noteId)
    await made.webSocketClose(socket as unknown as WebSocket)

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  async function aDayLater(work: () => Promise<void>): Promise<void> {
    const later = Date.now() + 25 * 60 * 60 * 1000
    const real = Date.now
    Date.now = () => later
    try {
      await work()
    } finally {
      Date.now = real
    }
  }

  async function ownerOpensAnother(): Promise<void> {
    const ownerId = (await call(env, '/v1/me', { token: owner })).json.user.id
    const other = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token: owner,
        body: { path: 'other.md', content: 'x' },
      })
    ).json.note.id
    await join(live.of(other).room, { id: other, spaceId, who: ownerId }, true)
  }

  test('has a socket open for more than a day closed when the owner takes them out', async () => {
    const socket = await open(writerId)
    await aDayLater(async () => {
      await ownerOpensAnother()
      await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
        method: 'DELETE',
        token: owner,
      })
    })
    expect(socket.closed).toBe(true)
  })

  test('has a socket open for more than a day made a reader', async () => {
    const socket = await open(writerId)
    await aDayLater(async () => {
      await ownerOpensAnother()
      await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
        method: 'PATCH',
        token: owner,
        body: { role: 'read' },
      })
    })
    expect(socket.closedWith?.code).toBe(NOW_READS)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(false)
  })

  test('has a row a day old cleared once its room has nobody of theirs in it', async () => {
    env.db
      .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, 1)')
      .run('gone-note', spaceId, writerId)
    await aDayLater(async () => {
      await ownerOpensAnother()
      for (const { state } of live.all().values()) await state.idle()
    })
    const rows = env.db.prepare('select note_id from room_sockets order by note_id').all()
    expect(rows).not.toContainEqual({ note_id: 'gone-note' })
    expect(rows).toHaveLength(1)
  })

  test('can join while clearing day-old rows fails', async () => {
    env.db
      .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, 1)')
      .run('gone-note', spaceId, writerId)
    const prepare = env.DB.prepare.bind(env.DB)
    env.DB.prepare = (sql: string) => {
      if (sql.includes('where opened_at <')) throw new Error('D1 is away')
      return prepare(sql)
    }
    try {
      const socket = await open(writerId)
      await live.of(noteId).state.idle()
      expect(socket.closed).toBe(false)
      expect(env.db.prepare('select who from room_sockets where note_id = ?').all(noteId)).toEqual([
        { who: writerId },
      ])
    } finally {
      env.DB.prepare = prepare
    }
  })

  test('keeps the row when another device of theirs closes while this one joins', async () => {
    const laptop = await open(writerId)
    const { room: made, state } = live.of(noteId)
    const prepare = env.DB.prepare.bind(env.DB)
    let pending = true
    env.DB.prepare = (sql: string) => {
      const statement = prepare(sql)
      if (!pending || !sql.trimStart().startsWith('insert into room_sockets')) return statement
      pending = false
      const bind = statement.bind.bind(statement)
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values)
        const run = bound.run.bind(bound)
        bound.run = (async () => {
          const done = await run()
          await made.webSocketClose(laptop as unknown as WebSocket)
          state.drop(laptop)
          return done
        }) as typeof bound.run
        return bound
      }
      return statement
    }
    const phone = await open(writerId)
    env.DB.prepare = prepare
    expect(phone.closed).toBe(false)
    expect(env.db.prepare('select who from room_sockets where note_id = ?').all(noteId)).toEqual([
      { who: writerId },
    ])
  })

  async function signedIn(token: string, who: string): Promise<FakeSocket> {
    const socket = new FakeSocket()
    await live
      .of(noteId)
      .room.enter(
        socket as unknown as WebSocket,
        { noteId, spaceId, kind: 'words' },
        { writes: true, who, login: await sha256(token) },
      )
    return socket
  }

  async function aMinuteLater(work: () => Promise<void>): Promise<void> {
    const later = Date.now() + 61_000
    const real = Date.now
    Date.now = () => later
    try {
      await work()
    } finally {
      Date.now = real
    }
  }

  async function typeInto(socket: FakeSocket): Promise<void> {
    const doc = new Y.Doc()
    const mark = Y.encodeStateVector(doc)
    doc.getText(TEXT).insert(0, 'more ')
    const { room: made, state } = live.of(noteId)
    await say(made, state, socket, syncUpdate(Y.encodeStateAsUpdate(doc, mark)))
  }

  test('has the socket closed within a minute where no revocation reached it', async () => {
    const socket = await signedIn(writer, writerId)
    env.db
      .prepare('delete from space_members where space_id = ? and email = ?')
      .run(spaceId, WRITER)
    await aMinuteLater(() => typeInto(socket))
    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
  })

  test('has the socket made a reader within a minute where no revocation reached it', async () => {
    const socket = await signedIn(writer, writerId)
    env.db
      .prepare("update space_members set role = 'read' where space_id = ? and email = ?")
      .run(spaceId, WRITER)
    await aMinuteLater(async () => {
      await typeInto(socket)
      await live.of(noteId).room.alarm()
    })
    expect(socket.closedWith?.code).toBe(NOW_READS)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(false)
    const read = await call(env, `/v1/notes/${noteId}`, { token: owner })
    expect(read.json.content).toBe(OPENING)
  })

  test('has the socket closed when they are taken out during its handshake', async () => {
    env.justBefore(/insert into room_sockets/, () => {
      env.db
        .prepare('delete from space_members where space_id = ? and email = ?')
        .run(spaceId, WRITER)
    })

    const socket = await signedIn(writer, writerId)

    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
    expect(socket.take()).toEqual([])
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  test('has the socket made a reader when the role drops during its handshake', async () => {
    env.justBefore(/insert into room_sockets/, () => {
      env.db
        .prepare("update space_members set role = 'read' where space_id = ? and email = ?")
        .run(spaceId, WRITER)
    })

    const socket = await signedIn(writer, writerId)

    expect(socket.closedWith?.code).toBe(NOW_READS)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(false)
  })

  test('lets a reader who joins as one stay, with nothing to be told', async () => {
    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'read' },
    })

    const socket = new FakeSocket()
    await live
      .of(noteId)
      .room.enter(
        socket as unknown as WebSocket,
        { noteId, spaceId, kind: 'words' },
        { writes: false, who: writerId, login: await sha256(writer) },
      )

    expect(socket.closed).toBe(false)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(false)
  })

  test('keeps the socket of somebody taken out of the space who still holds the file itself', async () => {
    await call(env, `/v1/spaces/${spaceId}/share/invite?item=${noteId}`, {
      token: owner,
      body: { email: WRITER, role: 'write' },
    })
    const socket = await signedIn(writer, writerId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(false)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(true)
  })

  test('closes only the ended session’s socket, as signed out, when the others are ended', async () => {
    const ended = await signedIn(writer, writerId)
    const kept = await signIn(env, WRITER)
    const staying = await signedIn(kept, writerId)

    await call(env, '/v1/sessions', { method: 'DELETE', token: kept })

    expect(ended.closedWith?.code).toBe(4401)
    expect(staying.closed).toBe(false)
  })

  describe('a handshake the database never answers', () => {
    const LONGER_THAN_ANY_WAIT = 60 * 60 * 1000

    afterEach(() => {
      vi.useRealTimers()
    })

    async function hungAt(sql: RegExp, method: 'first' | 'run', skip = 0) {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const login = await sha256(writer)
      const socket = new FakeSocket()
      const { room: made } = live.of(noteId)

      let asked = false
      const wasAsked = () => asked
      const prepare = env.DB.prepare.bind(env.DB)
      let met = 0
      env.DB.prepare = (text: string) => {
        const statement = prepare(text)
        if (sql.test(text) && met++ >= skip) {
          ;(statement as unknown as Record<string, unknown>)[method] = () => {
            asked = true
            return new Promise(() => undefined)
          }
        }
        return statement
      }

      let entered = false
      void made
        .enter(
          socket as unknown as WebSocket,
          { noteId, spaceId, kind: 'words' },
          { writes: true, who: writerId, login },
        )
        .then(() => {
          entered = true
        })
      for (let turn = 0; turn < 1000 && !wasAsked(); turn++) {
        await new Promise((next) => setImmediate(next))
      }
      await new Promise((next) => setImmediate(next))
      await new Promise((next) => setImmediate(next))
      expect(wasAsked()).toBe(true)
      expect(socket.closed).toBe(false)

      await vi.advanceTimersByTimeAsync(LONGER_THAN_ANY_WAIT)
      return { socket, entered: () => entered, prepare }
    }

    test('at the access asked again', async () => {
      const { socket, entered, prepare } = await hungAt(
        /case when sp.user_id = me.user_id/,
        'first',
      )
      expect(socket.closedWith?.code).toBe(1011)
      expect(entered()).toBe(true)
      env.DB.prepare = prepare
      const read = await call(env, `/v1/notes/${noteId}`, { token: owner })
      expect(read.json.content).toBe(OPENING)
    })

    test('at the row written again', async () => {
      const { socket, entered } = await hungAt(/insert into room_sockets/, 'run', 1)
      expect(socket.closedWith?.code).toBe(1011)
      expect(entered()).toBe(true)
    })

    test('and a join that is answered leaves nothing on the clock', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const socket = await signedIn(writer, writerId)
      expect(socket.closed).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  test('is let in as the door said where the database cannot be asked again', async () => {
    env.justBefore(/case when sp.user_id = me.user_id/, () => {
      throw new Error('D1 is not answering')
    })

    const socket = await signedIn(writer, writerId)

    expect(socket.closed).toBe(false)
    expect((socket.deserializeAttachment() as { mayWrite: boolean }).mayWrite).toBe(true)
  })

  test('has the socket closed when the owner takes them out', async () => {
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  test('and the owner’s own socket in the same room is left alone', async () => {
    const ownerId = (await call(env, '/v1/me', { token: owner })).json.user.id
    const theirs = await open(ownerId)
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
    expect(theirs.closed).toBe(false)
  })

  test('tells the socket it only reads now, and takes nothing it still sends, when the role drops to reading', async () => {
    const socket = await open(writerId)
    const { room: made, state } = live.of(noteId)

    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'PATCH',
      token: owner,
      body: { role: 'read' },
    })

    expect(socket.closedWith?.code).toBe(NOW_READS)

    const device = new Device(socket)
    await say(made, state, socket, syncStep1(device.doc))
    await settle(made, state, [device])
    await say(made, state, socket, device.type(OPENING.length, 'a line'))

    await made.alarm()
    const read = await call(env, `/v1/notes/${noteId}`, { token: owner })
    expect(read.json.content).toBe(OPENING)
  })

  test('is a guest the same way, by the id the link handed out', async () => {
    const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''

    const arrived = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'Windows' },
    })
    const guestId = arrived.json.guest.id
    const socket = await open(guestId)

    await call(env, `/v1/spaces/${spaceId}/share/guests/${guestId}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(socket.closed).toBe(true)
  })

  test('is a guest signing out, whose socket closes with the session', async () => {
    const { json } = await call<ShareView>(env, `/v1/spaces/${spaceId}/share/link`, {
      method: 'PUT',
      token: owner,
      body: { role: 'write', mode: 'open' },
    })
    const link = /\/join\/([a-f0-9]+)/.exec(json.link?.url ?? '')?.[1] ?? ''
    const arrived = await call(env, `/v1/join/${link}`, {
      method: 'POST',
      body: { device: 'Windows' },
    })
    const socket = await open(arrived.json.guest.id)

    await call(env, '/v1/auth/signout', { method: 'POST', token: arrived.json.token })

    expect(socket.closed).toBe(true)
  })

  test('is a person letting themselves out, on their other devices', async () => {
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/me`, { method: 'DELETE', token: writer })

    expect(socket.closed).toBe(true)
  })

  async function typedThrough(socket: FakeSocket): Promise<string> {
    const { room: made, state } = live.of(noteId)
    const device = new Device(socket)
    await say(made, state, socket, syncStep1(device.doc))
    await settle(made, state, [device])
    await say(made, state, socket, device.type(OPENING.length, 'typed after'))
    await made.alarm()
    return (await env.NOTES.get(`spaces/${spaceId}/${noteId}`).then((one) => one?.text())) ?? ''
  }

  test('has every socket closed when the owner deletes the space, the owner’s too (#456)', async () => {
    const ownerId = (await call(env, '/v1/me', { token: owner })).json.user.id
    const theirs = await open(ownerId)
    const socket = await open(writerId)

    expect(
      (await call(env, `/v1/spaces/${spaceId}`, { method: 'DELETE', token: owner })).status,
    ).toBe(200)

    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
    expect(theirs.closed).toBe(true)
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })

  test('stops writing when invited again as a reader, as a role changed any other way', async () => {
    const socket = await open(writerId)

    await call(env, `/v1/spaces/${spaceId}/share/invite`, {
      token: owner,
      body: { email: WRITER, role: 'read' },
    })

    expect(socket.closedWith?.code).toBe(NOW_READS)
    expect(await typedThrough(socket)).not.toContain('typed after')
  })

  test('and when a request to read is let in over a membership to write', async () => {
    const socket = await open(writerId)
    env.db
      .prepare(
        "insert into space_requests (space_id, email, item, role, created_at) values (?, ?, '', 'read', 1)",
      )
      .run(spaceId, WRITER)

    await call(env, `/v1/spaces/${spaceId}/share/requests/${WRITER}`, {
      method: 'POST',
      token: owner,
    })

    expect(await typedThrough(socket)).not.toContain('typed after')
  })

  test('and a room nobody is in is told without being woken', async () => {
    await call(env, `/v1/spaces/${spaceId}/share/members/${WRITER}`, {
      method: 'DELETE',
      token: owner,
    })

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })
  })
})

describe('a room that is not answering', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => {
    env.close()
    vi.restoreAllMocks()
  })

  async function logged(work: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    await work()
    return lines
  }

  async function opening(door: ReturnType<typeof doorway>): Promise<[string, string]> {
    env.close()
    env = testEnv({ ROOMS: door.ROOMS })

    const token = await signIn(env, 'owner@example.com')
    const spaceId = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space
      .id
    const noteId = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path: 'open.md', content: OPENING },
      })
    ).json.note.id

    return [noteId, token]
  }

  function knock(noteId: string, token: string) {
    return call(env, `/rooms/${noteId}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })
  }

  test('is a wait rather than a bug, and says how long', async () => {
    const door = doorway(2)
    const [noteId, token] = await opening(door)

    let status = 0
    let said: unknown = null
    let wait: string | null = null
    const lines = await logged(async () => {
      const answer = await knock(noteId, token)
      status = answer.status
      said = answer.json.error
      wait = answer.headers.get('retry-after')
    })

    expect(status).toBe(503)
    expect(said).toBe('this room is not answering - try again')
    expect(wait).toBe('1')

    expect(lines).toHaveLength(1)
    const written = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(written.failed).toBe(`room ${noteId}`)
    expect(String(written.said)).toContain('code was updated')
  })

  test('is asked once more, because a deploy replaces the object it reset', async () => {
    const door = doorway(1)
    const [noteId, token] = await opening(door)

    let status = 0
    const lines = await logged(async () => {
      status = (await knock(noteId, token)).status
    })

    expect(status).toBe(200)
    expect(door.asked).toHaveLength(2)
    expect(lines).toEqual([])
  })

  test('is asked twice and no more', async () => {
    const door = doorway(5)
    const [noteId, token] = await opening(door)

    await logged(() => knock(noteId, token))

    expect(door.asked).toHaveLength(2)
  })
})

describe('a room that could not be opened', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  function refusing(): { NOTES: R2Bucket; well: () => void } {
    let failing = true
    const notes = {
      get: () =>
        failing
          ? Promise.reject(new Error('the note store is not answering'))
          : Promise.resolve({ text: () => Promise.resolve(OPENING) }),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    }

    return {
      NOTES: notes as unknown as R2Bucket,
      well: () => {
        failing = false
      },
    }
  }

  test('opens on the next join once the store is answering again', async () => {
    const store = refusing()
    env.close()
    env = testEnv({ NOTES: store.NOTES })
    const { room: made } = room(env)

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow(
      'not answering',
    )

    store.well()
    const socket = await join(made, { id: 'n1', spaceId: 's1', who: 'u1' })

    expect(socket.sent.length).toBeGreaterThan(0)
  })

  test('settles nothing while it has never held the file', async () => {
    const store = refusing()
    env.close()
    env = testEnv({ NOTES: store.NOTES })
    const { room: made, state } = room(env)

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow()

    await expect(made.alarm()).rejects.toThrow()
    expect(env.keys()).toEqual([])
    expect(state.getWebSockets()).toEqual([])
  })

  test('takes no socket when the row saying who has it open cannot be written', async () => {
    const { room: made, state } = room(env)
    env.db.exec('drop table room_sockets')

    await expect(join(made, { id: 'n1', spaceId: 's1', who: 'u1' })).rejects.toThrow('room_sockets')

    expect(state.getWebSockets()).toEqual([])
  })

  test('is one row and not a conflict when the same person joins again', async () => {
    const { room: made } = room(env)

    for (const again of [1, 2, 3]) {
      const socket = await join(made, { id: 'n1', spaceId: 's1', who: 'u1' })
      expect(socket.sent.length, String(again)).toBeGreaterThan(0)
    }

    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 1 })
  })
})

describe('a file that changed which kind of room it is', () => {
  let env: TestEnv
  let token: string
  let spaceId: string

  const DRAWN: Canvas = {
    nodes: [{ id: 'card', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a card' }],
    edges: [],
    ink: [penStroke('first', 5)],
    at: { card: 1000, first: 1000 },
    gone: {},
  }

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'renamer@example.com')
    spaceId = (await call(env, '/v1/spaces', { token, body: { name: 'Notes' } })).json.space.id
  })

  afterEach(() => {
    env.close()
    vi.restoreAllMocks()
  })

  async function logged(work: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line))
    })

    await work()
    return lines
  }

  async function fileAt(path: string, content: string): Promise<string> {
    const made = await call(env, `/v1/spaces/${spaceId}/notes`, { token, body: { path, content } })
    return made.json.note.id
  }

  async function renameTo(noteId: string, path: string): Promise<void> {
    const read = await call(env, `/v1/notes/${noteId}`, { token })
    const done = await call(env, `/v1/notes/${noteId}`, {
      method: 'PUT',
      token,
      body: { path, content: read.json.content, baseVersion: read.json.note.version },
    })

    expect(done.status).toBe(200)
  }

  function contentOf(noteId: string): Promise<string> {
    return call(env, `/v1/notes/${noteId}`, { token }).then((read) => read.json.content)
  }

  test('does not write nothing over a canvas whose file became a note', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    const one = await onPlane(made, state, { id: boardId, spaceId })
    await say(made, state, one.socket, one.draws(penStroke('kept', 8, '2')))
    await made.alarm()

    await renameTo(boardId, 'Board.md')

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await logged(async () => {
      await join(woken, { id: boardId, spaceId, kind: 'words' }).catch(() => undefined)
      await woken.alarm().catch(() => undefined)
    })

    const after = await contentOf(boardId)
    expect(after).not.toBe('')
    expect(readCanvas(after).ink).toHaveLength(2)
    expect(readCanvas(after).nodes).toHaveLength(1)
  })

  test('does not write a canvas over the words of a note whose file became one', async () => {
    const noteId = await fileAt('plan.md', '# Plan\nwritten down\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(7, 'and kept\n'))
    await made.alarm()

    await renameTo(noteId, 'plan.canvas')

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    await logged(async () => {
      await join(woken, { id: noteId, spaceId, kind: 'plane' }).catch(() => undefined)
      await woken.alarm().catch(() => undefined)
    })

    expect(await contentOf(noteId)).toBe('# Plan\nand kept\nwritten down\n')
  })

  test('starts the room again as the kind the file is now', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    const drawing = await onPlane(made, state, { id: boardId, spaceId })
    await made.alarm()

    await renameTo(boardId, 'Board.md')

    await expect(join(made, { id: boardId, spaceId, kind: 'words' })).rejects.toThrow()

    expect(drawing.socket.closed).toBe(true)
    expect(drawing.socket.closedWith?.code).toBe(1012)
    expect(state.kept.size).toBe(0)
    expect(env.db.prepare('select count(*) as held from room_sockets').get()).toEqual({ held: 0 })

    const again = new NoteRoom(state as unknown as DurableObjectState, env)
    const back = await arrive(again, state, { id: boardId, spaceId })
    expect(readCanvas(back.words).nodes).toHaveLength(1)
  })

  test('refuses a settle the file itself disagrees with, and says so', async () => {
    const noteId = await fileAt('plan.md', '# Plan\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })
    await say(made, state, one.socket, one.type(7, 'typed on\n'))

    await renameTo(noteId, 'plan.canvas')
    const lines = await logged(() => made.alarm())

    expect(await contentOf(noteId)).toBe('# Plan\n')
    expect(lines).toHaveLength(1)
    const written = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(written.failed).toBe(`room ${noteId}`)
    expect(String(written.said)).toContain('plane')
  })

  test('never writes nothing over a file that has something in it', async () => {
    const boardId = await fileAt('Board.canvas', writeCanvas(DRAWN))
    const { room: made, state } = room(env)
    await onPlane(made, state, { id: boardId, spaceId })
    await made.alarm()

    await renameTo(boardId, 'Board.md')
    state.kept.set('note', { noteId: boardId, spaceId, kind: 'words' })

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const lines = await logged(() => woken.alarm())

    expect(await contentOf(boardId)).toBe(writeCanvas(DRAWN))
    expect(lines).toHaveLength(1)
    const said = String((JSON.parse(lines[0] ?? '{}') as { said?: unknown }).said)
    expect(said).toContain('holds a plane')
  })

  test('leaves the words alone when a canvas is drawn into a note’s room', async () => {
    const noteId = await fileAt('plan.md', '# Plan\nwritten down\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    const before = Y.encodeStateVector(one.doc)
    one.doc.transact(() => {
      pushPlane(one.doc, readPlane(one.doc), stamped(readPlane(one.doc), DRAWN, 7000))
    })
    await say(made, state, one.socket, syncUpdate(Y.encodeStateAsUpdate(one.doc, before)))

    const lines = await logged(() => made.alarm())

    expect(await contentOf(noteId)).toBe('# Plan\nwritten down\n')
    expect(lines).toHaveLength(1)
  })

  test('does not empty a file because the room’s own snapshot came back quiet', async () => {
    const noteId = await fileAt('kept.md', '# Kept\nevery word\n')
    const { room: made, state } = room(env)
    await arrive(made, state, { id: noteId, spaceId })
    await made.alarm()

    for (const key of [...state.kept.keys()]) {
      if (key.startsWith('state:') || key.startsWith('log:')) state.kept.set(key, 'not bytes')
    }

    const woken = new NoteRoom(state as unknown as DurableObjectState, env)
    const lines = await logged(() => woken.alarm())

    expect(await contentOf(noteId)).toBe('# Kept\nevery word\n')
    expect(lines).toHaveLength(1)
    expect(String((JSON.parse(lines[0] ?? '{}') as { said?: unknown }).said)).toContain(
      'never held',
    )
  })

  test('still lets a note somebody emptied become empty', async () => {
    const noteId = await fileAt('gone.md', '# Gone\nevery word of it\n')
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    const before = Y.encodeStateVector(one.doc)
    one.text.delete(0, one.text.length)
    await say(made, state, one.socket, syncUpdate(Y.encodeStateAsUpdate(one.doc, before)))
    await made.alarm()

    expect(await contentOf(noteId)).toBe('')
  })
})

describe('a room whose document has reached its ceiling', () => {
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
      body: { path: 'together.md', content: OPENING },
    })
    noteId = note.json.note.id
  })

  afterEach(() => env.close())

  test('closes the socket that typed past it, with the reason', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    await say(made, state, one.socket, one.type(0, 'x'.repeat(MOST_DOCUMENT_BYTES)))
    expect(one.socket.closed).toBe(false)

    await say(made, state, one.socket, one.type(0, 'one more keystroke'))

    expect(one.socket.closedWith?.code).toBe(1009)
    expect(one.socket.closedWith?.reason).toBe(TOO_LARGE_IN_A_ROOM)
  })

  test('and keeps the words it had rather than the ones it refused', async () => {
    const { room: made, state } = room(env)
    const one = await arrive(made, state, { id: noteId, spaceId })

    const content = (): Promise<string> =>
      call(env, `/v1/notes/${noteId}`, { token }).then((read) => read.json.content)

    await say(made, state, one.socket, one.type(0, 'x'.repeat(MOST_DOCUMENT_BYTES)))
    const held = await content()

    await say(made, state, one.socket, one.type(0, 'refused'))

    expect(await content()).toBe(held)
  })
})

describe('telling the rooms somebody has been taken out of a space', () => {
  let told: TestEnv

  afterEach(() => told.close())

  function holding(open: number): void {
    for (let at = 0; at < open; at++) {
      told.db
        .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
        .run(`note-${String(at).padStart(4, '0')}`, 's1', 'u1', Date.now())
    }
  }

  test('reaches every file they have open, however many that is', async () => {
    const door = doorway()
    told = testEnv({ ROOMS: door.ROOMS })

    const open = 137
    holding(open)

    for (const [noteId, spaceId, who] of [
      ['note-9998', 's1', 'u2'],
      ['note-9999', 's2', 'u1'],
    ] as const) {
      told.db
        .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
        .run(noteId, spaceId, who, Date.now())
    }

    await roomsRevoked(told, 's1', 'u1', 'none')

    expect(door.asked).toHaveLength(open)
    for (const headers of door.asked) {
      expect(headers.get('x-orden-revoked')).toBe('u1')
      expect(headers.get('x-orden-role')).toBe('none')
    }
  })

  test('and only the one file, where a share was about one file', async () => {
    const door = doorway()
    told = testEnv({ ROOMS: door.ROOMS })
    holding(3)

    await roomsRevoked(told, 's1', 'u1', 'read', 'note-0001')

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-orden-role')).toBe('read')
  })
})

describe('ending a session', () => {
  let out: TestEnv

  afterEach(() => out.close())

  async function signedIn(door: { ROOMS: DurableObjectNamespace; asked: Headers[] }) {
    out = testEnv({ ROOMS: door.ROOMS })
    const token = await signIn(out, 'a@b.dev')
    const who = (out.db.prepare('select id from users limit 1').get() as { id: string }).id

    out.db
      .prepare('insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, ?)')
      .run('note-a', 's1', who, Date.now())

    return { token, who }
  }

  test('closes the rooms that session had open', async () => {
    const door = doorway()
    const { token, who } = await signedIn(door)

    await call(out, '/v1/auth/signout', { method: 'POST', token })

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-orden-revoked')).toBe(who)
    expect(door.asked[0]?.get('x-orden-role')).toBe('none')
  })

  test('and so does ending every session but this one', async () => {
    const door = doorway()
    const { token, who } = await signedIn(door)
    await signIn(out, 'a@b.dev')

    await call(out, '/v1/sessions', { method: 'DELETE', token })

    expect(door.asked).toHaveLength(1)
    expect(door.asked[0]?.get('x-orden-revoked')).toBe(who)
  })
})

describe('an account deleted while files are open', () => {
  let env: TestEnv
  let live: ReturnType<typeof running>

  beforeEach(() => {
    env = testEnv()
    live = running(env)
    env.ROOMS = live.ROOMS
  })

  afterEach(() => env.close())

  async function idOf(token: string): Promise<string> {
    return (await call(env, '/v1/me', { token })).json.user.id
  }

  async function noteOf(token: string, name: string): Promise<{ spaceId: string; id: string }> {
    const spaceId = (await call(env, '/v1/spaces', { token, body: { name } })).json.space.id
    const id = (
      await call(env, `/v1/spaces/${spaceId}/notes`, {
        token,
        body: { path: 'together.md', content: OPENING },
      })
    ).json.note.id
    return { spaceId, id }
  }

  async function deleteAccount(token: string): Promise<number> {
    const { mail } = await import('./harness')
    const sent = await mail(() => call(env, '/v1/account/delete/code', { token, body: {} }))
    const code = /(\d{3}) (\d{3})/.exec(sent)
    const verified = await call<{ ticket: string }>(env, '/v1/account/delete/verify', {
      token,
      body: { code: `${code?.[1] ?? ''}${code?.[2] ?? ''}` },
    })
    const gone = await call(env, '/v1/account', {
      method: 'DELETE',
      token,
      body: { ticket: verified.json.ticket },
    })
    return gone.status
  }

  test('its own rooms close on everybody and forget the file', async () => {
    const leaving = await signIn(env, 'leaving@example.com')
    const note = await noteOf(leaving, 'Mine')

    const { room: made, state } = live.of(note.id)
    const socket = await join(made, { ...note, who: 'somebody-else' })
    expect(state.kept.size).toBeGreaterThan(0)

    expect(await deleteAccount(leaving)).toBe(200)

    expect(socket.closed).toBe(true)
    expect(socket.closedWith?.code).toBe(1008)
    expect(state.kept.size).toBe(0)
    expect(state.takeAlarm()).toBeNull()
  })

  test('and its sockets in somebody else’s room close, and nobody else’s', async () => {
    const staying = await signIn(env, 'staying@example.com')
    const leaving = await signIn(env, 'leaving@example.com')
    const note = await noteOf(staying, 'Theirs')

    const { room: made, state } = live.of(note.id)
    const theirs = await join(made, { ...note, who: await idOf(staying) })
    const mine = await join(made, { ...note, who: await idOf(leaving) })

    expect(await deleteAccount(leaving)).toBe(200)

    expect(mine.closed).toBe(true)
    expect(theirs.closed).toBe(false)
    expect(state.kept.size).toBeGreaterThan(0)
  })
})
