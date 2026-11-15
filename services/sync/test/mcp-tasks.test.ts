import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'
import { running } from './room'
import { type InboxPage, inboxPageOf } from '@orden/sync-core'

let env: TestEnv
let token: string
let space: string

const today = new Date().toISOString().slice(0, 10)

beforeEach(async () => {
  env = testEnv()
  env.ROOMS = running(env).ROOMS
  token = await signIn(env, 'a@b.dev')
  const created = await call(env, '/v1/spaces', { token, body: { name: 'Work' } })
  space = created.json.space.id

  const notes: [string, string][] = [
    [
      'Thesis.md',
      `# Thesis\n- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [ ] Outline\n- [ ] Read 🔁 every day 📅 ${today}\n`,
    ],
    ['Shop.md', '# Shop\n- [ ] Milk\n'],
    ['Books/Dune.md', '---\nstatus: reading\n---\n'],
  ]
  for (const [path, content] of notes) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }
})

afterEach(() => env.close())

async function baseFile(path: string, yaml: string) {
  const hash = 'b'.repeat(64)
  await env.NOTES.put(`blobs/${hash}`, yaml)
  env.db
    .prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind)
       values ('base-1', ?, ?, 99, 1, 1, 0, ?, ?, 'file')`,
    )
    .run(space, path, yaml.length, hash)
}

async function connector(readOnly = false): Promise<string> {
  const made = await call(env, '/v1/mcp/token', { token, body: { readOnly } })
  return made.json.token
}

async function tool(key: string, name: string, args: Record<string, unknown> = {}) {
  const response = await call<RpcView>(env, '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  })
  return response.json.result.content[0]?.text ?? ''
}

async function json(key: string, name: string, args: Record<string, unknown> = {}) {
  return JSON.parse(await tool(key, name, args)) as Record<string, unknown> & {
    todos: { id: string; title: string; space: string | null }[]
  }
}

async function basesTurned(on: boolean) {
  await call(env, '/v1/settings', {
    method: 'PATCH',
    token,
    body: { hiddenKinds: on ? ['experimental', 'experimental-bases'] : null },
  })
}

const read = async (key: string, path: string) => tool(key, 'read_note', { space: 'Work', path })

describe('the todos, with Orden closed', () => {
  test('a todo added, listed, changed and ticked through the connector, never a note', async () => {
    const key = await connector()
    const added = await json(key, 'add_task', {
      title: 'Call the bank',
      space: 'Work',
      deadline: '2026-10-06',
      priority: 3,
      labels: ['money'],
    })
    expect(added).toMatchObject({
      title: 'Call the bank',
      space,
      deadline: '2026-10-06',
      priority: 3,
      labels: ['money'],
      done: false,
    })
    const id = added.id as string
    await json(key, 'add_task', { title: 'Post the letter' })
    expect((await json(key, 'list_tasks', {})).todos).toMatchObject([
      { id, title: 'Call the bank' },
      { title: 'Post the letter', space: null },
    ])
    expect((await json(key, 'list_tasks', { space: 'Work' })).todos).toHaveLength(1)
    expect((await json(key, 'list_tasks', { label: 'money' })).todos).toHaveLength(1)
    expect(await json(key, 'update_task', { id, done: true, priority: 1 })).toMatchObject({
      done: true,
      priority: 1,
    })
    expect((await json(key, 'list_tasks', {})).todos.map((one) => one.title)).toEqual([
      'Post the letter',
    ])
    expect((await json(key, 'list_tasks', { done: true })).total).toBe(2)
    expect(await read(key, 'Inbox.md')).not.toContain('Call the bank')
    const rows = env.db.prepare('select id, fields from inbox_items').all() as {
      id: string
      fields: string
    }[]
    expect(rows.map((one) => one.id)).toContain(id)
  })

  test('refused in sentences: a token that only reads, a todo that is gone, a bad day, no title', async () => {
    expect(await tool(await connector(true), 'add_task', { title: 'No' })).toMatch(/only read/)
    const key = await connector()
    expect(await tool(key, 'update_task', { id: 'nothing', done: true })).toBe(
      'There is no todo nothing.',
    )
    expect(await tool(key, 'add_task', { title: 'Soon', deadline: 'tomorrow' })).toBe(
      'deadline is a day as YYYY-MM-DD.',
    )
    expect(await tool(key, 'add_task', { title: '  ' })).toBe('A todo needs a title.')
    expect(await tool(key, 'list_tasks', { limit: 0 })).toMatch(/whole number/)
  })

  test('a change that leaves labels or the title as null keeps them as they were', async () => {
    const key = await connector()
    const added = await json(key, 'add_task', {
      title: 'Call the bank',
      space: 'Work',
      labels: ['work'],
    })
    const changed = await json(key, 'update_task', {
      id: added.id,
      done: true,
      labels: null,
      title: null,
    })

    expect(changed).toMatchObject({ title: 'Call the bank', labels: ['work'], done: true })
    expect(await json(key, 'update_task', { id: added.id, labels: 'money' })).toMatchObject({
      labels: ['work'],
    })
  })

  test('are listed with the tools, and the base tools only once databases are turned on', async () => {
    const key = await connector()
    const names = async () => {
      const response = await call<{ result: { tools: { name: string }[] } }>(env, '/mcp', {
        token: key,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      })
      return response.json.result.tools.map((one) => one.name)
    }
    const before = await names()
    expect(before).toEqual(expect.arrayContaining(['list_tasks', 'add_task', 'update_task']))
    expect(before).not.toContain('query_base')
    await basesTurned(true)
    expect(await names()).toEqual(expect.arrayContaining(['query_base', 'add_row']))
  })
})

const BOOKS = [
  'filters: file.inFolder("Books")',
  'views:',
  '  - type: table',
  '    name: All',
  '',
].join('\n')

describe('bases, with Orden closed', () => {
  test('refused while databases are off, and the base left as it was', async () => {
    await baseFile('Books.base', BOOKS)
    const key = await connector()
    const off = async (name: string, args: Record<string, unknown>) => {
      const response = await call<RpcView>(env, '/mcp', {
        token: key,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      })
      expect(response.json.result.isError).toBe(true)
      expect(response.json.result.content[0]?.text).toContain('Databases are turned off')
    }
    await off('query_base', { space: 'Work', path: 'Books.base' })
    await off('add_row', { space: 'Work', base: 'Books.base', title: 'Emma' })
    expect(await read(key, 'Books/Emma.md')).not.toContain('status')
    await basesTurned(true)
    expect(await json(key, 'query_base', { space: 'Work', path: 'Books.base' })).toMatchObject({
      total: 1,
    })
    await basesTurned(false)
    await off('query_base', { space: 'Work', path: 'Books.base' })
  })

  test('a view queried, and a row added in the folder it looks in', async () => {
    await baseFile('Books.base', BOOKS)
    await basesTurned(true)
    const key = await connector()
    expect(await json(key, 'query_base', { space: 'Work', path: 'Books.base' })).toMatchObject({
      total: 1,
      groups: [{ rows: [{ path: 'Books/Dune.md', status: 'reading' }] }],
    })
    expect(
      await json(key, 'add_row', {
        space: 'Work',
        base: 'Books.base',
        title: 'Emma',
        properties: { status: 'next' },
      }),
    ).toMatchObject({ path: 'Books/Emma.md', created: true })
    expect(await read(key, 'Books/Emma.md')).toBe('---\nstatus: next\n---\n')
  })

  test('a row added from a template is filled on the asker’s clock, the view’s template first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.UTC(2026, 9, 7, 20))
    try {
      env.db.prepare("update users set zone = 'Asia/Tokyo'").run()
      for (const [path, content] of [
        [
          'Templates/Book.md',
          '---\nstatus: new\nrepeat: every day\n---\n# {{title}}\n\nAdded {{date}} at {{time}}\n',
        ],
        ['Templates/Shelf.md', '# {{title}} on the shelf\n'],
      ]) {
        await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
      }
      await baseFile(
        'Books.base',
        [
          'filters: file.inFolder("Books")',
          'orden:',
          '  template: "[[Templates/Book]]"',
          'views:',
          '  - type: table',
          '    name: All',
          '  - type: cards',
          '    name: Shelf',
          '    orden:',
          '      template: "[[Templates/Shelf|shelf]]"',
          '',
        ].join('\n'),
      )
      await basesTurned(true)
      const key = await connector()
      await tool(key, 'add_row', { space: 'Work', base: 'Books.base', title: 'Emma' })
      expect(await read(key, 'Books/Emma.md')).toBe(
        '---\nstatus: new\n---\n# Emma\n\nAdded 2026-10-08 at 05:00\n',
      )
      await tool(key, 'add_row', {
        space: 'Work',
        base: 'Books.base',
        view: 'Shelf',
        title: 'Emma',
      })
      expect(await read(key, 'Books/Emma 2.md')).toBe('# Emma 2 on the shelf\n')
    } finally {
      vi.useRealTimers()
    }
  })

  test('a row added from a template named by its name alone, as the app finds it', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Templates/Book.md', content: '# {{title}}\n' },
    })
    await baseFile(
      'Books.base',
      ['filters: file.inFolder("Books")', 'orden:', '  template: "[[book]]"', ''].join('\n'),
    )
    await basesTurned(true)
    const key = await connector()
    await tool(key, 'add_row', { space: 'Work', base: 'Books.base', title: 'Emma' })

    expect(await read(key, 'Books/Emma.md')).toBe('# Emma\n')
  })

  test('a template named by its name passes over a protected namesake, in any case of its letters', async () => {
    for (const [path, content] of [
      ['Diary/Ärzte.md', 'the secret words\n'],
      ['Templates/Ärzte.md', '# {{title}} visit\n'],
    ]) {
      await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
    }
    await call(env, `/v1/protected/spaces/${space}`, {
      method: 'PUT',
      token,
      body: { protected: { Diary: 'password' } },
    })
    await baseFile(
      'Visits.base',
      ['filters: file.inFolder("Visits")', 'orden:', '  template: "[[ärzte]]"', ''].join('\n'),
    )
    await basesTurned(true)
    const key = await connector()
    await tool(key, 'add_row', { space: 'Work', base: 'Visits.base', title: 'Anna' })

    expect(await read(key, 'Visits/Anna.md')).toBe('# Anna visit\n')
  })

  test('a row title or a note path is never a hidden note', async () => {
    await baseFile('Books.base', BOOKS)
    await basesTurned(true)
    const key = await connector()

    expect(
      await tool(key, 'add_row', { space: 'Work', base: 'Books.base', title: '.Secret' }),
    ).toMatch(/is hidden/)
    expect(
      await tool(key, 'write_note', { space: 'Work', path: '.hidden/x.md', content: 'hi' }),
    ).not.toMatch(/^Saved/)
    expect(
      await tool(key, 'write_note', { space: 'Work', path: 'a/.b.md', content: 'hi' }),
    ).not.toMatch(/^Saved/)
    expect(await tool(key, 'list_notes', { space: 'Work' })).not.toMatch(
      /\.Secret|\.hidden|\.b\.md/,
    )
  })

  test('a base said as yaml', async () => {
    const yaml = BOOKS.replace('file.inFolder("Books")', 'status == "reading"')
    await basesTurned(true)
    expect(await json(await connector(true), 'query_base', { space: 'Work', yaml })).toMatchObject({
      total: 1,
    })
  })

  test('a date written with its offset is read on the clock of the person asking', async () => {
    env.db.prepare("update users set zone = 'Asia/Tokyo'").run()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Trip.md', content: '---\nleaves: 2026-03-11T02:00:00+09:00\n---\n' },
    })
    await basesTurned(true)
    const answer = await json(await connector(true), 'query_base', {
      space: 'Work',
      yaml: 'filters: \'leaves.date() == date("2026-03-11") && leaves.hour == 2\'\n',
    })
    expect(answer).toMatchObject({ total: 1, groups: [{ rows: [{ path: 'Trip.md' }] }] })
  })
})

describe('limits a device holds the todos to', () => {
  async function devicesRead(): Promise<{ sent: number; read: number }> {
    const page = await call<InboxPage>(env, '/v2/inbox', { token, method: 'GET' })
    return { sent: page.json.items.length, read: inboxPageOf(page.json)?.items.length ?? -1 }
  }

  test('a todo too large for a device is refused rather than kept', async () => {
    const key = await connector(false)
    const long = await tool(key, 'add_task', { title: 'Plan', description: '漢'.repeat(6000) })
    const labels = Array.from({ length: 2000 }, (_, at) => `label-${at}`)
    const many = await tool(key, 'add_task', { title: 'Labels', labels })

    expect(long).toMatch(/too large/i)
    expect(many).toMatch(/too large/i)
    const { sent, read } = await devicesRead()
    expect(read).toBe(sent)
  })

  test('an update that would make a todo too large leaves it as it was', async () => {
    const key = await connector(false)
    const made = JSON.parse(await tool(key, 'add_task', { title: 'Plan' })) as { id: string }
    const said = await tool(key, 'update_task', { id: made.id, description: '漢'.repeat(6000) })

    expect(said).toMatch(/too large/i)
    const { sent, read } = await devicesRead()
    expect(read).toBe(sent)
    expect(sent).toBe(1)
  })
})

describe('a base over more notes than are read', () => {
  test('says it is partial', async () => {
    for (let at = 0; at < 2005; at++) {
      const hash = String(at).padStart(4, '0').padEnd(64, 'c')
      const text = '---\nkind: row\n---\n'
      await env.NOTES.put(`spaces/${space}/r${at}`, text)
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind)
           values (?, ?, ?, ?, 1, 1, 0, ?, ?, 'note')`,
        )
        .run(
          `r${at}`,
          space,
          `rows/r${String(at).padStart(4, '0')}.md`,
          1000 + at,
          text.length,
          hash,
        )
    }
    await basesTurned(true)

    const answer = await json(await connector(true), 'query_base', {
      space: 'Work',
      yaml: 'filters: \'kind == "row"\'\n',
    })
    expect(answer.partial).toBe(true)
  })
})
