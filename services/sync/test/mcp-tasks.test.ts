import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { taskHash } from '@orden/bases'
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
  env.db
    .prepare("update notes set meta = ? where space_id = ? and path in ('Thesis.md', 'Shop.md')")
    .run('{"todo-list":"yes"}', space)
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

const read = async (key: string, path: string) => tool(key, 'read_note', { space: 'Work', path })

describe('the to-dos, with Orden closed', () => {
  test("a todo ticked or moved through the connector keeps its done day in its list's metadata", async () => {
    const key = await connector()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Errands.md', content: '- [x] Post the letter\n' },
    })
    const posted = taskHash('Post the letter')
    env.db
      .prepare("update notes set meta = ? where space_id = ? and path = 'Errands.md'")
      .run(JSON.stringify({ 'todo-list': 'yes', 'done-on': `${posted}:20200101` }), space)
    const metaOf = async (path: string) => {
      const id = (env.db.prepare('select id from notes where path = ?').get(path) as { id: string })
        .id
      const page = await call(env, `/v2/spaces/${space}/feed?since=0`, { token })
      const items = (page.json as unknown as { items: { id: string; meta?: object }[] }).items
      return items.find((one) => one.id === id)?.meta as Record<string, string> | undefined
    }

    await json(key, 'update_task', {
      space: 'Work',
      at: `Shop.md#1:${taskHash('Milk')}`,
      done: true,
    })
    const day = today.replace(/-/g, '')
    expect((await metaOf('Shop.md'))?.['done-on']).toBe(`${taskHash('Milk')}:${day}`)

    await json(key, 'update_task', {
      space: 'Work',
      at: `Errands.md#0:${posted}`,
      move_to: { note: 'Shop' },
    })
    expect(await read(key, 'Shop.md')).toContain('- [x] Post the letter')
    expect((await metaOf('Shop.md'))?.['done-on']).toContain(`${posted}:20200101`)
    expect((await metaOf('Shop.md'))?.['done-on']).toContain(`${taskHash('Milk')}:${day}`)

    await tool(key, 'write_note', {
      space: 'Work',
      path: 'Thesis.md',
      content: `# Thesis\n- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [x] Outline\n- [ ] Read 🔁 every day 📅 ${today}\n`,
    })
    expect((await metaOf('Thesis.md'))?.['done-on']).toBe(`${taskHash('Outline')}:${day}`)
  })

  test('a limit is a whole number of tasks, one or more', async () => {
    const key = await connector()
    await tool(key, 'add_task', { space: 'Work', note: 'one.md', text: 'first' })
    await tool(key, 'add_task', { space: 'Work', note: 'one.md', text: 'second' })
    for (const limit of [-1, 0, 1.5, 'two']) {
      expect(await tool(key, 'list_tasks', { limit })).toContain('limit is a whole number')
    }
    expect((await json(key, 'list_tasks', { limit: 1 })).tasks).toHaveLength(1)
  })

  test('are listed with the tools', async () => {
    const response = await call<RpcView>(env, '/mcp', {
      token: await connector(),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    const names = response.json.result.tools.map((one: { name: string }) => one.name)
    expect(names).toEqual(
      expect.arrayContaining(['list_tasks', 'add_task', 'update_task', 'query_base', 'add_row']),
    )
  })

  test('Today, and a Todoist filter', async () => {
    const key = await connector(true)
    const listed = await json(key, 'list_tasks', { view: 'today' })
    expect(listed.tasks.map((one) => one.text)).toEqual(['Write the intro', 'Read'])
    const writing = await json(key, 'list_tasks', { filter: '#writing' })
    expect(writing.tasks).toMatchObject([{ text: 'Write the intro', space: 'Work', priority: 2 }])
  })

  test('Today with the tasks that have no start date, where the account says so (#408)', async () => {
    const key = await connector(true)
    await call(env, '/v1/settings', { method: 'PATCH', token, body: { undatedInToday: true } })
    const listed = await json(key, 'list_tasks', { view: 'today' })
    expect(listed.tasks.map((one) => one.text)).toEqual([
      'Write the intro',
      'Milk',
      'Outline',
      'Read',
    ])
  })

  test("a task added to the space's inbox, Orden's own, made the first time", async () => {
    const key = await connector()
    const added = await json(key, 'add_task', {
      space: 'Work',
      text: 'Call the bank 📅 2026-10-06',
    })
    expect(added.at).toMatch(/^\.Inbox\.md#0:/)
    expect(await read(key, '.Inbox.md')).toBe('- [ ] Call the bank 📅 2026-10-06\n')
    expect(await read(key, 'Inbox.md')).not.toContain('Call the bank')
    const { tasks } = await json(key, 'list_tasks', { space: 'Work', view: 'inbox' })
    expect(tasks.map((one) => one.text)).toEqual(['Call the bank'])

    await json(key, 'add_task', { space: 'Work', text: 'Post the letter', note: 'Inbox' })
    expect(await read(key, '.Inbox.md')).toBe(
      '- [ ] Call the bank 📅 2026-10-06\n- [ ] Post the letter\n',
    )
    expect(await read(key, 'Inbox.md')).not.toContain('Post the letter')

    const { tasks: inbox } = await json(key, 'list_tasks', { space: 'Work', view: 'inbox' })
    const letter = inbox.find((one) => one.text === 'Post the letter')
    const moved = await json(key, 'update_task', {
      space: 'Work',
      at: letter?.at,
      move_to: { note: 'Shop' },
    })
    expect(await read(key, 'Shop.md')).toContain('- [ ] Post the letter')
    expect(await read(key, '.Inbox.md')).not.toContain('Post the letter')
    await json(key, 'update_task', { space: 'Work', at: moved.at, move_to: { note: 'Inbox' } })
    expect(await read(key, '.Inbox.md')).toContain('- [ ] Post the letter')
    expect(await read(key, 'Shop.md')).not.toContain('Post the letter')
    expect(await read(key, 'Inbox.md')).not.toContain('Post the letter')

    await json(key, 'add_task', {
      space: 'Work',
      text: 'Eggs',
      note: 'Shop',
      fields: { priority: 1 },
    })
    expect(await read(key, 'Shop.md')).toBe('# Shop\n- [ ] Milk\n- [ ] Eggs 🔺\n')
  })

  test('a recurring task ticked writes its next line, a task moved takes its sub-task', async () => {
    const key = await connector()
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    const recurring = tasks.find((one) => one.text === 'Read')
    const ticked = await json(key, 'update_task', { space: 'Work', at: recurring?.at, done: true })
    expect(ticked.next).toMatch(/^Thesis\.md#3:/)
    const after = (await read(key, 'Thesis.md')).split('\n')
    expect(after[3]).toMatch(/^- \[ \] Read 🔁 every day 📅 /)
    expect(after[4]).toBe(`- [x] Read 🔁 every day 📅 ${today}`)

    const intro = tasks.find((one) => one.text === 'Write the intro')
    await json(key, 'update_task', { space: 'Work', at: intro?.at, move_to: { note: 'Shop' } })
    expect(await read(key, 'Shop.md')).toBe(
      `# Shop\n- [ ] Milk\n- [ ] Write the intro #writing ⏫ 📅 ${today}\n  - [ ] Outline\n`,
    )
    expect(await read(key, 'Thesis.md')).not.toContain('Outline')
  })

  test('refused in sentences: a token that only reads, an anchor that is gone, a bad date', async () => {
    expect(await tool(await connector(true), 'add_task', { space: 'Work', text: 'x' })).toContain(
      'only read',
    )
    const key = await connector()
    expect(
      await tool(key, 'update_task', { space: 'Work', at: 'Thesis.md#1:zzz', done: true }),
    ).toContain('not in the note any more')
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    expect(
      await tool(key, 'update_task', { space: 'Work', at: tasks[0]?.at, due: 'soon' }),
    ).toContain('YYYY-MM-DD')
    expect(await tool(key, 'list_tasks', { space: 'Nowhere' })).toContain('No space')
  })

  test('a checkbox in a note that is no to-do list is never a to-do, and takes none (#1229)', async () => {
    const key = await connector()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Meeting.md', content: '- [ ] Ask about the budget\n' },
    })
    const { tasks } = await json(key, 'list_tasks', { space: 'Work' })
    expect(tasks.map((one) => one.text)).not.toContain('Ask about the budget')
    expect(await tool(key, 'add_task', { space: 'Work', note: 'Meeting', text: 'x' })).toContain(
      'not a to-do list',
    )
    const made = await json(key, 'add_task', { space: 'Work', note: 'Errands', text: 'Post it' })
    expect(made.path).toBe('Projects/Errands.md')
    const again = await json(key, 'list_tasks', { space: 'Work' })
    expect(again.tasks.map((one) => one.text)).toContain('Post it')
  })

  test('a Projects note from before lists were marked is one until a device marks the space (#1370)', async () => {
    const key = await connector()
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Projects/Garden.md', content: '- [ ] Plant the tulips\n' },
    })
    const texts = async () =>
      (await json(key, 'list_tasks', { space: 'Work' })).tasks.map((one) => one.text)
    expect(await texts()).toContain('Plant the tulips')
    const made = await json(key, 'add_task', { space: 'Work', note: 'Garden', text: 'Buy soil' })
    expect(made.path).toBe('Projects/Garden.md')

    await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
    env.db
      .prepare("update folders set meta = ? where space_id = ? and name = 'Projects'")
      .run('{"todo-lists":"marked"}', space)
    expect(await texts()).not.toContain('Plant the tulips')
  })

  test('a Projects folder chosen in Settings, marked at any depth, marks the space and holds new lists', async () => {
    const key = await connector()
    for (const [path, content] of [
      ['Projects/Garden.md', '- [ ] Plant the tulips\n'],
      ['Areas/Plans/Trip.md', '- [ ] Book the train\n'],
    ]) {
      await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
    }
    await call(env, `/v2/spaces/${space}/prepare`, { token, method: 'POST' })
    env.db
      .prepare("update notes set meta = ? where space_id = ? and path = 'Areas/Plans/Trip.md'")
      .run('{"todo-list":"yes"}', space)
    env.db
      .prepare("update folders set meta = ? where space_id = ? and name = 'Plans'")
      .run('{"todo-lists":"marked"}', space)

    const texts = (await json(key, 'list_tasks', { space: 'Work' })).tasks.map((one) => one.text)
    expect(texts).toContain('Book the train')
    expect(texts).not.toContain('Plant the tulips')
    const made = await json(key, 'add_task', { space: 'Work', note: 'Errands', text: 'Post it' })
    expect(made.path).toBe('Areas/Plans/Errands.md')
    const again = await json(key, 'list_tasks', { space: 'Work' })
    expect(again.tasks.map((one) => one.text)).toContain('Post it')
  })

  test('a note made a to-do list by its path and a note again, as a device hears it', async () => {
    const key = await connector()
    await call(env, '/v2/push/targets', {
      token,
      body: { kind: 'fcm', token: 'phone-token', zone: 'Europe/Zurich' },
    })
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: {
        path: 'Meeting.md',
        content: '- [ ] Ask about the budget [remind:: 2099-01-05 09:00]\n- [ ] Book a room\n',
      },
    })
    const id = (
      env.db.prepare("select id from notes where path = 'Meeting.md'").get() as { id: string }
    ).id
    const texts = async () =>
      (await json(key, 'list_tasks', { space: 'Work' })).tasks.map((one) => one.text)
    const heard = async () => {
      const page = await call(env, `/v2/spaces/${space}/feed?since=0`, { token })
      const items = (page.json as unknown as { items: { id: string; meta?: object }[] }).items
      return items.find((one) => one.id === id)?.meta
    }
    const reminders = () => env.db.prepare('select id from push_reminders').all().length

    expect(await texts()).not.toContain('Ask about the budget')
    expect(reminders()).toBe(0)
    const room = `Meeting.md#1:${taskHash('Book a room')}`
    expect(
      await json(key, 'update_task', { space: 'Work', at: room, done: true, todo_list: true }),
    ).toMatchObject({ at: room, path: 'Meeting.md', todo_list: true, space: 'Work' })
    expect(await read(key, 'Meeting.md')).toContain('- [x] Book a room')
    expect(await texts()).toContain('Ask about the budget')
    expect(await heard()).toEqual({ 'todo-list': 'yes' })
    expect(reminders()).toBe(1)

    expect(
      await json(key, 'update_task', { space: 'Work', at: 'Meeting', todo_list: false }),
    ).toEqual({ path: 'Meeting.md', todo_list: false, space: 'Work' })
    expect(await texts()).not.toContain('Ask about the budget')
    expect(await heard()).toEqual({ 'todo-list': 'no' })
    expect(reminders()).toBe(0)

    expect(
      await tool(key, 'update_task', { space: 'Work', at: '.Inbox.md', todo_list: false }),
    ).toContain('always a to-do list')
    expect(
      await tool(key, 'update_task', { space: 'Work', at: 'Nowhere', todo_list: true }),
    ).toContain('No note at Nowhere.md')
    expect(
      await tool(await connector(true), 'update_task', {
        space: 'Work',
        at: 'Shop',
        todo_list: false,
      }),
    ).toContain('only read')
  })

  test('a space shared to read is listed and never written', async () => {
    const owner = await signIn(env, 'x@y.dev')
    const theirs = await call(env, '/v1/spaces', { token: owner, body: { name: 'Club' } })
    const id = theirs.json.space.id
    await call(env, `/v1/spaces/${id}/notes`, {
      token: owner,
      body: { path: 'Club.md', content: '- [ ] Meet\n' },
    })
    env.db.prepare('update notes set meta = ? where space_id = ?').run('{"todo-list":"yes"}', id)
    await call(env, `/v1/spaces/${id}/share/invite`, {
      token: owner,
      body: { email: 'a@b.dev', role: 'read' },
    })

    const key = await connector()
    const listed = await tool(key, 'list_tasks', { space: 'Club' })
    const inside = /^<untrusted source="shared space Club">\n(.*)\n<\/untrusted>$/s.exec(listed)
    expect(JSON.parse(inside?.[1] ?? 'null').tasks).toMatchObject([{ text: 'Meet' }])
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
  test('a view queried, and a row added in the folder it looks in', async () => {
    await baseFile('Books.base', BOOKS)
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
    expect(await json(await connector(true), 'query_base', { space: 'Work', yaml })).toMatchObject({
      total: 1,
    })
  })
})
