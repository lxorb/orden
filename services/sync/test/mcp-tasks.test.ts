import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writeInboxText } from '../src/inbox-text'
import { call, type RpcView, signIn, testEnv, type TestEnv } from './harness'
import { running } from './room'

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
    tasks: { at: string; text: string }[]
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

async function inboxIs(text: string) {
  const user = (
    env.db.prepare('select user_id from spaces where id = ?').get(space) as { user_id: string }
  ).user_id
  await writeInboxText(env, user, text, today)
}

const THESIS = `- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [ ] Outline\n- [ ] Read 🔁 every day 📅 ${today}\n`

describe('the to-dos, with Orden closed', () => {
  test("the connector's days are the days of the account's time zone, not of UTC", async () => {
    const at = new Date()
    at.setUTCHours(23, 30, 0, 0)
    const next = (days: number) =>
      new Date(at.getTime() + days * 86_400_000).toISOString().slice(0, 10)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at)
    try {
      env.db.prepare('update users set zone = ?').run('Pacific/Auckland')
      const key = await connector()
      await inboxIs(`- [ ] Write the intro 📅 ${next(1)}\n`)

      const added = await json(key, 'add_task', { space: 'Work', text: 'Call mum tomorrow' })
      const line = (await read(key, added.path as string))
        .split('\n')
        .find((one) => one.includes('Call mum'))
      expect(line).toContain(next(2))

      const listed = await json(key, 'list_tasks', { view: 'today' })
      expect(listed.tasks.map((one) => one.text)).toContain('Write the intro')
    } finally {
      vi.useRealTimers()
    }
  })

  test('a task with no note goes to the account inbox, not a note once picked for it, and Inbox lists it (#1576)', async () => {
    const key = await connector()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Inbox.md', content: '- [ ] Call the bank\n' },
    })
    env.db
      .prepare("update notes set meta = ? where space_id = ? and path = 'Inbox.md'")
      .run('{"inbox":"yes"}', space)

    const added = await json(key, 'add_task', { space: 'Work', text: 'Water the plants' })
    expect(added.at).toMatch(/^\.orden-inbox\.md#/)
    expect(await read(key, 'Inbox.md')).not.toContain('Water the plants')
    expect(await read(key, '.orden-inbox.md')).toContain('- [ ] Water the plants')
    const inbox = await json(key, 'list_tasks', { space: 'Work', view: 'inbox' })
    expect(inbox.tasks.map((one) => one.text)).toEqual(['Water the plants'])
    const items = env.db.prepare('select count(*) as many from inbox_items').get() as {
      many: number
    }
    expect(items.many).toBe(1)
  })

  test('a limit is a whole number of tasks, one or more', async () => {
    const key = await connector()
    await tool(key, 'add_task', { space: 'Work', text: 'first' })
    await tool(key, 'add_task', { space: 'Work', text: 'second' })
    for (const limit of [-1, 0, 1.5, 'two']) {
      expect(await tool(key, 'list_tasks', { limit })).toContain('limit is a whole number')
    }
    expect((await json(key, 'list_tasks', { limit: 1 })).tasks).toHaveLength(1)
  })

  test('are listed with the tools, and the base tools only once databases are turned on', async () => {
    const key = await connector()
    const names = async () => {
      const response = await call<RpcView>(env, '/mcp', {
        token: key,
        body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      })
      return response.json.result.tools.map((one: { name: string }) => one.name)
    }
    const off = await names()
    expect(off).toEqual(expect.arrayContaining(['list_tasks', 'add_task', 'update_task']))
    expect(off).not.toContain('query_base')
    expect(off).not.toContain('add_row')
    await basesTurned(true)
    expect(await names()).toEqual(
      expect.arrayContaining(['list_tasks', 'add_task', 'update_task', 'query_base', 'add_row']),
    )
  })

  test('Today, and a Todoist filter', async () => {
    await inboxIs(THESIS)
    const key = await connector(true)
    await call(env, '/v1/settings', { method: 'PATCH', token, body: { undatedInToday: false } })
    const listed = await json(key, 'list_tasks', { view: 'today' })
    expect(listed.tasks.map((one) => one.text)).toEqual(['Write the intro', 'Read'])
    const writing = await json(key, 'list_tasks', { filter: '#writing' })
    expect(writing.tasks).toMatchObject([{ text: 'Write the intro', priority: 2 }])
  })

  test('Today with the tasks that have no start date, unless the account says not (#408, #2017)', async () => {
    await inboxIs(`${THESIS}- [ ] Milk\n`)
    const key = await connector(true)
    const undated = ['Write the intro', 'Outline', 'Read', 'Milk']
    const untouched = await json(key, 'list_tasks', { view: 'today' })
    expect(untouched.tasks.map((one) => one.text).sort()).toEqual([...undated].sort())
    await call(env, '/v1/settings', { method: 'PATCH', token, body: { undatedInToday: false } })
    const off = await json(key, 'list_tasks', { view: 'today' })
    expect(off.tasks.map((one) => one.text)).toEqual(['Write the intro', 'Read'])
    await call(env, '/v1/settings', { method: 'PATCH', token, body: { undatedInToday: true } })
    const on = await json(key, 'list_tasks', { view: 'today' })
    expect(on.tasks.map((one) => one.text).sort()).toEqual([...undated].sort())
  })

  test("a task added to the account's inbox, kept as records and read back as lines", async () => {
    const key = await connector()
    const added = await json(key, 'add_task', {
      space: 'Work',
      text: 'Call the bank 📅 2026-10-06',
    })
    expect(added.at).toMatch(/^\.orden-inbox\.md#0:/)
    expect(await read(key, '.orden-inbox.md')).toBe('- [ ] Call the bank 📅 2026-10-06\n')
    expect(await read(key, 'Inbox.md')).not.toContain('Call the bank')
    const { tasks } = await json(key, 'list_tasks', { space: 'Work', view: 'inbox' })
    expect(tasks.map((one) => one.text)).toEqual(['Call the bank'])

    await json(key, 'add_task', { space: 'Work', text: 'Post the letter', fields: { priority: 1 } })
    expect(await read(key, '.orden-inbox.md')).toBe(
      '- [ ] Call the bank 📅 2026-10-06\n- [ ] Post the letter 🔺\n',
    )
    expect(await read(key, 'Inbox.md')).not.toContain('Post the letter')
  })

  test('a recurring task ticked writes its next line, and its sub-task stays under it', async () => {
    await inboxIs(THESIS)
    const key = await connector()
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    const recurring = tasks.find((one) => one.text === 'Read')
    const ticked = await json(key, 'update_task', { space: 'Work', at: recurring?.at, done: true })
    expect(ticked.next).toMatch(/^\.orden-inbox\.md#2:/)
    const after = (await read(key, '.orden-inbox.md')).split('\n')
    expect(after[0]).toBe(`- [ ] Write the intro #writing ⏫ 📅 ${today}`)
    expect(after[1]).toBe('  - [ ] Outline')
    expect(after[2]).toMatch(/^- \[ \] Read 🔁 every day 📅 /)
    expect(after[3]).toMatch(/^- \[x\] Read 🔁 every day 📅 .* ✅ /)
  })

  test('refused in sentences: a token that only reads, an anchor that is gone, a bad date, a note', async () => {
    await inboxIs(THESIS)
    expect(await tool(await connector(true), 'add_task', { space: 'Work', text: 'x' })).toContain(
      'only read',
    )
    const key = await connector()
    expect(
      await tool(key, 'update_task', { space: 'Work', at: '.orden-inbox.md#1:zzz', done: true }),
    ).toContain('not in the note any more')
    expect(
      await tool(key, 'update_task', { space: 'Work', at: 'Thesis.md#1:zzz', done: true }),
    ).toContain('is a note')
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    expect(
      await tool(key, 'update_task', { space: 'Work', at: tasks[0]?.at, due: 'soon' }),
    ).toContain('YYYY-MM-DD')
    expect(await tool(key, 'list_tasks', { space: 'Nowhere' })).toContain('No space')
  })

  test('a checkbox in a note is never a to-do, and a task never lands in a note (#1229, #2103)', async () => {
    const key = await connector()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Meeting.md', content: '- [ ] Ask about the budget\n' },
    })
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    expect(tasks.map((one) => one.text)).not.toContain('Ask about the budget')
    expect(tasks.map((one) => one.text)).not.toContain('Milk')
    const made = await json(key, 'add_task', { space: 'Work', note: 'Meeting', text: 'Post it' })
    expect(made.path).toBe('.orden-inbox.md')
    expect(await read(key, 'Meeting.md')).toBe('- [ ] Ask about the budget\n')
    expect(await read(key, 'Shop.md')).toBe('# Shop\n- [ ] Milk\n')
  })

  test('a reminder is kept from the inbox, never from a checkbox in a note (#2103)', async () => {
    const key = await connector()
    await call(env, '/v2/push/targets', {
      token,
      body: { kind: 'fcm', token: 'phone-token', zone: 'Europe/Zurich' },
    })
    const reminders = () => env.db.prepare('select id from push_reminders').all().length
    await tool(key, 'write_note', {
      space: 'Work',
      path: 'Meeting.md',
      content: '- [ ] Ask about the budget [remind:: 2099-01-05 09:00]\n',
    })
    expect(reminders()).toBe(0)
    await json(key, 'add_task', { space: 'Work', text: 'Book a room [remind:: 2099-01-05 09:00]' })
    expect(reminders()).toBe(1)
  })

  test('a space shared to read is listed and never written', async () => {
    const owner = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: owner, body: { name: 'Club' } })
    const id = theirs.json.space.id
    await call(env, `/v1/spaces/${id}/notes`, {
      token: owner,
      body: { path: 'Club.md', content: '- [ ] Meet\n' },
    })
    await call(env, `/v1/spaces/${id}/share/invite`, {
      token: owner,
      body: { email: 'a@b.dev', role: 'read' },
    })

    const key = await connector()
    const listed = await tool(key, 'list_tasks', { space: 'Club' })
    const inside = /^<untrusted source="shared space Club">\n(.*)\n<\/untrusted>$/s.exec(listed)
    expect(JSON.parse(inside?.[1] ?? 'null').tasks).toEqual([])
    expect(await tool(key, 'add_task', { space: 'Club', text: 'Sneak' })).toContain(
      'shared with you to read',
    )
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

  test('a base said as yaml', async () => {
    const yaml = BOOKS.replace('file.inFolder("Books")', 'status == "reading"')
    await basesTurned(true)
    expect(await json(await connector(true), 'query_base', { space: 'Work', yaml })).toMatchObject({
      total: 1,
    })
  })
})
