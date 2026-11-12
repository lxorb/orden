import { afterEach, beforeEach, expect, test } from 'vitest'
import app from '../src'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

interface Core {
  spaces: Map<string, { outbox: unknown[]; entries: Map<string, { name: string }> }>
  held: Map<string, unknown>
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}

interface Device {
  root: string
  store: { rows(table: 'log'): { failed: string | null }[]; open(): unknown }
  disk: {
    bytes: Map<string, Uint8Array>
    files: Map<string, string>
    kept: unknown[]
    read(path: string): Promise<string | null>
    exists(path: string): Promise<boolean>
    readBytes(path: string): Promise<Uint8Array | null>
    writeBytes(path: string, bytes: Uint8Array): Promise<void>
    write(path: string, text: string): Promise<void>
    remove(path: string): Promise<void>
    mkdir(path: string): Promise<void>
    move(from: string, to: string): Promise<void>
  }
  engine: {
    core: Core & { world: unknown }
    pass(space: string): Promise<{ finished: boolean; full: boolean; pulled: number } | null>
    quit(): Promise<void>
    created(path: string, dir: boolean, text?: string): Promise<string | null>
    foreign(path: string): Promise<void>
    removed(path: string): Promise<void>
    moved(from: string, to: string): Promise<void>
    waiting(space: string): boolean
    stamped(path: string, mtime: number, size: number): Promise<void>
    stop(): void
    on(type: 'unsynced', listener: (event: { name: string }) => void): () => void
    held: {
      notes: readonly { id: string }[]
      answer(id: string, answer: string): Promise<string | undefined>
    }
  }
}

interface Kit {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    name?: string
    files?: Record<string, string | Uint8Array>
  }): Promise<Device>
  firstPass(core: Core, space: unknown, v1: unknown): Promise<boolean>
  mirrorsFrom(
    core: Core,
    listings: null,
  ): Promise<Record<string, { notes: Record<string, unknown> }>>
  Engine: { start(world: unknown, store: unknown): Promise<Device['engine']> }
}

async function kit(): Promise<Kit> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync-client/${file}`, import.meta.url).href
  const [device, migrate, engine] = await Promise.all([
    import(/* @vite-ignore */ at('test/test-device.ts')),
    import(/* @vite-ignore */ at('src/migrate.ts')),
    import(/* @vite-ignore */ at('src/engine.ts')),
  ])
  return { ...(device as object), ...(migrate as object), ...(engine as object) } as Kit
}

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'pictures@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Pictures' } })).json.space.id
})

afterEach(() => env.close())

async function device(
  name: string,
  files: Record<string, string | Uint8Array> = {},
  as = { token, role: 'owner' },
): Promise<Device> {
  const made = await (
    await kit()
  ).testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token: as.token,
    name,
    files,
  })
  const core = made.engine.core
  await core.commit(core.addSpace(space, made.root, as.role))
  expect(await (await kit()).firstPass(core, core.spaces.get(space), null)).toBe(true)
  await rooms.settle()
  return made
}

async function passed(...devices: Device[]) {
  for (let round = 0; round < 2; round += 1) {
    for (const one of devices) {
      await one.engine.pass(space)
      await rooms.settle()
    }
  }
}

interface Placed {
  name: string
  local_path: string
}

const placed = (core: Core, id = space) =>
  [...(core.spaces.get(id)?.entries.values() ?? [])] as unknown as Placed[]

async function tool(args: Record<string, unknown>) {
  const nib = (await call(env, '/v1/mcp/token', { token, body: { readOnly: false } })).json.token
  await call(env, '/mcp', {
    token: nib,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_note', arguments: { space: 'Pictures', ...args } },
    },
  })
  await rooms.settle()
}

function refusing(one: Device, refused: (path: string) => boolean) {
  const write = one.disk.write.bind(one.disk)
  one.disk.write = async (path: string, text: string) => {
    if (refused(path)) throw new Error('the disk said no')
    await write(path, text)
  }
}

async function newDevice(name: string, refused: (path: string) => boolean) {
  const k = await kit()
  const made = await k.testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token,
    name,
  })
  refusing(made, refused)
  const core = made.engine.core
  await core.commit(core.addSpace(space, made.root, 'owner'))
  expect(await k.firstPass(core, core.spaces.get(space), null)).toBe(true)
  return made
}

async function accountPaths() {
  const rows = await env.DB.prepare(
    'select path from notes where space_id = ? and deleted = 0 order by path',
  )
    .bind(space)
    .all<{ path: string }>()
  return rows.results.map((row) => row.path)
}

const manyNotes = () => {
  const files: Record<string, string> = {}
  for (let n = 0; n < 30; n += 1) files[`n${String(n)}.md`] = `words ${String(n)}\n`
  return files
}

test('a note the disk refuses leaves its batch landed, and is written once it can be', async () => {
  const laptop = await device('laptop', manyNotes())
  await passed(laptop)
  await tool({ path: 'blocked.md', content: 'pros and cons\n' })

  let refuses = true
  const desk = await newDevice('desk', (path) => refuses && path.endsWith('/blocked.md'))
  const told: string[] = []
  desk.engine.on('unsynced', (event) => told.push(event.name))

  for (let round = 0; round < 4; round += 1) {
    const outcome = await desk.engine.pass(space)
    expect(outcome?.finished).toBe(true)
    await rooms.settle()
  }
  expect(told).toEqual(['blocked.md'])
  expect((await desk.engine.pass(space))?.pulled).toBe(0)
  const landed = placed(desk.engine.core).filter((one) => one.local_path)
  expect(landed.map((one) => one.name)).not.toContain('blocked.md')
  expect(landed).toHaveLength(30)
  expect(desk.store.rows('log').some((row) => row.failed?.includes('blocked.md'))).toBe(true)

  refuses = false
  await desk.engine.pass(space)
  expect(desk.disk.files.get(`${desk.root}/blocked.md`)).toBe('pros and cons\n')
})

test('after a restart nothing comes back as a new note, and the refused one still arrives', async () => {
  const laptop = await device('laptop', manyNotes())
  await passed(laptop)
  await tool({ path: 'blocked.md', content: 'pros and cons\n' })

  let refuses = true
  const k = await kit()
  const desk = await newDevice('desk', (path) => refuses && path.endsWith('/blocked.md'))
  await desk.engine.pass(space)
  await rooms.settle()

  const core = desk.engine.core
  await desk.engine.quit()
  desk.engine.stop()
  const again = await k.Engine.start(core.world, desk.store.open())
  const after = placed(again.core)
  expect(after.filter((one) => one.local_path)).toHaveLength(30)

  const live = again.core.spaces.get(space) as unknown as { at(path: string): unknown }
  let strangers = 0
  for (const [path, text] of [...desk.disk.files]) {
    if (live.at(path.slice(desk.root.length + 1))) continue
    strangers += 1
    await again.created(path, false, text)
  }
  expect(strangers).toBe(0)

  refuses = false
  await again.pass(space)
  await rooms.settle()
  expect(desk.disk.files.get(`${desk.root}/blocked.md`)).toBe('pros and cons\n')
  expect((await accountPaths()).filter((path) => / \d+\.md$/.test(path))).toEqual([])
  expect(await accountPaths()).toHaveLength(31)
  again.stop()
})

test('a file in step that refuses one write is written the next pass', async () => {
  const laptop = await device('laptop', { 'one.md': 'one\n' })
  const desk = await device('desk')
  await passed(laptop, desk)

  let refuses = true
  refusing(desk, (path) => refuses && path.endsWith('/one.md'))
  await laptop.disk.write(`${laptop.root}/one.md`, 'one\nlaptop words\n')
  await laptop.engine.foreign(`${laptop.root}/one.md`)
  await laptop.engine.pass(space)
  await rooms.settle()

  expect((await desk.engine.pass(space))?.finished).toBe(true)
  expect(desk.disk.files.get(`${desk.root}/one.md`)).toBe('one\n')
  refuses = false
  await desk.engine.pass(space)
  expect(desk.disk.files.get(`${desk.root}/one.md`)).toBe('one\nlaptop words\n')
})

test('a name Windows keeps arrives under that name everywhere else, and the way back knows it', async () => {
  const laptop = await device('laptop', { 'one.md': 'one\n' })
  await passed(laptop)
  await tool({ path: 'Con.md', content: 'pros and cons\n' })
  await tool({ path: 'aux/inside.md', content: 'inside\n' })

  const desk = await device('desk')
  await passed(desk)
  expect(desk.disk.files.get(`${desk.root}/Con.md`)).toBe('pros and cons\n')
  expect(desk.disk.files.get(`${desk.root}/aux/inside.md`)).toBe('inside\n')
  expect(await accountPaths()).toEqual(['Con.md', 'aux/inside.md', 'one.md'])

  const k = await kit()
  const mirrors = await k.mirrorsFrom(desk.engine.core, null)
  expect(Object.keys(mirrors[desk.root]?.notes ?? {}).sort()).toEqual([
    'Con.md',
    'aux/inside.md',
    'one.md',
  ])
})

test('a note moved on Windows keeps the name the account has for it', async () => {
  const laptop = await device('laptop', { 'one.md': 'one\n' })
  await passed(laptop)
  await tool({ path: 'Con.md', content: 'pros and cons\n' })

  const k = await kit()
  const desk = await k.testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token,
    name: 'desk',
  })
  const world = desk.engine.core.world as { platform: string }
  world.platform = 'windows'
  const core = desk.engine.core
  await core.commit(core.addSpace(space, desk.root, 'owner'))
  expect(await k.firstPass(core, core.spaces.get(space), null)).toBe(true)
  await desk.engine.pass(space)
  expect(desk.disk.files.has(`${desk.root}/_Con.md`)).toBe(true)

  await desk.disk.mkdir(`${desk.root}/sub`)
  await desk.engine.created(`${desk.root}/sub`, true)
  await desk.disk.move(`${desk.root}/_Con.md`, `${desk.root}/sub/_Con.md`)
  await desk.engine.moved(`${desk.root}/_Con.md`, `${desk.root}/sub/_Con.md`)
  await desk.engine.pass(space)
  await rooms.settle()
  expect(await accountPaths()).toEqual(['one.md', 'sub/Con.md'])
})

test('a row a device cannot read does not stop its passes, whatever hangs under it', async () => {
  const desk = await device('desk', { 'one.md': 'one\n' })
  await passed(desk)
  const long = `${'x'.repeat(300)}.md`
  const row = (id: string, name: string, parent: string | null, seq: number) =>
    env.DB.prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind,
                          name, name_key, folder_id, doc_seq, epoch)
       values (?, ?, ?, ?, 1, 1, 0, 0, '', 'note', ?, ?, ?, ?, 1)`,
    )
      .bind(id, space, name, seq, name, name, parent, seq)
      .run()
  await env.DB.prepare(
    `insert into folders (id, space_id, parent_id, name, name_key, seq, deleted, updated_at)
     values (?, ?, null, '..', '..', 900, 0, 1)`,
  )
    .bind('b'.repeat(32), space)
    .run()
  await row('a'.repeat(32), long, null, 901)
  await row('c'.repeat(32), 'pwn.md', 'b'.repeat(32), 902)
  await env.DB.prepare('update space_cursor set next = 903 where space_id = ?').bind(space).run()

  const laptop = await device('laptop')
  await laptop.disk.write(`${laptop.root}/after.md`, 'after\n')
  await laptop.engine.foreign(`${laptop.root}/after.md`)
  await laptop.engine.created(`${laptop.root}/after.md`, false, 'after\n')
  await passed(laptop, desk)

  expect(desk.disk.files.get(`${desk.root}/after.md`)).toBe('after\n')
  expect([...desk.disk.files.keys()].some((path) => path.endsWith('/__/pwn.md'))).toBe(true)
  const long2 = [...desk.disk.files.keys()].find((path) => path.includes('xxxx'))
  expect(long2?.slice(desk.root.length + 1).length).toBeLessThanOrEqual(255)
  expect((await desk.engine.pass(space))?.finished).toBe(true)
})

async function firstPassOverShut(words: string) {
  const laptop = await device('laptop', { 'shut/inside.md': 'inside\n', 'open.md': 'open\n' })
  await passed(laptop)
  const rows = await env.DB.prepare('select id, path, version, hash from notes where space_id = ?')
    .bind(space)
    .all<{ id: string; path: string; version: number; hash: string }>()
  const notes = Object.fromEntries(
    rows.results.map((row) => [row.path, { id: row.id, version: row.version, hash: row.hash }]),
  )
  const k = await kit()
  const desk = await k.testDevice({
    fetch: async (request) => await app.fetch(request, env),
    token,
    name: 'desk',
    files: { 'shut/inside.md': words, 'open.md': 'open\n' },
  })
  const core = desk.engine.core as Core & {
    world: { list(root: string): Promise<{ path: string; dir: boolean }[]> }
  }
  const shut = `${desk.root}/shut/`
  const { read, exists } = {
    read: desk.disk.read.bind(desk.disk),
    exists: desk.disk.exists.bind(desk.disk),
  }
  const state = { locked: true }
  desk.disk.read = (path) =>
    state.locked && path.startsWith(shut) ? Promise.resolve(null) : read(path)
  desk.disk.exists = (path) =>
    state.locked && path.startsWith(shut) ? Promise.resolve(true) : exists(path)
  const open = core.world.list.bind(core.world)
  core.world.list = async (root) =>
    (await open(root)).filter((one) => !state.locked || !one.path.startsWith('shut/'))
  await core.commit(core.addSpace(space, desk.root, 'owner'))
  const v1 = { cursor: 1000, notes, untold: {} }
  const first = () => k.firstPass(core, core.spaces.get(space), v1)
  return { k, desk, core, state, first }
}

test('a first pass waits for a note v1 knew that will not read, and deletes nothing', async () => {
  const { desk, core, state, first } = await firstPassOverShut('inside\n')
  expect(await first()).toBe(false)
  await rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])

  state.locked = false
  expect(await first()).toBe(true)
  expect(placed(core).find((one) => one.name === 'inside.md')?.local_path).toBe('shut/inside.md')
  await desk.engine.pass(space)
  await rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
})

test('and when it reads with other words, they are the note edited, not a second note', async () => {
  const { desk, core, state, first } = await firstPassOverShut('inside\nwritten offline\n')
  expect(await first()).toBe(false)
  state.locked = false
  expect(await first()).toBe(true)
  await desk.engine.pass(space)
  await rooms.settle()
  await desk.engine.pass(space)
  await rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
  expect(placed(core).find((one) => one.name === 'inside.md')?.local_path).toBe('shut/inside.md')
})

test('a note v1 knew that no listing shows but still reads is the note, not a delete', async () => {
  const { desk, core, first } = await firstPassOverShut('inside\n')
  const read = desk.disk.read.bind(desk.disk)
  desk.disk.read = (path) =>
    path.endsWith('/shut/inside.md') ? Promise.resolve('inside\n') : read(path)
  expect(await first()).toBe(true)
  await desk.engine.pass(space)
  await rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
  expect(placed(core).find((one) => one.name === 'inside.md')?.local_path).toBe('shut/inside.md')
})

test('a file met in step that has no place yet keeps the place it is given over a restart', async () => {
  const laptop = await device('laptop', { 'one.md': 'one\n' })
  const desk = await device('desk')
  await passed(laptop, desk)
  const core = desk.engine.core
  const entry = placed(core).find((one) => one.name === 'one.md') as unknown as {
    id: string
    local_path: string
  }
  entry.local_path = ''
  const live = core as unknown as {
    wanted(space: string): Map<string, { docSeq: number; epoch: number }>
    commit(changes: unknown[]): Promise<void>
    entryChanges(rows: unknown[]): unknown[]
  }
  await live.commit(live.entryChanges([entry]))
  live.wanted(space).set(entry.id, { docSeq: 0, epoch: 1 })
  await desk.engine.pass(space)
  expect(entry.local_path).toBe('one.md')

  await desk.engine.quit()
  desk.engine.stop()
  const k = await kit()
  const again = await k.Engine.start(core.world, desk.store.open())
  expect(placed(again.core).find((one) => one.name === 'one.md')?.local_path).toBe('one.md')
  again.stop()
})
