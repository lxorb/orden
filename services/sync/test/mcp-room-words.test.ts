/** The connector's to-dos writing into a note somebody is typing in: what they read
 *  is what they name, so words typed before or during the call stay in the note, on
 *  a v2 note through its room and on a v1 note through its version. And a note made
 *  through the connector says where it landed, and is the kind its name says. */

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
  return answer.json.note.id
}

const prepare = () => call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })

async function body(id: string): Promise<string> {
  const object = await env.NOTES.get(`spaces/${space}/${id}`)
  return object ? await object.text() : ''
}

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

/** Somebody typing on a device of their own: a push, in the room and not settled yet.
 *  `known` is what the note said when the device first read it. */
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

/** Runs `work` the first time the bucket is read for this note: a moment after the
 *  tool has read the note and before it writes. */
function afterItsRead(id: string, work: () => Promise<void>) {
  const get = env.NOTES.get.bind(env.NOTES)
  let done = false
  env.NOTES.get = async (key: string) => {
    const object = await get(key)
    if (!done && key === `spaces/${space}/${id}`) {
      done = true
      await work()
    }
    return object
  }
}

/** The room's document, and a keystroke arriving in it with nothing awaited. */
function keystroke(id: string, words: string): void {
  const doc = (rooms.of(id).room as never as { state: { doc: Y.Doc } }).state.doc
  doc.getText(TEXT).insert(doc.getText(TEXT).length, words)
}

describe('add_task on a note with a room', () => {
  test('keeps words the room holds and has not settled', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await rooms.settle()
    await typed(id, 'typed\n', 'one\n')

    const answer = JSON.parse(await tool('add_task', { note: 'Plan', text: 'from mcp' }))
    await rooms.settle()

    expect(answer.path).toBe('Plan.md')
    expect(await body(id)).toBe('one\ntyped\n\n- [ ] from mcp\n')
  })

  test('keeps words settled between its read and its write', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await rooms.settle()
    afterItsRead(id, async () => {
      await typed(id, 'typed\n', 'one\n')
      await rooms.settle()
    })

    await tool('add_task', { note: 'Plan', text: 'from mcp' })

    expect(await body(id)).toContain('typed\n')
    expect(await body(id)).toContain('- [ ] from mcp')
  })

  test('keeps a keystroke that lands while the room reads the row', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await rooms.settle()
    // What arrives while `ingest` waits for the row is in the document and on no
    // version, and the text it was handed knows nothing of it.
    const looking = /^select \* from notes where space_id = \? and path = \?/
    let fired = false
    env.justBefore(looking, () => {
      env.justBefore(looking, () => {
        env.justBefore(/^select \* from notes where id = \?$/, () => {
          fired = true
          keystroke(id, 'typed\n')
        })
      })
    })

    await tool('add_task', { note: 'Plan', text: 'from mcp' })
    await rooms.settle()

    expect(fired).toBe(true)
    expect(await body(id)).toContain('typed\n')
    expect(await body(id)).toContain('- [ ] from mcp')
  })

  test('says so, and takes nothing, where the note will not hold still', async () => {
    const id = await made('Plan.md', 'one\n')
    await prepare()
    await rooms.settle()
    const get = env.NOTES.get.bind(env.NOTES)
    let busy = false
    env.NOTES.get = async (key: string) => {
      const object = await get(key)
      if (key === `spaces/${space}/${id}` && !busy) {
        busy = true
        await typed(id, 'x\n', 'one\n')
        await rooms.settle()
        busy = false
      }
      return object
    }

    const answer = await tool('add_task', { note: 'Plan', text: 'from mcp' })

    expect(answer).toMatch(/changed while I was writing it/)
    busy = true
    expect(await body(id)).toMatch(/^one\n(x\n)+$/)
  })
})

describe('update_task on a note with a room', () => {
  test('keeps words the room holds and has not settled', async () => {
    const id = await made('Plan.md', '- [ ] Ship\n')
    await prepare()
    await rooms.settle()
    const { tasks } = JSON.parse(await tool('list_tasks', {}))
    await typed(id, 'typed\n', '- [ ] Ship\n')

    await tool('update_task', { at: tasks[0].at, done: true })
    await rooms.settle()

    const words = await body(id)
    expect(words).toContain('typed\n')
    expect(words).toMatch(/- \[x\] Ship/)
  })

  test('a move keeps words typed in either note, and the task lands once', async () => {
    const from = await made('Plan.md', '- [ ] Ship\nkeep\n')
    const into = await made('Later.md', 'later\n')
    await prepare()
    await rooms.settle()
    const { tasks } = JSON.parse(await tool('list_tasks', {}))
    await typed(from, 'typed here\n', '- [ ] Ship\nkeep\n')
    await typed(into, 'typed there\n', 'later\n')
    // And once more in the note it leaves, after the task has landed in the other.
    let armed = true
    const get = env.NOTES.get.bind(env.NOTES)
    env.NOTES.get = async (key: string) => {
      const object = await get(key)
      if (armed && key === `spaces/${space}/${from}` && (await body(into)).includes('Ship')) {
        armed = false
        await typed(from, 'late\n', '')
        await rooms.settle()
      }
      return object
    }

    const answer = JSON.parse(
      await tool('update_task', { at: tasks[0].at, move_to: { note: 'Later' } }),
    )
    await rooms.settle()

    expect(answer.at).toMatch(/^Later\.md#/)
    const left = await body(from)
    const landed = await body(into)
    expect(left).not.toContain('Ship')
    expect(left).toContain('typed here\n')
    expect(landed.match(/Ship/g)).toHaveLength(1)
    expect(landed).toContain('typed there\n')
  })
})

describe('a move whose note will not let go', () => {
  /** The note it leaves, written in every time it is read once the task has landed. */
  function writtenIn(from: string, into: string, change: (at: number) => Promise<void>) {
    const get = env.NOTES.get.bind(env.NOTES)
    let busy = false
    let at = 0
    env.NOTES.get = async (key: string) => {
      const object = await get(key)
      if (busy || key !== `spaces/${space}/${from}`) return object
      busy = true
      const there = await get(`spaces/${space}/${into}`)
      if ((await there?.text())?.includes('Ship')) await change(at++)
      busy = false
      return object
    }
  }

  test('says it is in both, and which to take it out of', async () => {
    const start = '- [ ] Ship\n'
    const from = await made('Plan.md', start)
    const into = await made('Later.md', 'later\n')
    await prepare()
    await rooms.settle()
    const { tasks } = JSON.parse(await tool('list_tasks', {}))
    writtenIn(from, into, async () => {
      await typed(from, 'x\n', start)
      await rooms.settle()
    })

    const answer = await tool('update_task', { at: tasks[0].at, move_to: { note: 'Later' } })

    expect(answer).toMatch(/Later\.md/)
    expect(answer).toMatch(/still in Plan\.md/)
    expect(answer).toMatch(/not move it again/)
  })

  test('says so where the task was edited there meanwhile, and stays', async () => {
    const start = '- [ ] Ship\n'
    const from = await made('Plan.md', start)
    const into = await made('Later.md', 'later\n')
    const { tasks } = JSON.parse(await tool('list_tasks', {}))
    writtenIn(from, into, async (at) => {
      if (at > 0) return
      const version = (
        env.db.prepare('select version from notes where id = ?').get(from) as { version: number }
      ).version
      await call(env, `/v1/notes/${from}`, {
        token,
        method: 'PUT',
        body: { content: '- [ ] Ship it today\n', baseVersion: version },
      })
    })

    const answer = JSON.parse(
      await tool('update_task', { at: tasks[0].at, move_to: { note: 'Later' } }),
    )

    expect(answer.at).toMatch(/^Later\.md#/)
    expect(answer.left).toMatch(/Plan\.md/)
    expect(await body(from)).toBe('- [ ] Ship it today\n')
    expect(await body(into)).toContain('Ship')
  })
})

describe('a note that starts with a byte order mark', () => {
  test.each([false, true])('takes a task, on a room: %s', async (room) => {
    const id = await made('Bom.md', '\uFEFF- [ ] First\n')
    if (room) {
      await prepare()
      await rooms.settle()
    }

    const answer = await tool('add_task', { note: 'Bom', text: 'from mcp' })

    expect(answer).not.toMatch(/changed while/)
    const row = env.db.prepare('select hash from notes where id = ?').get(id)
    expect(row).toBeTruthy()
    expect(await body(id)).toContain('- [ ] First')
    expect(await body(id)).toContain('- [ ] from mcp')
  })
})

describe('two add_tasks to a note not there yet', () => {
  test('both land, in one note', async () => {
    const answers = await Promise.all([
      tool('add_task', { note: 'Fresh', text: 'one' }),
      tool('add_task', { note: 'Fresh', text: 'two' }),
    ])

    expect(answers.every((answer) => answer.startsWith('{'))).toBe(true)
    const rows = env.db.prepare("select id from notes where path like 'Fresh%'").all() as {
      id: string
    }[]
    expect(rows).toHaveLength(1)
    const words = await body(rows[0]?.id ?? '')
    expect(words).toContain('- [ ] one')
    expect(words).toContain('- [ ] two')
  })

  test('both land on a space whose tree is rows', async () => {
    await prepare()
    const answers = await Promise.all([
      tool('add_task', { note: 'Fresh', text: 'one' }),
      tool('add_task', { note: 'Fresh', text: 'two' }),
    ])
    await rooms.settle()

    expect(answers.every((answer) => answer.startsWith('{'))).toBe(true)
    const rows = env.db.prepare("select id from notes where path like 'Fresh%'").all() as {
      id: string
    }[]
    expect(rows).toHaveLength(1)
    const words = await body(rows[0]?.id ?? '')
    expect(words).toContain('- [ ] one')
    expect(words).toContain('- [ ] two')
  })
})

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

  test('answers a task tool that it could not write, not that the note moved', async () => {
    await refusing()

    expect(await tool('add_task', { note: 'Plan', text: 'x' })).toMatch(/could not be written/)
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

describe('add_task on a v1 note', () => {
  test('keeps a save made between its read and its write', async () => {
    const id = await made('Plan.md', 'one\n')
    const note = () =>
      env.db.prepare('select version from notes where id = ?').get(id) as { version: number }
    afterItsRead(id, async () => {
      await call(env, `/v1/notes/${id}`, {
        token,
        method: 'PUT',
        body: { content: 'one\nsaved\n', baseVersion: note().version },
      })
    })

    await tool('add_task', { note: 'Plan', text: 'from mcp' })

    expect(await body(id)).toContain('saved\n')
    expect(await body(id)).toContain('- [ ] from mcp')
  })

  test('does not read the bytes of the version before as the row that says the next', async () => {
    const id = await made('Plan.md', 'one\n')
    // A save has claimed the row and its bytes are on the way (`saveNote`).
    const hash = 'a'.repeat(64)
    env.db.prepare('update notes set version = 2, hash = ? where id = ?').run(hash, id)

    const answer = await tool('add_task', { note: 'Plan', text: 'from mcp' })

    expect(answer).toMatch(/changed while I was writing it/)
    expect(await body(id)).toBe('one\n')
  })

  test('does not write over a note that arrived where there was none', async () => {
    const id = await made('Other.md', 'theirs\n')
    // Looked for and missing, and then a device renames its note to that name before
    // the write looks again.
    const looking = /^select \* from notes where space_id = \? and path = \?/
    env.justBefore(looking, () => {
      env.justBefore(looking, () => {
        env.db.prepare("update notes set path = 'Fresh.md' where id = ?").run(id)
      })
    })

    await tool('add_task', { note: 'Fresh', text: 'from mcp' })

    expect(await body(id)).toBe('theirs\n\n- [ ] from mcp\n')
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

describe('a task aimed at what is not a note', () => {
  test.each(['board.canvas', 'book.pages'])('add_task to %s is refused', async (path) => {
    const answer = await tool('add_task', { note: path, text: 'from mcp' })
    expect(answer).toMatch(/not a note/)
    expect(env.db.prepare('select count(*) as n from notes').get()).toEqual({ n: 1 })
  })
})

describe('a note the connector writes', () => {
  /** The account's hub, as far as what it is asked to tell. */
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
