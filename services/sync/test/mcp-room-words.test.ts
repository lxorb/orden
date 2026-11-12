import { TEXT } from '@orden/rooms'
import { seedUpdate, type PushResponse } from '@orden/sync-core'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as Y from 'yjs'
import { call, type RpcView, signIn, type TestEnv, testEnv } from './harness'
import { framed, type Live, live } from './sync2'

let env: TestEnv
let rooms: Live
let token: string
let space: string
let nib: string

beforeEach(async () => {
  devices.clear()
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'rooms@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Rooms' } })).json.space.id
  nib = (await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token
})

afterEach(() => env.close())

async function made(path: string, content: string): Promise<string> {
  const answer = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  const id: string = answer.json.note.id
  return id
}

const prepare = () => call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })

async function tool(name: string, args: Record<string, unknown>): Promise<string> {
  const answer = await call<RpcView>(env, '/mcp', {
    token: nib,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: { space: 'Rooms', ...args } },
    },
  })
  return answer.json.result.content[0]?.text ?? ''
}

const devices = new Map<string, { doc: Y.Doc; seq: number; pushes: number }>()

async function typed(id: string, words: string, known: string): Promise<void> {
  let device = devices.get(id)
  if (!device) {
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, seedUpdate(id, 1, known))
    device = { doc, seq: known ? 1 : 0, pushes: 0 }
    devices.set(id, device)
  }
  const base = Y.encodeStateVector(device.doc)
  const text = device.doc.getText(TEXT)
  text.insert(text.length, words)
  const update = Y.encodeStateAsUpdateV2(device.doc, base)
  const push = `p-${String(++device.pushes)}`
  const { value } = await framed<PushResponse>(env, '/v2/docs/push', token, {
    docs: [{ id, push, epoch: 1, seq: device.seq, base, update, at: 1 }],
  })
  const answer = value.docs[0] as { ok?: boolean; seq?: number; update?: Uint8Array } | undefined
  expect(answer).toMatchObject({ ok: true })
  device.seq = answer?.seq ?? device.seq
}

describe('a room whose settle is refused', () => {
  async function refusing() {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await rooms.settle()
    await typed(id, 'typed\n', 'one\n')
    const { room } = rooms.of(id)
    ;(room as never as { settle: () => Promise<boolean> }).settle = () => Promise.resolve(false)
    const { version } = env.db.prepare('select version from notes where id = ?').get(id) as {
      version: number
    }
    return { id, version, room }
  }

  test('answers a v1 save 503, not a conflict, and keeps the words', async () => {
    const { id, version, room } = await refusing()

    const saved = await call(env, `/v1/notes/${id}`, {
      token,
      method: 'PUT',
      body: { content: 'one\nsaved\n', baseVersion: version },
    })

    expect(saved.status).toBe(503)
    const doc = (room as never as { state: { doc: Y.Doc } }).state.doc
    expect(doc.getText(TEXT).toJSON()).toBe('one\ntyped\n')
  })

  test('a real conflict is still one', async () => {
    const id = await made('Other.md', 'one\n')
    await prepare()
    await rooms.settle()
    await typed(id, 'typed\n', 'one\n')

    const saved = await call(env, `/v1/notes/${id}`, {
      token,
      method: 'PUT',
      body: { content: 'one\nsaved\n', baseVersion: 1 },
    })

    expect(saved.status).toBe(409)
  })
})

describe('write_note to a new path', () => {
  test.each(['board.canvas', 'book.pages'])(
    'refuses prose for %s, as for one that is there',
    async (path) => {
      await prepare()
      const answer = await tool('write_note', { path, content: 'my long prose' })
      expect(answer).toMatch(/is a canvas\. Write JSON Canvas into it/)
      expect(env.db.prepare('select count(*) as n from notes where path = ?').get(path)).toEqual({
        n: 0,
      })
    },
  )

  test('takes a canvas as a canvas', async () => {
    await prepare()
    const answer = await tool('write_note', {
      path: 'board.canvas',
      content: '{"nodes":[],"edges":[]}',
    })
    expect(answer).toBe('Saved board.canvas.')
  })

  test('on a v1 space too', async () => {
    const answer = await tool('write_note', { path: 'board.canvas', content: 'prose' })
    expect(answer).toMatch(/is a canvas/)
  })

  test('says where the note landed, where the tree put it elsewhere', async () => {
    await made('plan.md', 'one\n')
    await made('Deep/keep.md', 'one\n')
    await prepare()

    expect(await tool('write_note', { path: 'plan.md/child.md', content: 'x' })).toBe(
      'Saved plan.md 2/child.md.',
    )
    expect(await tool('read_note', { path: 'plan.md 2/child.md' })).toBe('x')
  })
})

describe('a note the connector writes', () => {
  function hub(): { asked: number } {
    const heard = { asked: 0 }
    env.HUB = {
      idFromName: () => 'hub',
      get: () => ({
        fetch: () => {
          heard.asked += 1
          return Promise.resolve(new Response(null, { status: 204 }))
        },
      }),
    } as never
    return heard
  }

  test('tells the devices when it is made, and when a note with no room moves', async () => {
    const heard = hub()
    expect(await tool('write_note', { path: 'New.md', content: 'x' })).toBe('Saved New.md.')
    const made = heard.asked
    expect(made).toBeGreaterThan(0)
    expect(await tool('write_note', { path: 'New.md', content: 'y' })).toBe('Saved New.md.')
    expect(heard.asked).toBeGreaterThan(made)
  })
})
