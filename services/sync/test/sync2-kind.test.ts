/** A note on sync v2 renamed across the two kinds of room, `.md` to `.canvas` or back.
 *
 *  On sync v2 an entry's kind is part of its identity: a rename moves its name and
 *  nothing else, and every device goes on holding the document in the shape the entry
 *  was made as (`shapeOf` in the app's sync2/kinds.ts). The room has to hold the same
 *  shape as those devices, whatever the name now says, and whichever road it is woken
 *  by: a socket, a push, a pull or a whole text handed in. Read by the name instead, a
 *  room woken cold by a push took the words it held as a plane, and its settle wrote an
 *  empty canvas over them (A26-S1). */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { type Canvas, readCanvas, writeCanvas } from '@orden/markdown/canvas'
import { pushPlane, readPlane } from '@orden/rooms/plane'
import { type PullResponse, type PushResponse, seedPlane, seedUpdate } from '@orden/sync-core'
import { subprotocol, TEXT } from '@orden/rooms'
import * as Y from 'yjs'
import { NoteRoom } from '../src/rooms/room'
import { call, type RpcView, signIn, type TestEnv, testEnv } from './harness'
import { doorway, join } from './room'
import { framed, type Live, live } from './sync2'

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'kinds@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Kinds' } })).json.space.id
})

afterEach(() => env.close())

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  return answer.json.note.id
}

async function prepare() {
  await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
}

function row(id: string): { version: number; path: string; kind: string; epoch: number } {
  return env.db.prepare('select * from notes where id = ?').get(id) as never
}

async function body(id: string): Promise<string> {
  const object = await env.NOTES.get(`spaces/${space}/${id}`)
  return object ? await object.text() : ''
}

async function renamed(id: string, name: string) {
  const answer = await call(env, `/v2/spaces/${space}/ops`, {
    token,
    body: { ops: [{ op: `r-${name}`, t: 'rename', id, name, seen: 1e9 }] },
  })
  expect(answer.status, answer.text).toBe(200)
  expect(row(id).path).toBe(name)
}

/** The object the runtime dropped, made again over the same storage. */
function evict(id: string) {
  const held = rooms.of(id)
  ;(rooms.all() as Map<string, { room: NoteRoom; state: unknown }>).set(id, {
    room: new NoteRoom(held.state as never, env),
    state: held.state,
  })
}

/** A device holding a note's words, as its sync v2 engine does. */
class Words {
  readonly doc = new Y.Doc()
  seq = 1
  private pushes = 0

  constructor(
    readonly id: string,
    text: string,
  ) {
    Y.applyUpdateV2(this.doc, seedUpdate(id, 1, text))
  }

  type(at: number, words: string) {
    const base = Y.encodeStateVector(this.doc)
    this.doc.getText(TEXT).insert(at, words)
    return { base, update: Y.encodeStateAsUpdateV2(this.doc, base) }
  }

  async push(pending: { base: Uint8Array; update: Uint8Array }) {
    const { value } = await framed<PushResponse>(env, '/v2/docs/push', token, {
      docs: [
        {
          id: this.id,
          push: `w${String(++this.pushes)}`,
          epoch: 1,
          seq: this.seq,
          ...pending,
          at: 1,
        },
      ],
    })
    const answer = value.docs[0]
    if (answer && 'ok' in answer) this.seq = answer.seq
    return answer
  }
}

const CARD: Canvas = {
  nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 250, height: 60, text: 'a card' }],
  edges: [],
  ink: [],
  at: { a: 1 },
  gone: {},
}

describe('a note renamed to a canvas', () => {
  for (const warm of [false, true]) {
    const room = warm ? 'warm' : 'cold'

    test(`keeps its words through a push to a ${room} room`, async () => {
      const id = await made('Plan.md', 'one\n')
      await prepare()
      const device = new Words(id, 'one\n')
      expect(await device.push(device.type(4, 'two\n'))).toMatchObject({ ok: true })
      await rooms.settle()

      await renamed(id, 'Plan.canvas')
      expect(row(id).kind).toBe('note')
      if (!warm) evict(id)

      expect(await device.push(device.type(8, 'three\n'))).toMatchObject({ ok: true })
      await rooms.settle()
      expect(await body(id)).toBe('one\ntwo\nthree\n')
    })

    test(`keeps its words through a v1 save to a ${room} room`, async () => {
      const id = await made('Plan.md', 'one\n')
      await prepare()
      await join(rooms.of(id).room, { id, spaceId: space })
      await rooms.settle()

      await renamed(id, 'Plan.canvas')
      if (!warm) evict(id)

      const put = await call(env, `/v1/notes/${id}`, {
        method: 'PUT',
        token,
        body: { content: 'one\nfrom v1\n', baseVersion: row(id).version },
      })
      expect(put.status, put.text).toBe(200)
      await rooms.settle()
      expect(await body(id)).toBe('one\nfrom v1\n')
    })

    test(`keeps its words through a pull the ${room} room answers`, async () => {
      const id = await made('Plan.md', 'one\n')
      await prepare()
      const device = new Words(id, 'one\n')
      await device.push(device.type(4, 'two\n'))
      await rooms.settle()

      await renamed(id, 'Plan.canvas')
      if (!warm) evict(id)
      // No snapshot in the bucket, so the pull asks the room.
      await env.NOTES.delete(`crdt/${id}`)

      const fresh = new Y.Doc()
      const { value } = await framed<PullResponse>(env, '/v2/docs/pull', token, {
        docs: [{ id, epoch: 1, sv: Y.encodeStateVector(fresh) }],
      })
      const answer = value.docs[0]
      if (!answer || !('update' in answer)) throw new Error(JSON.stringify(answer))
      Y.applyUpdateV2(fresh, answer.update)
      expect(fresh.getText(TEXT).toJSON()).toBe('one\ntwo\n')

      expect(await device.push(device.type(0, 'zero\n'))).toMatchObject({ ok: true })
      await rooms.settle()
      expect(await body(id)).toBe('zero\none\ntwo\n')
    })
  }

  test('is seeded as words for a pull no room has answered yet', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await renamed(id, 'Plan.canvas')

    const fresh = new Y.Doc()
    const { value } = await framed<PullResponse>(env, '/v2/docs/pull', token, {
      docs: [{ id, epoch: 1, sv: Y.encodeStateVector(fresh) }],
    })
    const answer = value.docs[0]
    if (!answer || !('update' in answer)) throw new Error(JSON.stringify(answer))
    expect(answer.update).toEqual(seedUpdate(id, 1, 'one\n'))
  })

  test('a socket joins it as words', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await renamed(id, 'Plan.canvas')

    const door = doorway()
    env.ROOMS = door.ROOMS
    const answer = await call(env, `/rooms/${id}`, {
      headers: { upgrade: 'websocket', 'sec-websocket-protocol': subprotocol(token) },
    })
    expect(answer.status).toBe(200)
    expect(door.asked.map((one) => one.get('x-nib-kind'))).toEqual(['words'])
  })
})

describe('a canvas renamed to a note', () => {
  test('keeps its cards through a push to a cold room', async () => {
    const id = await made('Board.canvas', writeCanvas(CARD))
    await prepare()
    await join(rooms.of(id).room, { id, spaceId: space, kind: 'plane' })
    await rooms.settle()

    await renamed(id, 'Board.md')
    expect(row(id).kind).toBe('canvas')
    evict(id)

    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, seedPlane(id, 1, readCanvas(writeCanvas(CARD))))
    const base = Y.encodeStateVector(doc)
    const next: Canvas = {
      ...CARD,
      nodes: [{ ...CARD.nodes[0], text: 'a card, moved' } as never],
      at: { a: 2 },
    }
    doc.transact(() => pushPlane(doc, readPlane(doc), next))
    const { value } = await framed<PushResponse>(env, '/v2/docs/push', token, {
      docs: [
        {
          id,
          push: 'p1',
          epoch: 1,
          seq: 1,
          base,
          update: Y.encodeStateAsUpdateV2(doc, base),
          at: 1,
        },
      ],
    })
    expect(value.docs[0]).toMatchObject({ ok: true })
    await rooms.settle()

    const after = readCanvas(await body(id))
    expect(after.nodes.map((one) => (one as { text?: string }).text)).toEqual(['a card, moved'])
  })
})

describe('a canvas renamed to a note, written as prose', () => {
  async function renamedBoard(warm: boolean): Promise<string> {
    const id = await made('Board.canvas', writeCanvas(CARD))
    await prepare()
    await join(rooms.of(id).room, { id, spaceId: space, kind: 'plane' })
    await rooms.settle()
    await renamed(id, 'Board.md')
    if (!warm) evict(id)
    return id
  }

  function cards(text: string): string[] {
    return readCanvas(text).nodes.map((one) => (one as { text?: string }).text ?? '')
  }

  for (const warm of [false, true]) {
    const room = warm ? 'warm' : 'cold'

    test(`refuses a v1 save of prose to a ${room} room, and keeps the cards`, async () => {
      const id = await renamedBoard(warm)
      const put = await call(env, `/v1/notes/${id}`, {
        method: 'PUT',
        token,
        body: { content: '# Board\n\nprose\n', baseVersion: row(id).version },
      })
      expect(put.status, put.text).toBe(422)
      await rooms.settle()
      expect(cards(await body(id))).toEqual(['a card'])
    })
  }

  for (const warm of [false, true]) {
    const room = warm ? 'warm' : 'cold'

    test(`refuses a stale v1 save of prose to a ${room} room, rather than merging it away`, async () => {
      const id = await renamedBoard(warm)
      const put = await call(env, `/v1/notes/${id}`, {
        method: 'PUT',
        token,
        body: { content: '# Board\n\nmy offline prose\n', baseVersion: row(id).version - 1 },
      })
      expect(put.status, put.text).toBe(422)
      await rooms.settle()
      expect(cards(await body(id))).toEqual(['a card'])
    })
  }

  test('refuses the connector writing prose into it, and says why', async () => {
    const id = await renamedBoard(false)
    const mcp = await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })
    const written = await call<RpcView>(env, '/mcp', {
      token: mcp.json.token,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'write_note',
          arguments: { space: 'Kinds', path: 'Board.md', content: '# Board\n\nprose\n' },
        },
      },
    })
    expect(written.json.result.content[0]?.text).toMatch(/canvas/)
    await rooms.settle()
    expect(cards(await body(id))).toEqual(['a card'])
  })
})

describe('a canvas written with something that is not one', () => {
  test('refuses JSON that is not a canvas, rather than emptying the cards', async () => {
    const id = await made('Board.canvas', writeCanvas(CARD))
    await prepare()
    const put = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: '{"title":"x"}', baseVersion: row(id).version },
    })
    expect(put.status, put.text).toBe(422)
    await rooms.settle()
    expect(readCanvas(await body(id)).nodes).toHaveLength(1)
  })

  test('the connector says plainly that a canvas takes a canvas', async () => {
    await made('Board.canvas', writeCanvas(CARD))
    await prepare()
    const mcp = await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })
    const written = await call<RpcView>(env, '/mcp', {
      token: mcp.json.token,
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'write_note',
          arguments: { space: 'Kinds', path: 'Board.canvas', content: 'prose\n' },
        },
      },
    })
    const said = written.json.result.content[0]?.text ?? ''
    expect(said).toMatch(/canvas/)
    expect(said).not.toMatch(/name that says words/)
  })

  test('a rollback that would put words into a canvas says it did not, and counts it apart', async () => {
    const id = await made('Board.canvas', '')
    await prepare()
    const ago = 60 * 60 * 1000
    env.db.prepare('update note_versions set at = at - ? where note_id = ?').run(ago, id)
    env.db.prepare('update notes set updated_at = updated_at - ? where id = ?').run(ago, id)
    const put = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: writeCanvas(CARD), baseVersion: row(id).version },
    })
    expect(put.status, put.text).toBe(200)

    const rolled = await call(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: Date.now() - 30 * 60 * 1000 },
    })
    expect(rolled.json).toMatchObject({ notes: 0, refused: 1, partial: false, left: 0 })
    expect(readCanvas(await body(id)).nodes).toHaveLength(1)
  })
})

describe('a note renamed to a canvas, saved on an old version', () => {
  test('is a conflict, as a note is, rather than a canvas merge that drops the save', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await renamed(id, 'Plan.canvas')
    const stale = row(id).version

    const first = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'one\ntwo\n', baseVersion: stale },
    })
    expect(first.status, first.text).toBe(200)

    const late = await call(env, `/v1/notes/${id}`, {
      method: 'PUT',
      token,
      body: { content: 'one\nmine\n', baseVersion: stale },
    })
    expect(late.status, late.text).toBe(409)
    expect(late.json.content).toBe('one\ntwo\n')
    expect(await body(id)).toBe('one\ntwo\n')
  })
})

describe('a room that holds another kind than its entry', () => {
  test('writes nothing over the file, and starts the next epoch, when a push wakes it', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    // What a build that read the kind off the name left behind: the room written down
    // as a plane, for an entry that is words.
    await join(rooms.of(id).room, { id, spaceId: space, kind: 'plane' })
    await rooms.settle()
    expect(await body(id)).toBe('one\n')
    evict(id)

    const device = new Words(id, 'one\n')
    const answer = await device.push(device.type(4, 'two\n'))
    expect(answer).toMatchObject({ epoch: 2 })
    await rooms.settle()
    expect(await body(id)).toBe('one\n')
    expect(row(id).epoch).toBe(2)

    // And the room it starts again as holds the words.
    const fresh = new Y.Doc()
    const { value } = await framed<PullResponse>(env, '/v2/docs/pull', token, {
      docs: [{ id, epoch: 2, sv: Y.encodeStateVector(fresh) }],
    })
    const pulled = value.docs[0]
    if (!pulled || !('update' in pulled)) throw new Error(JSON.stringify(pulled))
    Y.applyUpdateV2(fresh, pulled.update)
    expect(fresh.getText(TEXT).toJSON()).toBe('one\n')
  })
})
