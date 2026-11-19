import { expect, test } from 'vitest'
import app from '../src'
import { type Core, type Device, engineSpace, kit } from './engine-kit'
import { call } from './harness'

const { at, device, passed } = engineSpace()
interface Placed {
  name: string
  local_path: string
}
const placed = (core: Core, id = at.space) => [...(core.spaces.get(id)?.entries.values() ?? [])] as unknown as Placed[]
async function tool(args: Record<string, unknown>) {
  const nib = (await call(at.env, '/v1/mcp/token', { token: at.token, body: { readOnly: false } })).json.token
  await call(at.env, '/mcp', {
    token: nib,
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'write_note', arguments: { space: 'Pictures', ...args } },
    },
  })
  await at.rooms.settle()
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
    fetch: async (request) => await app.fetch(request, at.env),
    token: at.token,
    name,
  })
  refusing(made, refused)
  const core = made.engine.core
  await core.commit(core.addSpace(at.space, made.root, 'owner'))
  expect(await k.firstPass(core, core.spaces.get(at.space), null)).toBe(true)
  return made
}
async function accountPaths() {
  const rows = await at.env.DB.prepare('select path from notes where space_id = ? and deleted = 0 order by path')
    .bind(at.space)
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
    const outcome = await desk.engine.pass(at.space)
    expect(outcome?.finished).toBe(true)
    await at.rooms.settle()
  }
  expect(told).toEqual(['blocked.md'])
  expect((await desk.engine.pass(at.space))?.pulled).toBe(0)
  const landed = placed(desk.engine.core).filter((one) => one.local_path)
  expect(landed.map((one) => one.name)).not.toContain('blocked.md')
  expect(landed).toHaveLength(30)
  expect(desk.store.rows('log').some((row) => row.failed?.includes('blocked.md'))).toBe(true)
  refuses = false
  await desk.engine.pass(at.space)
  expect(desk.disk.files.get(`${desk.root}/blocked.md`)).toBe('pros and cons\n')
})
test('after a restart nothing comes back as a new note, and the refused one still arrives', async () => {
  const laptop = await device('laptop', manyNotes())
  await passed(laptop)
  await tool({ path: 'blocked.md', content: 'pros and cons\n' })
  let refuses = true
  const k = await kit()
  const desk = await newDevice('desk', (path) => refuses && path.endsWith('/blocked.md'))
  await desk.engine.pass(at.space)
  await at.rooms.settle()
  const core = desk.engine.core
  await desk.engine.quit()
  desk.engine.stop()
  const again = await k.Engine.start(core.world, desk.store.open())
  const after = placed(again.core)
  expect(after.filter((one) => one.local_path)).toHaveLength(30)
  const live = again.core.spaces.get(at.space) as unknown as { at(path: string): unknown }
  let strangers = 0
  for (const [path, text] of [...desk.disk.files]) {
    if (live.at(path.slice(desk.root.length + 1))) continue
    strangers += 1
    await again.created(path, false, text)
  }
  expect(strangers).toBe(0)
  refuses = false
  await again.pass(at.space)
  await at.rooms.settle()
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
  await laptop.engine.pass(at.space)
  await at.rooms.settle()
  expect((await desk.engine.pass(at.space))?.finished).toBe(true)
  expect(desk.disk.files.get(`${desk.root}/one.md`)).toBe('one\n')
  refuses = false
  await desk.engine.pass(at.space)
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
  expect(Object.keys(mirrors[desk.root]?.notes ?? {}).sort()).toEqual(['Con.md', 'aux/inside.md', 'one.md'])
})
test('a note moved on Windows keeps the name the account has for it', async () => {
  const laptop = await device('laptop', { 'one.md': 'one\n' })
  await passed(laptop)
  await tool({ path: 'Con.md', content: 'pros and cons\n' })
  const k = await kit()
  const desk = await k.testDevice({
    fetch: async (request) => await app.fetch(request, at.env),
    token: at.token,
    name: 'desk',
  })
  const world = desk.engine.core.world as { platform: string }
  world.platform = 'windows'
  const core = desk.engine.core
  await core.commit(core.addSpace(at.space, desk.root, 'owner'))
  expect(await k.firstPass(core, core.spaces.get(at.space), null)).toBe(true)
  await desk.engine.pass(at.space)
  expect(desk.disk.files.has(`${desk.root}/_Con.md`)).toBe(true)
  await desk.disk.mkdir(`${desk.root}/sub`)
  await desk.engine.created(`${desk.root}/sub`, true)
  await desk.disk.move(`${desk.root}/_Con.md`, `${desk.root}/sub/_Con.md`)
  await desk.engine.moved(`${desk.root}/_Con.md`, `${desk.root}/sub/_Con.md`)
  await desk.engine.pass(at.space)
  await at.rooms.settle()
  expect(await accountPaths()).toEqual(['one.md', 'sub/Con.md'])
})
test('a row a device cannot read does not stop its passes, whatever hangs under it', async () => {
  const desk = await device('desk', { 'one.md': 'one\n' })
  await passed(desk)
  const long = `${'x'.repeat(300)}.md`
  const row = (id: string, name: string, parent: string | null, seq: number) =>
    at.env.DB.prepare(
      `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash, kind,
                          name, name_key, folder_id, doc_seq, epoch)
       values (?, ?, ?, ?, 1, 1, 0, 0, '', 'note', ?, ?, ?, ?, 1)`,
    )
      .bind(id, at.space, name, seq, name, name, parent, seq)
      .run()
  await at.env.DB.prepare(
    `insert into folders (id, space_id, parent_id, name, name_key, seq, deleted, updated_at)
     values (?, ?, null, '..', '..', 900, 0, 1)`,
  )
    .bind('b'.repeat(32), at.space)
    .run()
  await row('a'.repeat(32), long, null, 901)
  await row('c'.repeat(32), 'pwn.md', 'b'.repeat(32), 902)
  await at.env.DB.prepare('update space_cursor set next = 903 where space_id = ?').bind(at.space).run()
  const laptop = await device('laptop')
  await laptop.disk.write(`${laptop.root}/after.md`, 'after\n')
  await laptop.engine.foreign(`${laptop.root}/after.md`)
  await laptop.engine.created(`${laptop.root}/after.md`, false, 'after\n')
  await passed(laptop, desk)
  expect(desk.disk.files.get(`${desk.root}/after.md`)).toBe('after\n')
  expect([...desk.disk.files.keys()].some((path) => path.endsWith('/__/pwn.md'))).toBe(true)
  const long2 = [...desk.disk.files.keys()].find((path) => path.includes('xxxx'))
  expect(long2?.slice(desk.root.length + 1).length).toBeLessThanOrEqual(255)
  expect((await desk.engine.pass(at.space))?.finished).toBe(true)
})
async function firstPassOverShut(words: string) {
  const laptop = await device('laptop', { 'shut/inside.md': 'inside\n', 'open.md': 'open\n' })
  await passed(laptop)
  const rows = await at.env.DB.prepare('select id, path, version, hash from notes where space_id = ?')
    .bind(at.space)
    .all<{ id: string; path: string; version: number; hash: string }>()
  const notes = Object.fromEntries(
    rows.results.map((row) => [row.path, { id: row.id, version: row.version, hash: row.hash }]),
  )
  const k = await kit()
  const desk = await k.testDevice({
    fetch: async (request) => await app.fetch(request, at.env),
    token: at.token,
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
  desk.disk.read = (path) => (state.locked && path.startsWith(shut) ? Promise.resolve(null) : read(path))
  desk.disk.exists = (path) => (state.locked && path.startsWith(shut) ? Promise.resolve(true) : exists(path))
  const open = core.world.list.bind(core.world)
  core.world.list = async (root) => (await open(root)).filter((one) => !state.locked || !one.path.startsWith('shut/'))
  await core.commit(core.addSpace(at.space, desk.root, 'owner'))
  const v1 = { cursor: 1000, notes, untold: {} }
  const first = () => k.firstPass(core, core.spaces.get(at.space), v1)
  return { k, desk, core, state, first }
}
test('a first pass waits for a note v1 knew that will not read, and deletes nothing', async () => {
  const { desk, core, state, first } = await firstPassOverShut('inside\n')
  expect(await first()).toBe(false)
  await at.rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
  state.locked = false
  expect(await first()).toBe(true)
  expect(placed(core).find((one) => one.name === 'inside.md')?.local_path).toBe('shut/inside.md')
  await desk.engine.pass(at.space)
  await at.rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
})
test('and when it reads with other words, they are the note edited, not a second note', async () => {
  const { desk, core, state, first } = await firstPassOverShut('inside\nwritten offline\n')
  expect(await first()).toBe(false)
  state.locked = false
  expect(await first()).toBe(true)
  await desk.engine.pass(at.space)
  await at.rooms.settle()
  await desk.engine.pass(at.space)
  await at.rooms.settle()
  expect(await accountPaths()).toEqual(['open.md', 'shut/inside.md'])
  expect(placed(core).find((one) => one.name === 'inside.md')?.local_path).toBe('shut/inside.md')
})
test('a note v1 knew that no listing shows but still reads is the note, not a delete', async () => {
  const { desk, core, first } = await firstPassOverShut('inside\n')
  const read = desk.disk.read.bind(desk.disk)
  desk.disk.read = (path) => (path.endsWith('/shut/inside.md') ? Promise.resolve('inside\n') : read(path))
  expect(await first()).toBe(true)
  await desk.engine.pass(at.space)
  await at.rooms.settle()
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
  live.wanted(at.space).set(entry.id, { docSeq: 0, epoch: 1 })
  await desk.engine.pass(at.space)
  expect(entry.local_path).toBe('one.md')
  await desk.engine.quit()
  desk.engine.stop()
  const k = await kit()
  const again = await k.Engine.start(core.world, desk.store.open())
  expect(placed(again.core).find((one) => one.name === 'one.md')?.local_path).toBe('one.md')
  again.stop()
})
