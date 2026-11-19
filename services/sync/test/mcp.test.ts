import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { QUOTA } from '../src/sync-server/src/storage'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'

let env: TestEnv
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id

  await call(env, `/v1/spaces/${space}/notes`, {
    token,
    body: { path: 'plan.md', content: '# Plan\n\nShip the thing.\n' },
  })
})

afterEach(() => env.close())

async function connector(readOnly = true): Promise<string> {
  const made = await call(env, '/v1/mcp/token', { token, body: { readOnly } })
  return made.json.token
}

async function rpc(key: string, method: string, params?: Record<string, unknown>) {
  return call<RpcView>(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method, params },
  })
}

async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(key, 'tools/call', { name, arguments: args })
  return response.json.result.content[0]?.text ?? ''
}

describe('handing out a token', () => {
  test('gives one back exactly once', async () => {
    const made = await call(env, '/v1/mcp/token', { token, body: { readOnly: true } })

    expect(made.status).toBe(200)
    expect(made.json.token).toMatch(/^orden_/)

    const asked = await call(env, '/v1/mcp/token', { token })
    expect(asked.json.exists).toBe(true)
    expect(asked.json.token).toBeUndefined()
  })

  test('replaces the previous one', async () => {
    const first = await connector()
    const second = await connector()

    expect(first).not.toBe(second)
    expect((await rpc(first, 'tools/list')).status).toBe(401)
    expect((await rpc(second, 'tools/list')).status).toBe(200)
  })

  test('replaces one handed out at the same moment', async () => {
    env.justBefore(/insert into mcp_tokens/, () =>
      env.db
        .prepare(
          `insert into mcp_tokens (token_hash, user_id, read_only, created_at)
           select 'quicker', id, 1, 0 from users where email = 'a@b.dev'`,
        )
        .run(),
    )

    await connector()
    expect(env.db.prepare('select count(*) as n from mcp_tokens').get()).toEqual({ n: 1 })
  })

  test('can be taken back', async () => {
    const key = await connector()
    await call(env, '/v1/mcp/token', { token, method: 'DELETE' })

    expect((await rpc(key, 'tools/list')).status).toBe(401)
  })

  test('needs a session to ask for', async () => {
    expect((await call(env, '/v1/mcp/token', { body: {} })).status).toBe(401)
  })

  test('dies with the session it was handed out through', async () => {
    const other = await signIn(env, 'a@b.dev')
    const made = await call(env, '/v1/mcp/token', { token: other, body: { readOnly: false } })
    const key = made.json.token
    expect((await call(env, '/v1/spaces', { token: key })).status).toBe(200)

    await call(env, '/v1/sessions', { method: 'DELETE', token })
    expect((await call(env, '/v1/me', { token: other })).status).toBe(401)
    expect((await call(env, '/v1/spaces', { token: key })).status).toBe(401)
    expect((await call(env, '/v1/mcp/token', { token })).json.exists).toBe(false)

    const kept = await connector(false)
    expect((await call(env, '/v1/spaces', { token: kept })).status).toBe(200)
  })

  test('a token handed out before it named a session keeps working', async () => {
    const other = await signIn(env, 'a@b.dev')
    const made = await call(env, '/v1/mcp/token', { token: other, body: { readOnly: false } })
    const key = made.json.token
    env.db.exec('update mcp_tokens set session_hash = null')

    await call(env, '/v1/sessions', { method: 'DELETE', token })
    expect((await call(env, '/v1/spaces', { token: key })).status).toBe(200)
  })
})

describe('the connector', () => {
  test('refuses a caller with no token', async () => {
    expect((await call(env, '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status).toBe(401)
  })

  test('refuses a token that was never issued', async () => {
    expect((await rpc('nib_madeup', 'ping')).status).toBe(401)
  })

  test('introduces itself', async () => {
    const response = await rpc(await connector(), 'initialize')

    expect(response.json.result.serverInfo.name).toBe('orden')
    expect(response.json.result.capabilities.tools).toBeDefined()
  })

  test('lists its tools', async () => {
    const response = await rpc(await connector(), 'tools/list')
    const names = response.json.result.tools.map((entry: { name: string }) => entry.name)

    expect(names).toContain('list_spaces')
    expect(names).toContain('read_note')
    expect(names).toContain('write_note')
  })

  test('answers a notification with no body', async () => {
    const response = await rpc(await connector(), 'notifications/initialized')
    expect(response.status).toBe(202)
  })

  test('says so for a method it does not have', async () => {
    const response = await rpc(await connector(), 'tools/nonsense')
    expect(response.json.error.code).toBe(-32601)
  })
})

describe('reading notes through it', () => {
  test('lists the spaces', async () => {
    expect(await tool(await connector(), 'list_spaces')).toContain('Work')
  })

  test('lists the notes in one', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Work' })).toContain('plan.md')
  })

  test('takes a space id as readily as a name', async () => {
    expect(await tool(await connector(), 'list_notes', { space })).toContain('plan.md')
  })

  test('reads a note', async () => {
    expect(await tool(await connector(), 'read_note', { space: 'Work', path: 'plan.md' })).toContain('Ship the thing.')
  })

  test('searches across the account', async () => {
    expect(await tool(await connector(), 'search_notes', { query: 'ship' })).toContain('plan.md')
    expect(await tool(await connector(), 'search_notes', { query: 'ship '.repeat(201) })).toBe(
      'A search is at most 1000 characters.',
    )
  })

  test('says plainly when a space is not there', async () => {
    expect(await tool(await connector(), 'list_notes', { space: 'Nowhere' })).toContain('No space')
  })

  test('refuses a path that climbs out of the space', async () => {
    const text = await tool(await connector(), 'read_note', {
      space: 'Work',
      path: '../../etc/passwd',
    })
    expect(text).toContain('not a note path')
  })
})

describe('the notes that link to one note', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('are found by name, by path and in either spelling', async () => {
    await addNote('one.md', 'see [[plan]] now\n')
    await addNote('two.md', 'and [the plan](plan.md)\n')
    await addNote('three.md', 'nothing to do with it\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })

    expect(text).toContain('one.md:1')
    expect(text).toContain('two.md:1')
    expect(text).not.toContain('three.md')
  })

  test('say which line each one is on', async () => {
    await addNote('one.md', '# One\n\nsome words\n\nsee [[plan]]\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('one.md:5')
  })

  test('a path from the top of the space names only the note there', async () => {
    await addNote('one.md', 'see [[/plan]]\n')
    await addNote('two.md', 'see [[/notes/plan]]\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('one.md:1')
    expect(text).not.toContain('two.md')
  })

  test('a note nothing links to says so', async () => {
    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('Nothing links to plan.md')
  })

  test('a link inside code is not a link', async () => {
    await addNote('one.md', 'write `[[plan]]` to link\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'plan.md',
    })
    expect(text).toContain('Nothing links to')
  })

  test('a path nobody could have is refused rather than searched for', async () => {
    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: '../../etc/passwd',
    })
    expect(text).toContain('not a note path')
  })

  test('it is offered to the model like every other tool', async () => {
    const listed = await rpc(await connector(), 'tools/list')
    expect(listed.json.result.tools.map((one) => one.name)).toContain('list_backlinks')
  })
})

describe('what a tool is given', () => {
  test('a space nobody named is asked for in words', async () => {
    const key = await connector()

    expect(await tool(key, 'list_notes')).toContain('Which space')
    expect(await tool(key, 'read_note', { path: 'plan.md' })).toContain('Which space')
    expect(await tool(key, 'list_notes', { space: '  ' })).toContain('Which space')
  })

  test('an argument of the wrong kind is said to be one', async () => {
    const key = await connector()

    expect(await tool(key, 'list_notes', { space: 5 })).toContain('name or an id')
    expect(await tool(key, 'read_note', { space: 'Work', path: { a: 1 } })).toContain('not a note path')
    expect(await tool(key, 'search_notes', { query: [] })).toContain('has to be text')
  })

  test('a tool nobody has is named back', async () => {
    expect(await tool(await connector(), 'drop_everything')).toContain('No tool called')
  })

  test('a request that is not one is refused', async () => {
    const key = await connector()

    expect((await call(env, '/mcp', { token: key, body: [] })).status).toBe(400)
    expect((await call(env, '/mcp', { token: key, body: null })).status).toBe(400)
    expect((await call(env, '/mcp', { token: key, body: { jsonrpc: '2.0', id: 1 } })).status).toBe(400)
  })

  test('an id that is not one is answered as none', async () => {
    const response = await rpc(await connector(), 'ping')
    expect(response.json.id).toBe(1)

    const odd = await call<RpcView>(env, '/mcp', {
      token: await connector(),
      body: { jsonrpc: '2.0', id: { nested: true }, method: 'ping' },
    })
    expect(odd.json.id).toBeNull()
  })
})

describe('writing through it', () => {
  test('is refused while the token is read-only', async () => {
    const text = await tool(await connector(true), 'write_note', {
      space: 'Work',
      path: 'new.md',
      content: 'hello',
    })

    expect(text).toContain('only read')
  })

  test('creates a note when the token allows it', async () => {
    const key = await connector(false)
    expect(await tool(key, 'write_note', { space: 'Work', path: 'new.md', content: 'hello' })).toContain('Saved')

    expect(await tool(key, 'read_note', { space: 'Work', path: 'new.md' })).toBe('hello')
  })

  test('and a model writing one note over and over keeps a version a few minutes', async () => {
    const key = await connector(false)
    for (let round = 0; round < 20; round++) {
      await tool(key, 'write_note', { space: 'Work', path: 'plan.md', content: `round ${round}` })
    }

    const kept = env.db
      .prepare(
        `select v.hash as hash, v.device as device from note_versions v
           join notes n on n.id = v.note_id where n.path = 'plan.md' order by v.at`,
      )
      .all() as { hash: string; device: string | null }[]
    expect(kept.length).toBeLessThan(4)
    expect(kept.at(-1)?.device).toMatch(/^program:[0-9a-f]{16}$/)
  })

  test('replaces one that is already there', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'plan.md', content: 'replaced' })

    expect(await tool(key, 'read_note', { space: 'Work', path: 'plan.md' })).toBe('replaced')
  })

  test('goes to the account’s own space when somebody else’s has the same name', async () => {
    const stranger = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: stranger, body: { name: 'WORK' } })
    await call(env, `/v1/spaces/${theirs.json.space.id}/share/invite`, {
      token: stranger,
      body: { email: 'a@b.dev', role: 'write' },
    })

    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'secret.md', content: 'mine' })

    const own = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    expect(own.json.notes.map((note: { path: string }) => note.path)).toContain('secret.md')

    const leaked = await call(env, `/v1/spaces/${theirs.json.space.id}/changes?since=0`, {
      token: stranger,
    })
    expect(leaked.json.notes).toEqual([])
  })

  test('and asks which, where two spaces it does not own share a name', async () => {
    for (const email of ['x@y.dev', 'z@y.dev']) {
      const stranger = await signIn(env, email)
      const theirs = await call(env, '/v1/spaces', { token: stranger, body: { name: 'Club' } })
      await call(env, `/v1/spaces/${theirs.json.space.id}/share/invite`, {
        token: stranger,
        body: { email: 'a@b.dev', role: 'write' },
      })
    }

    const text = await tool(await connector(false), 'write_note', {
      space: 'Club',
      path: 'note.md',
      content: 'hello',
    })
    expect(text).toContain('Name one by its id')
  })

  test('a written note reaches the syncing clients', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'fresh.md', content: 'from the llm' })

    const changes = await call(env, `/v1/spaces/${space}/changes?since=0`, { token })
    const paths = changes.json.notes.map((note: { path: string }) => note.path)

    expect(paths).toContain('fresh.md')
  })

  test('is refused once the account is full', async () => {
    const key = await connector(false)
    const owner = env.db.prepare('select id from users limit 1').get() as { id: string }
    env.db
      .prepare('insert into blobs (hash, user_id, size, type, created_at) values (?, ?, ?, ?, ?)')
      .run('a'.repeat(64), owner.id, QUOTA, 'image/png', 1)

    const text = await tool(key, 'write_note', {
      space: 'Work',
      path: 'big.md',
      content: 'x'.repeat(100),
    })

    expect(text).toContain('out of space')
    expect(await tool(key, 'list_notes', { space: 'Work' })).not.toContain('big.md')
  })

  test('counts what it writes in bytes', async () => {
    const key = await connector(false)
    await tool(key, 'write_note', { space: 'Work', path: 'emoji.md', content: '🙂' })

    const row = env.db.prepare('select size from notes where path = ?').get('emoji.md') as {
      size: number
    }
    expect(row.size).toBe(4)
  })

  test('one account cannot reach another', async () => {
    const otherToken = await signIn(env, 'other@b.dev')
    const otherKey = await call(env, '/v1/mcp/token', {
      token: otherToken,
      body: { readOnly: false },
    })

    expect(await tool(otherKey.json.token, 'list_spaces')).toBe('Notes')
    expect(await tool(otherKey.json.token, 'read_note', { space: 'Work', path: 'plan.md' })).toContain('No space')
  })
})

describe('answers that stop short', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('a search that stops before the last note says it did not read them all', async () => {
    for (let at = 0; at < 305; at++) {
      await addNote(`n${String(at).padStart(3, '0')}.md`, `plain ${at}\n`)
    }
    await addNote('zz.md', 'the needleword lives here\n')

    const text = await tool(await connector(), 'search_notes', { query: 'needleword' })
    expect(text).not.toBe('Nothing found.')
    expect(text).toMatch(/not searched|stopped/i)
  })
})

describe('two spaces of one name', () => {
  test('a write asks which when the account owns both', async () => {
    const second = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const ids = [space, second.json.space.id]

    const said = await tool(await connector(false), 'write_note', {
      space: 'Work',
      path: 'x.md',
      content: 'hello',
    })
    expect(said).not.toMatch(/^Saved/)
    for (const id of ids) expect(said).toContain(id)
  })

  test('the list names each one by its id, so a shared one is reachable', async () => {
    const stranger = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: stranger, body: { name: 'Work' } })
    await call(env, `/v1/spaces/${theirs.json.space.id}/share/invite`, {
      token: stranger,
      body: { email: 'a@b.dev', role: 'write' },
    })

    const listed = await tool(await connector(), 'list_spaces')
    expect(listed).toContain(space)
    expect(listed).toContain(theirs.json.space.id)
    expect(listed.split('\n')).toContain('Notes')
  })
})

describe('relative markdown links', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('are read from the folder of the note they are in', async () => {
    await addNote('ideas/plan.md', '# Plan\n')
    await addNote('other/b.md', 'see [plan](../ideas/plan.md)\n')
    await addNote('ideas/c.md', 'see [plan](./plan.md)\n')
    await addNote('ideas/d.md', 'see [plan](plan.md)\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'ideas/plan.md',
    })
    expect(text).toContain('other/b.md:1')
    expect(text).toContain('ideas/c.md:1')
    expect(text).toContain('ideas/d.md:1')
  })

  test('one pointing at a note of the same name beside it is not counted', async () => {
    await addNote('ideas/plan.md', '# Plan\n')
    await addNote('other/plan.md', '# Other plan\n')
    await addNote('other/b.md', 'see [plan](plan.md)\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'ideas/plan.md',
    })
    expect(text).not.toContain('other/b.md')
  })
})

describe('markdown links the app reads from the top and by name', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('are found as the app finds them', async () => {
    await addNote('projects/roadmap.md', '# Plan\n')
    await addNote('daily/today.md', 'see [roadmap](projects/roadmap.md)\n')
    await addNote('daily/later.md', 'see [roadmap](roadmap.md)\n')
    await addNote('daily/gone.md', 'see [roadmap](../roadmap.md)\n')
    await addNote('daily/deep/typo.md', 'see [roadmap](./roadmap.md)\n')

    const text = await tool(await connector(), 'list_backlinks', {
      space: 'Work',
      path: 'projects/roadmap.md',
    })
    expect(text).toContain('daily/today.md:1')
    expect(text).toContain('daily/later.md:1')
    expect(text).not.toContain('typo.md')
  })
})

describe('a link by name with namesakes in folders of capitals', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('counts for the namesake beside it', async () => {
    await addNote('A/Sub/Plan.md', '# a\n')
    await addNote('Z/Sub/Plan.md', '# z\n')
    await addNote('Z/Sub/Index.md', 'see [plan](Sub/Plan.md)\n')
    const key = await connector()
    const near = await tool(key, 'list_backlinks', { space: 'Work', path: 'Z/Sub/Plan.md' })
    const far = await tool(key, 'list_backlinks', { space: 'Work', path: 'A/Sub/Plan.md' })
    expect(near).toContain('Z/Sub/Index.md:1')
    expect(far).not.toContain('Z/Sub/Index.md')
  })
})

describe('a wikilink by name with namesakes', () => {
  async function addNote(path: string, content: string) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  test('counts only for the note the app opens', async () => {
    await addNote('A/Plan.md', '# a\n')
    await addNote('B/Plan.md', '# b\n')
    await addNote('A/Index.md', 'see [[Plan]]\n')
    await addNote('C/Index.md', 'see [[Plan#Goals|the plan]]\n')
    const key = await connector()
    const beside = await tool(key, 'list_backlinks', { space: 'Work', path: 'A/Plan.md' })
    const other = await tool(key, 'list_backlinks', { space: 'Work', path: 'B/Plan.md' })
    const top = await tool(key, 'list_backlinks', { space: 'Work', path: 'plan.md' })
    expect(beside).toContain('A/Index.md:1')
    expect(other).not.toContain('A/Index.md')
    expect(top).toContain('C/Index.md:1')
    expect(beside).not.toContain('C/Index.md')
  })

  test('a path in it, from the top or not, names the note there', async () => {
    await addNote('A/Plan.md', '# a\n')
    await addNote('B/Plan.md', '# b\n')
    await addNote('A/Index.md', 'see [[B/Plan]]\n')
    await addNote('Z/Index.md', 'see [[/b/plan.md]]\n')
    const key = await connector()
    const other = await tool(key, 'list_backlinks', { space: 'Work', path: 'B/Plan.md' })
    expect(other).toContain('A/Index.md:1')
    expect(other).toContain('Z/Index.md:1')
    expect(await tool(key, 'list_backlinks', { space: 'Work', path: 'A/Plan.md' })).toContain('Nothing links to')
  })

  test('names in either form of an accent are one name', async () => {
    await addNote('Cafe\u0301.md', '# cafe\n')
    await addNote('Index.md', 'see [[Caf\u00e9]]\n')
    const key = await connector()
    expect(await tool(key, 'list_backlinks', { space: 'Work', path: 'Cafe\u0301.md' })).toContain('Index.md:1')
  })
})

describe('lists past the most read', () => {
  function filler(count: number) {
    const insert = env.db.prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind)
       values (?, ?, ?, ?, 1, 1, 0, 0, '', 'note')`,
    )
    for (let at = 0; at < count; at++) {
      insert.run(`f${at}`, space, `filler/f${String(at).padStart(4, '0')}.md`, 5000 + at)
    }
  }

  test('say when they stopped', async () => {
    filler(1000)
    const key = await connector()
    expect(await tool(key, 'list_notes', { space: 'Work' })).toMatch(/stopped/i)
    expect(await tool(key, 'list_backlinks', { space: 'Work', path: 'plan.md' })).toMatch(/stopped/i)
  })
})

describe('notifications', () => {
  test('any of them is answered with no body', async () => {
    const response = await call(env, '/mcp', {
      token: await connector(),
      body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    })
    expect(response.status).toBe(202)
  })
})
