import { afterEach, beforeEach, expect, test } from 'vitest'
import app from '../src/index'
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
    new URL(`../../../apps/desktop/src/lib/sync2/${file}`, import.meta.url).href
  const [device, migrate, engine] = await Promise.all([
    import(/* @vite-ignore */ at('test-device.ts')),
    import(/* @vite-ignore */ at('migrate.ts')),
    import(/* @vite-ignore */ at('engine.ts')),
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

const onDisk = (one: Device) =>
  Object.fromEntries(
    [...one.disk.files.entries()].map(([path, words]) => [path.slice(one.root.length + 1), words]),
  )

test('a folder deleted while a new note in it is listed and not pulled comes back whole', async () => {
  const a = await device('a', { 'f/one.md': 'one\n', 'f/two.md': 'two\n', 'keep.md': 'keep\n' })
  await passed(a)
  const b = await device(
    'b',
    {},
    { token: await signIn(env, 'pictures@example.com'), role: 'owner' },
  )
  await passed(a, b)

  await a.disk.write(`${a.root}/f/new.md`, 'new from A\n')
  await a.engine.foreign(`${a.root}/f/new.md`)
  await a.engine.created(`${a.root}/f/new.md`, false, 'new from A\n')
  await passed(a)

  const { readFeed } = (await import(
    /* @vite-ignore */ new URL('../../../apps/desktop/src/lib/sync2/pass.ts', import.meta.url).href
  )) as { readFeed: (core: unknown, space: unknown, go: () => boolean) => Promise<unknown> }
  await readFeed(b.engine.core, b.engine.core.spaces.get(space), () => true)
  expect(onDisk(b)['f/new.md']).toBeUndefined()

  for (const path of [...b.disk.files.keys()]) {
    if (path.includes('/f/')) await b.disk.remove(path)
  }
  await b.engine.removed(`${b.root}/f`)
  await passed(a, b, a, b, a, b)

  const whole = {
    'f/one.md': 'one\n',
    'f/two.md': 'two\n',
    'f/new.md': 'new from A\n',
    'keep.md': 'keep\n',
  }
  expect(onDisk(b)).toEqual(whole)
  expect(onDisk(a)).toEqual(whole)
  const { results } = await env.DB.prepare(
    'select count(*) as gone from notes where space_id = ? and deleted = 1',
  )
    .bind(space)
    .all<{ gone: number }>()
  expect(results[0]?.gone).toBe(0)
})
