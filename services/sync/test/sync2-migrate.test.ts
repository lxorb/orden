import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { frame, unframe } from '@orden/sync-core'
import { sha256 } from '../src/crypto'
import { keepVersionNow } from '../src/versions'
import app from '../src/index'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

interface Tracked {
  id: string
  version: number
  hash: string
}

interface V1Space {
  cursor: number
  notes: Record<string, Tracked>
  untold?: Record<string, { from: string; to: string; tries: number }>
}

interface Entry {
  id: string
  local_path: string
}

interface SpaceState {
  id: string
  entries: Map<string, Entry>
  outbox: unknown[]
}

interface Core {
  spaces: Map<string, SpaceState>
  held: Map<string, unknown>
  world: { list?: (root: string) => Promise<unknown> } & object
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}

interface Device {
  root: string
  disk: {
    files: Map<string, string>
    folders: Set<string>
    read(path: string): Promise<string | null>
    write(path: string, text: string): Promise<void>
    move(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
  }
  store: { open(): unknown }
  engine: {
    core: Core
    stop(): void
    pass(space: string): Promise<{ finished: boolean } | null>
    waiting(space: string): boolean
    moved(from: string, to: string): Promise<void>
    removed(path: string): Promise<void>
    saved(path: string, text: string): Promise<void>
  }
  asked: string[]
}

interface Listing {
  cursor: number
  notes: {
    id: string
    path: string
    version: number
    hash: string
    seq: number
    deleted: boolean
  }[]
}

interface Mirror {
  cursor: number
  notes: Record<string, Tracked>
}

interface Engine {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    files?: Record<string, string>
  }): Promise<Device>
  firstPass(
    core: Core,
    space: SpaceState,
    v1: V1Space | null,
    carried?: ReadonlyMap<string, string>,
    done?: never[],
  ): Promise<boolean>
  Engine: {
    start(world: unknown, store: unknown, how: { freshens: boolean }): Promise<Device['engine']>
  }
  mirrorsFrom(
    core: Core,
    listings: ReadonlyMap<string, Listing> | null,
  ): Promise<Record<string, Mirror>>
}

async function engine(): Promise<Engine> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync2/${file}`, import.meta.url).href
  const [device, migrate, running] = await Promise.all([
    import(/* @vite-ignore */ at('test-device.ts')),
    import(/* @vite-ignore */ at('migrate.ts')),
    import(/* @vite-ignore */ at('engine.ts')),
  ])
  return { ...(device as object), ...(migrate as object), ...(running as object) } as Engine
}

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'mover@example.com')
  other = await signIn(env, 'mover@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Moving' } })).json.space.id
})

afterEach(() => env.close())

async function v1Note(path: string, content: string): Promise<{ id: string; version: number }> {
  const made = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  expect(made.status).toBe(201)
  return { id: made.json.note.id, version: made.json.note.version }
}

let other: string

async function v1Write(id: string, path: string, content: string, baseVersion: number) {
  const written = await call(env, `/v1/notes/${id}`, {
    token: other,
    method: 'PUT',
    body: { path, content, baseVersion },
  })
  expect(written.status).toBe(200)
}

async function textOnAccount(id: string): Promise<string> {
  return (await call(env, `/v1/notes/${id}`, { token })).json.content
}

async function liveNames(): Promise<string[]> {
  const rows = env.db
    .prepare('select path from notes where space_id = ? and deleted = 0 order by path')
    .all(space) as { path: string }[]
  return rows.map((row) => row.path)
}

async function v1Cursor(): Promise<number> {
  return (await call(env, `/v1/spaces/${space}/changes?since=0`, { token })).json.cursor
}

async function oneDocAPull(request: Request): Promise<Response> {
  const answer = await app.fetch(request, env)
  if (!request.url.endsWith('/v2/docs/pull') || !answer.ok) return answer
  const said = unframe(new Uint8Array(await answer.arrayBuffer())) as { docs: unknown[] }
  return new Response(frame({ ...said, docs: said.docs.slice(0, 1) }), {
    status: answer.status,
    headers: answer.headers,
  })
}

async function migrated(
  files: Record<string, string>,
  notes: Record<string, Tracked>,
  cursor = 0,
  untold?: V1Space['untold'],
  carried?: ReadonlyMap<string, string>,
  fetch: (request: Request) => Promise<Response> = async (request) => await app.fetch(request, env),
) {
  const kit = await engine()
  const device = await kit.testDevice({
    fetch,
    token,
    files,
  })
  const core = device.engine.core
  await core.commit(core.addSpace(space, device.root, 'owner'))
  const state = core.spaces.get(space)
  if (!state) throw new Error('the space was not added')

  const first = await kit.firstPass(
    core,
    state,
    { cursor, notes, ...(untold ? { untold } : {}) },
    carried,
  )
  expect(first).toBe(true)
  const asked = [...device.asked]
  await rooms.settle()
  const passed = await device.engine.pass(space)
  expect(passed?.finished).toBe(true)
  await rooms.settle()
  return {
    kit,
    device,
    asked,
    file: (path: string) => device.disk.files.get(`${device.root}/${path}`),
  }
}

describe('a device moving to v2', () => {
  test('a note v1 left as the account has it is seeded here, nothing downloaded', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const { asked, file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(asked.some((one) => one.endsWith('/v2/docs/pull'))).toBe(false)
    expect(file('Plan.md')).toBe('We ship on Monday.\n')
    expect(await textOnAccount(note.id)).toBe('We ship on Monday.\n')
  })

  test('a note v1 left behind the account takes the account’s words', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    await v1Write(note.id, 'Plan.md', 'We ship on Tuesday, after the review.\n', note.version)
    const { file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(file('Plan.md')).toBe('We ship on Tuesday, after the review.\n')
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('notes moved on both sides all merge when the account answers a pull a few at a time', async () => {
    const base = 'First line.\n\nSecond line.\n'
    const notes: Record<string, Tracked> = {}
    const files: Record<string, string> = {}
    for (const name of ['Plan.md', 'Ideas.md', 'Later.md']) {
      const note = await v1Note(name, base)
      await keepVersionNow(env, note.id, base, 'one')
      await v1Write(note.id, name, 'First line, edited elsewhere.\n\nSecond line.\n', note.version)
      notes[name] = { ...note, hash: await sha256(base) }
      files[name] = 'First line.\n\nSecond line, edited here.\n'
    }
    const { file } = await migrated(files, notes, 0, undefined, undefined, oneDocAPull)

    for (const name of Object.keys(files)) {
      expect(file(name)).toBe('First line, edited elsewhere.\n\nSecond line, edited here.\n')
    }
  })

  test('a pull answered with none of its notes is a move to make again, and nothing written here is lost', async () => {
    const base = 'First line.\n\nSecond line.\n'
    const note = await v1Note('Plan.md', base)
    await keepVersionNow(env, note.id, base, 'one')
    await v1Write(
      note.id,
      'Plan.md',
      'First line, edited elsewhere.\n\nSecond line.\n',
      note.version,
    )
    let emptied = 0
    const kit = await engine()
    const device = await kit.testDevice({
      fetch: async (request) => {
        const answer = await app.fetch(request, env)
        if (emptied > 0 || !request.url.endsWith('/v2/docs/pull') || !answer.ok) return answer
        emptied += 1
        return new Response(frame({ docs: [] }), { status: answer.status, headers: answer.headers })
      },
      token,
      files: { 'Plan.md': 'First line.\n\nSecond line, edited here.\n' },
    })
    const core = device.engine.core
    await core.commit(core.addSpace(space, device.root, 'owner'))
    const state = core.spaces.get(space)
    if (!state) throw new Error('the space was not added')
    const v1 = { cursor: 0, notes: { 'Plan.md': { ...note, hash: await sha256(base) } } }

    expect(await kit.firstPass(core, state, v1)).toBe(false)
    expect(await kit.firstPass(core, state, v1)).toBe(true)
    await rooms.settle()
    expect((await device.engine.pass(space))?.finished).toBe(true)
    await rooms.settle()

    expect(device.disk.files.get(`${device.root}/Plan.md`)).toBe(
      'First line, edited elsewhere.\n\nSecond line, edited here.\n',
    )
    expect(emptied).toBe(1)
  })

  test('words written under v1 that never went up go up, and nothing is copied', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const { file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n\n- written offline under v1\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(await textOnAccount(note.id)).toBe('We ship on Monday.\n\n- written offline under v1\n')
    expect(file('Plan.md')).toBe('We ship on Monday.\n\n- written offline under v1\n')
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('both moved: merged against the version v1 last agreed on', async () => {
    const note = await v1Note('Plan.md', 'First line.\n\nSecond line.\n')
    await keepVersionNow(env, note.id, 'First line.\n\nSecond line.\n', 'one')
    await v1Write(
      note.id,
      'Plan.md',
      'First line, edited elsewhere.\n\nSecond line.\n',
      note.version,
    )
    const { file } = await migrated(
      { 'Plan.md': 'First line.\n\nSecond line, edited here.\n' },
      { 'Plan.md': { ...note, hash: await sha256('First line.\n\nSecond line.\n') } },
    )

    const merged = 'First line, edited elsewhere.\n\nSecond line, edited here.\n'
    expect(await textOnAccount(note.id)).toBe(merged)
    expect(file('Plan.md')).toBe(merged)
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('both moved with no ancestor to be had: the text holding the other whole wins', async () => {
    const note = await v1Note('Plan.md', 'One.\n')
    await v1Write(note.id, 'Plan.md', 'One.\nTwo.\n', note.version)
    const { file } = await migrated(
      { 'Plan.md': 'One.\nTwo.\nThree.\n' },
      { 'Plan.md': { ...note, hash: 'a hash no version has' } },
    )

    expect(await textOnAccount(note.id)).toBe('One.\nTwo.\nThree.\n')
    expect(file('Plan.md')).toBe('One.\nTwo.\nThree.\n')
  })

  test('both rewrote it with no ancestor: held for the question, nothing written over', async () => {
    const note = await v1Note('Plan.md', 'The release goes out on Monday morning.\n')
    await v1Write(
      note.id,
      'Plan.md',
      'The release waits until every reviewer has signed off on it.\n',
      note.version,
    )
    const { device, file } = await migrated(
      { 'Plan.md': 'We hold the release until Friday, whatever the review says.\n' },
      { 'Plan.md': { ...note, hash: 'a hash no version has' } },
    )

    expect(device.engine.core.held.has(note.id)).toBe(true)
    expect(file('Plan.md')).toBe('We hold the release until Friday, whatever the review says.\n')
    expect(await textOnAccount(note.id)).toBe(
      'The release waits until every reviewer has signed off on it.\n',
    )
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('a canvas that no longer reads is not taken for an empty one', async () => {
    const good = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', text: 'keep me', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    })
    const note = await v1Note('Board.canvas', good)
    const { file } = await migrated(
      { 'Board.canvas': good.slice(0, -12) },
      { 'Board.canvas': { ...note, hash: await sha256(good) } },
    )

    expect(await textOnAccount(note.id)).toContain('keep me')
    expect(file('Board.canvas')).toContain('keep me')
  })

  test('a file the account has never seen is made there', async () => {
    const note = await v1Note('Plan.md', 'Plan.\n')
    const { file } = await migrated(
      { 'Plan.md': 'Plan.\n', 'Ideas/New.md': 'A new idea.\n' },
      { 'Plan.md': { ...note, hash: await sha256('Plan.\n') } },
    )

    expect(await liveNames()).toEqual(['Ideas/New.md', 'Plan.md'])
    expect(file('Ideas/New.md')).toBe('A new idea.\n')
  })

  test('what was made signed out goes up under the ids it had here (#1068)', async () => {
    const note = await v1Note('Plan.md', 'Plan.\n')
    const folder = '0f'.repeat(16)
    const idea = '1e'.repeat(16)
    const carried = new Map([
      ['ideas', folder],
      ['ideas/new.md', idea],
      ['plan.md', '2d'.repeat(16)],
    ])
    await migrated(
      { 'Plan.md': 'Plan.\n', 'Ideas/New.md': 'A new idea.\n' },
      { 'Plan.md': { ...note, hash: await sha256('Plan.\n') } },
      0,
      undefined,
      carried,
    )

    const ids = env.db
      .prepare('select id, path from notes where space_id = ? and deleted = 0 order by path')
      .all(space) as { id: string; path: string }[]
    expect(ids).toEqual([
      { id: idea, path: 'Ideas/New.md' },
      { id: note.id, path: 'Plan.md' },
    ])
    const folders = env.db
      .prepare('select id from folders where space_id = ? and name = ?')
      .all(space, 'Ideas') as { id: string }[]
    expect(folders).toEqual([{ id: folder }])
  })

  test('a note v1 tracked whose file is gone is deleted, unless written in elsewhere', async () => {
    const gone = await v1Note('Gone.md', 'Delete me.\n')
    const kept = await v1Note('Kept.md', 'Keep me.\n')
    const seen = await v1Cursor()
    await v1Write(kept.id, 'Kept.md', 'Keep me, I was written in.\n', kept.version)
    const { file } = await migrated(
      {},
      {
        'Gone.md': { ...gone, hash: await sha256('Delete me.\n') },
        'Kept.md': { ...kept, hash: await sha256('Keep me.\n') },
      },
      seen,
    )

    expect(await liveNames()).toEqual(['Kept.md'])
    expect(file('Kept.md')).toBe('Keep me, I was written in.\n')
  })
})

describe('a first pass that does not get through', () => {
  const offline = 'We ship on Monday.\n\n- written offline under v1\n'

  test('a window that dies after the feed: the next launch still sends the offline words', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const kit = await engine()
    let reachable = true
    const device = await kit.testDevice({
      fetch: async (request) => {
        if (!reachable && new URL(request.url).pathname.endsWith('/v2/docs/pull')) {
          throw new TypeError('network')
        }
        return await app.fetch(request, env)
      },
      token,
      files: { 'Plan.md': offline },
    })
    const v1 = {
      cursor: 0,
      notes: { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    }
    const before = device.engine.core
    await before.commit(before.addSpace(space, device.root, 'owner'))
    const state = before.spaces.get(space)
    if (!state) throw new Error('the space was not added')

    reachable = false
    expect(await kit.firstPass(before, state, v1)).toBe(false)

    reachable = true
    device.engine.stop()
    const again = await kit.Engine.start(before.world, device.store.open(), { freshens: false })
    const after = again.core.spaces.get(space)
    if (!after) throw new Error('the space was not kept')
    expect(await kit.firstPass(again.core, after, v1)).toBe(true)
    await rooms.settle()
    await again.pass(space)
    await rooms.settle()
    await again.pass(space)
    await rooms.settle()

    expect(device.disk.files.get(`${device.root}/Plan.md`)).toBe(offline)
    expect(await textOnAccount(note.id)).toBe(offline)
  })

  test('what the caller writes when it is done is written with its last commit', async () => {
    const kit = await engine()
    const device = await kit.testDevice({
      fetch: async (request) => await app.fetch(request, env),
      token,
    })
    const core = device.engine.core
    await core.commit(core.addSpace(space, device.root, 'owner'))
    const state = core.spaces.get(space)
    if (!state) throw new Error('the space was not added')
    const commit = core.commit.bind(core)
    const commits: unknown[][] = []
    core.commit = async (changes) => {
      commits.push(changes)
      await commit(changes)
    }
    const done = { t: 'put', table: 'meta', row: { key: 'first:done', value: 1 } }

    expect(await kit.firstPass(core, state, null, undefined, [done as never])).toBe(true)

    expect(commits.at(-1)).toContain(done)
    expect(commits.slice(0, -1).flat()).not.toContain(done)
  })

  test('an engine stopped while its last commit lands still passed: the commit is the pass', async () => {
    const kit = await engine()
    const device = await kit.testDevice({
      fetch: async (request) => await app.fetch(request, env),
      token,
    })
    const core = device.engine.core
    await core.commit(core.addSpace(space, device.root, 'owner'))
    const state = core.spaces.get(space)
    if (!state) throw new Error('the space was not added')
    const done = { t: 'put', table: 'meta', row: { key: 'first:done', value: 1 } }
    const commit = core.commit.bind(core)
    core.commit = async (changes) => {
      await commit(changes)
      if ((changes as readonly unknown[]).includes(done))
        (core as unknown as { life: number }).life += 1
    }

    expect(await kit.firstPass(core, state, null, undefined, [done as never])).toBe(true)
  })

  test('a listing that failed sends no deletes', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const kit = await engine()
    const device = await kit.testDevice({
      fetch: async (request) => await app.fetch(request, env),
      token,
      files: { 'Plan.md': 'We ship on Monday.\n' },
    })
    const core = device.engine.core
    core.world.list = () => Promise.resolve(null)
    await core.commit(core.addSpace(space, device.root, 'owner'))
    const state = core.spaces.get(space)
    if (!state) throw new Error('the space was not added')

    const passed = await kit.firstPass(core, state, {
      cursor: 0,
      notes: { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    })

    expect(passed).toBe(false)
    expect(state.outbox).toEqual([])
    expect(await liveNames()).toEqual(['Plan.md'])
  })
})

describe('a first pass over what v1 left unsaid', () => {
  test('a note v1 renamed offline is that note, moved: its id and history kept', async () => {
    const note = await v1Note('Old name.md', 'Words that moved.\n')
    const { file } = await migrated(
      { 'Elsewhere/New name.md': 'Words that moved.\n' },
      { 'Old name.md': { ...note, hash: await sha256('Words that moved.\n') } },
      await v1Cursor(),
    )

    expect(await liveNames()).toEqual(['Elsewhere/New name.md'])
    expect(idAt('Elsewhere/New name.md')).toBe(note.id)
    expect(file('Elsewhere/New name.md')).toBe('Words that moved.\n')
  })

  test('a held note v1 renamed and could not tell is that note, moved', async () => {
    const note = await v1Note('One.md', 'One.\n')
    await v1Write(note.id, 'One.md', 'One, there.\n', note.version)
    const { device, file } = await migrated(
      { 'Two.md': 'One, here.\n', 'One.md': 'Shopping.\n' },
      { 'One.md': { ...note, version: note.version + 1, hash: '' } },
      await v1Cursor(),
      { [note.id]: { from: 'One.md', to: 'Two.md', tries: 0 } },
    )

    expect(await liveNames()).toEqual(['One.md', 'Two.md'])
    expect(idAt('Two.md')).toBe(note.id)
    expect(idAt('One.md')).not.toBe(note.id)
    expect(await textOnAccount(note.id)).toBe('One, there.\n')
    expect(file('Two.md')).toBe('One, here.\n')
    expect(device.engine.core.held.has(note.id)).toBe(true)
  })

  test('a folder v1 renamed offline takes its notes, and leaves no empty folder', async () => {
    const one = await v1Note('Before/One.md', 'One.\n')
    const two = await v1Note('Before/Two.md', 'Two.\n')
    const { device } = await migrated(
      { 'After/One.md': 'One.\n', 'After/Two.md': 'Two.\n' },
      {
        'Before/One.md': { ...one, hash: await sha256('One.\n') },
        'Before/Two.md': { ...two, hash: await sha256('Two.\n') },
      },
      await v1Cursor(),
    )

    expect(await liveNames()).toEqual(['After/One.md', 'After/Two.md'])
    expect([idAt('After/One.md'), idAt('After/Two.md')]).toEqual([one.id, two.id])
    expect(liveFolders()).toEqual(['After'])
    expect(device.disk.folders.has(`${device.root}/Before`)).toBe(false)
  })

  test('words two files share name neither: both are new notes, nothing guessed', async () => {
    const note = await v1Note('Old.md', 'Same.\n')
    await migrated(
      { 'A.md': 'Same.\n', 'B.md': 'Same.\n' },
      { 'Old.md': { ...note, hash: await sha256('Same.\n') } },
      await v1Cursor(),
    )

    expect(await liveNames()).toEqual(['A.md', 'B.md'])
    expect([idAt('A.md'), idAt('B.md')]).not.toContain(note.id)
  })

  test('a note deleted elsewhere that v1 never heard of stays deleted', async () => {
    const note = await v1Note('Gone.md', 'Deleted on the other device.\n')
    const seen = await v1Cursor()
    expect(
      (await call(env, `/v1/notes/${note.id}`, { token: other, method: 'DELETE' })).status,
    ).toBe(200)
    const { file } = await migrated(
      { 'Gone.md': 'Deleted on the other device.\n' },
      { 'Gone.md': { ...note, hash: await sha256('Deleted on the other device.\n') } },
      seen,
    )

    expect(await liveNames()).toEqual([])
    expect(file('Gone.md')).toBeUndefined()
  })

  test('one written in here since it was deleted elsewhere stays, with the words', async () => {
    const note = await v1Note('Kept.md', 'Deleted on the other device.\n')
    const seen = await v1Cursor()
    await call(env, `/v1/notes/${note.id}`, { token: other, method: 'DELETE' })
    const { file } = await migrated(
      { 'Kept.md': 'Deleted on the other device.\n\nBut written in here.\n' },
      { 'Kept.md': { ...note, hash: await sha256('Deleted on the other device.\n') } },
      seen,
    )

    expect(await liveNames()).toEqual(['Kept.md'])
    expect(file('Kept.md')).toBe('Deleted on the other device.\n\nBut written in here.\n')
  })
})

describe('the way back to v1', () => {
  test('v1 -> v2 -> v1: renames, moves, deletes and unsent edits meet v1 with no copy', async () => {
    const plan = await v1Note('Plan.md', 'Plan.\n')
    const ideas = await v1Note('Notes/Ideas.md', 'Ideas.\n')
    const old = await v1Note('Old.md', 'Old name.\n')
    const inner = await v1Note('Folder/Inner.md', 'Inner.\n')
    const doomed = await v1Note('Doomed.md', 'Doomed.\n')
    const theirs = await v1Note('Theirs.md', 'Theirs.\n')
    const files = {
      'Plan.md': 'Plan.\n',
      'Notes/Ideas.md': 'Ideas.\n',
      'Old.md': 'Old name.\n',
      'Folder/Inner.md': 'Inner.\n',
      'Doomed.md': 'Doomed.\n',
      'Theirs.md': 'Theirs.\n',
    }
    const tracked: Record<string, Tracked> = {}
    for (const [path, note] of Object.entries({
      'Plan.md': plan,
      'Notes/Ideas.md': ideas,
      'Old.md': old,
      'Folder/Inner.md': inner,
      'Doomed.md': doomed,
      'Theirs.md': theirs,
    })) {
      tracked[path] = { ...note, hash: await sha256(files[path as keyof typeof files]) }
    }
    const { kit, device } = await migrated(files, tracked, await v1Cursor())
    const engine = device.engine
    const at = (path: string) => `${device.root}/${path}`

    await device.disk.move(at('Old.md'), at('Renamed.md'))
    await engine.moved(at('Old.md'), at('Renamed.md'))
    await device.disk.move(at('Folder/Inner.md'), at('Notes/Inner.md'))
    await engine.moved(at('Folder/Inner.md'), at('Notes/Inner.md'))
    await device.disk.remove(at('Doomed.md'))
    await engine.removed(at('Doomed.md'))
    await device.disk.write(at('Plan.md'), 'Plan.\n\nEdited under v2.\n')
    await engine.saved(at('Plan.md'), 'Plan.\n\nEdited under v2.\n')
    await sentAll(device)

    await device.disk.write(at('Notes/Ideas.md'), 'Ideas.\n\nTyped and never sent.\n')
    await engine.saved(at('Notes/Ideas.md'), 'Ideas.\n\nTyped and never sent.\n')
    const now = noteRow(theirs.id)
    await v1Write(theirs.id, 'Theirs.md', 'Theirs, written on a v1 device.\n', now.version)

    const mirror = (await kit.mirrorsFrom(engine.core, new Map([[space, await v1Listing()]])))[
      device.root
    ]
    if (!mirror) throw new Error('no mirror for the space')

    const first = await v1Pass(device, mirror)
    expect(first).toEqual({ copies: [], refused: [], deleted: [], created: [] })
    for (const path of Object.keys(mirror.notes)) {
      await device.disk.write(at(path), `${(await device.disk.read(at(path))) ?? ''}\nOn v1.\n`)
    }
    const second = await v1Pass(device, mirror)
    expect(second).toEqual({ copies: [], refused: [], deleted: [], created: [] })

    expect(await liveNames()).toEqual([
      'Notes/Ideas.md',
      'Notes/Inner.md',
      'Plan.md',
      'Renamed.md',
      'Theirs.md',
    ])
    expect(idAt('Renamed.md')).toBe(old.id)
    expect(idAt('Notes/Inner.md')).toBe(inner.id)
    expect(await textOnAccount(ideas.id)).toBe('Ideas.\n\nTyped and never sent.\n\nOn v1.\n')
    expect(await textOnAccount(theirs.id)).toBe('Theirs, written on a v1 device.\n\nOn v1.\n')
    expect(await textOnAccount(plan.id)).toBe('Plan.\n\nEdited under v2.\n\nOn v1.\n')
    expect(deletedNames()).toEqual(['Doomed.md'])
  })

  test('without the account, every note is left for v1 to judge from what was confirmed', async () => {
    const note = await v1Note('Plan.md', 'Plan.\n')
    const { kit, device } = await migrated(
      { 'Plan.md': 'Plan.\n' },
      { 'Plan.md': { ...note, hash: await sha256('Plan.\n') } },
    )
    await device.disk.write(`${device.root}/Plan.md`, 'Plan.\n\nUnsent.\n')
    await device.engine.saved(`${device.root}/Plan.md`, 'Plan.\n\nUnsent.\n')

    const mirror = (await kit.mirrorsFrom(device.engine.core, null))[device.root]
    expect(mirror?.cursor).toBe(0)
    expect(mirror?.notes['Plan.md']).toEqual({
      id: note.id,
      version: 0,
      hash: await sha256('Plan.\n'),
    })
    if (!mirror) return
    expect(await v1Pass(device, mirror)).toEqual({
      copies: [],
      refused: [],
      deleted: [],
      created: [],
    })
    expect(await textOnAccount(note.id)).toBe('Plan.\n\nUnsent.\n')
  })
})

function idAt(path: string): string | undefined {
  const row = env.db
    .prepare('select id from notes where space_id = ? and path = ? and deleted = 0')
    .get(space, path) as { id: string } | undefined
  return row?.id
}

function noteRow(id: string): { version: number; hash: string } {
  return env.db.prepare('select version, hash from notes where id = ?').get(id) as {
    version: number
    hash: string
  }
}

function deletedNames(): string[] {
  const rows = env.db
    .prepare('select path from notes where space_id = ? and deleted = 1 order by path')
    .all(space) as { path: string }[]
  return rows.map((row) => row.path)
}

function liveFolders(): string[] {
  const rows = env.db
    .prepare('select name from folders where space_id = ? and deleted = 0 order by name')
    .all(space) as { name: string }[]
  return rows.map((row) => row.name)
}

async function sentAll(device: Device) {
  for (let round = 0; round < 4; round++) {
    const passed = await device.engine.pass(space)
    expect(passed?.finished).toBe(true)
    await rooms.settle()
    if (!device.engine.waiting(space)) return
  }
}

async function v1Listing(): Promise<Listing> {
  const notes: Listing['notes'] = []
  let cursor = 0
  for (;;) {
    const page = (await call(env, `/v1/spaces/${space}/changes?since=${String(cursor)}`, { token }))
      .json as { notes: Listing['notes']; cursor: number; more: boolean }
    notes.push(...page.notes)
    cursor = page.cursor
    if (!page.more) return { cursor, notes }
  }
}

async function v1Pass(device: Device, mirror: Mirror) {
  const at = (path: string) => `${device.root}/${path}`
  const out = {
    copies: [] as string[],
    refused: [] as string[],
    deleted: [] as string[],
    created: [] as string[],
  }

  for (;;) {
    const page = (
      await call(env, `/v1/spaces/${space}/changes?since=${String(mirror.cursor)}`, {
        token,
      })
    ).json as { notes: Listing['notes']; cursor: number; more: boolean }
    for (const remote of page.notes) {
      const known = mirror.notes[remote.path]
      if (remote.deleted) {
        if (known?.id === remote.id) {
          Reflect.deleteProperty(mirror.notes, remote.path)
          await device.disk.remove(at(remote.path))
        }
        continue
      }
      if (known?.version === remote.version) continue
      const local = await device.disk.read(at(remote.path))
      if (local === null && known) continue
      const record = () => {
        mirror.notes[remote.path] = { id: remote.id, version: remote.version, hash: remote.hash }
      }
      if (local !== null && (await sha256(local)) === remote.hash) {
        record()
        continue
      }
      const content = await textOnAccount(remote.id)
      const news = remote.hash !== known?.hash
      const diverged = local !== null && news && (await sha256(local)) !== known?.hash
      record()
      if (!news && local !== null && local !== content) continue
      if (diverged && local !== content) {
        out.copies.push(remote.path)
        continue
      }
      await device.disk.write(at(remote.path), content)
    }
    mirror.cursor = page.cursor
    if (!page.more) break
  }

  const here = [...device.disk.files.keys()]
    .filter((path) => path.startsWith(`${device.root}/`) && path.endsWith('.md'))
    .map((path) => path.slice(device.root.length + 1))
  for (const path of here) {
    const content = (await device.disk.read(at(path))) ?? ''
    const known = mirror.notes[path]
    if (!known) {
      out.created.push(path)
      continue
    }
    if ((await sha256(content)) === known.hash) continue
    const written = await call(env, `/v1/notes/${known.id}`, {
      token,
      method: 'PUT',
      body: { path, content, baseVersion: known.version },
    })
    if (written.status !== 200) {
      out.refused.push(`${path} ${String(written.status)}`)
      continue
    }
    const note = written.json.note as { version: number; hash: string }
    mirror.notes[path] = { id: known.id, version: note.version, hash: note.hash }
  }
  for (const path of Object.keys(mirror.notes)) {
    if (!here.includes(path)) out.deleted.push(path)
  }
  await rooms.settle()
  return out
}
