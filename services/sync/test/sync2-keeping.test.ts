import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { frame, unframe } from '@orden/sync-core'
import { parseQuery } from '@orden/scan/search/query'
import type { IndexedNote } from '@orden/scan/wire'
import app from '../src'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

interface Device {
  root: string
  disk: { files: Map<string, string> }
  engine: {
    core: {
      addSpace(id: string, root: string, role: string): unknown[]
      commit(changes: unknown[]): Promise<void>
      spaces: Map<string, unknown>
    }
    pass(space: string): Promise<{ finished: boolean } | null>
    awayFiles(): { id: string; path: string }[]
    fetch(path: string): Promise<boolean>
    keepingFew(): { id: string; root: string }[]
  }
  asked: string[]
  reading: unknown
}

interface IndexRow {
  id: string
  space: string
  docSeq: number
  scan: IndexedNote
}

interface Indexing {
  refresh(): Promise<{ root: string; scans: IndexedNote[] }[]>
  scans(): ReadonlyMap<string, IndexedNote>
  search(
    root: string,
    query: unknown,
    terms: readonly string[],
    limit: number,
    onFound: (found: { hits: { path: string; text: string }[] }) => void,
    excluded: readonly string[],
  ): Promise<void>
}

interface Kit {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    lazy?: boolean
  }): Promise<Device>
  firstPass(core: unknown, space: unknown, v1: null): Promise<boolean>
  Indexing: new (engine: unknown, reading: unknown, store: unknown) => Indexing
}

async function kit(): Promise<Kit> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync-client/${file}`, import.meta.url).href
  const [device, migrate, indexing] = await Promise.all([
    import(/* @vite-ignore */ at('test/test-device.ts')),
    import(/* @vite-ignore */ at('src/migrate.ts')),
    import(/* @vite-ignore */ at('src/indexing.ts')),
  ])
  return { ...(device as object), ...(migrate as object), ...(indexing as object) } as Kit
}

function memoryIndex() {
  const rows = new Map<string, IndexRow>()
  return {
    of: (space: string) => Promise.resolve([...rows.values()].filter((one) => one.space === space)),
    put: (some: readonly IndexRow[]) => {
      for (const one of some) rows.set(one.id, one)
      return Promise.resolve()
    },
    remove: (ids: readonly string[]) => {
      for (const id of ids) rows.delete(id)
      return Promise.resolve()
    },
    close: () => undefined,
  }
}

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'browser@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Kept' } })).json.space.id
})

afterEach(() => env.close())

async function note(path: string, content: string): Promise<string> {
  const made = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  expect(made.status).toBe(201)
  return made.json.note.id
}

const PLANS = '# Plans\n\nThe garden in spring, see [[Ideas]] #work\n\n- [ ] Dig the beds\n'
const IDEAS = '# Ideas\n\nNothing yet.\n'

async function browser(
  through: (request: Request, answer: () => Promise<Response>) => Promise<Response> = (_r, a) =>
    a(),
) {
  const engine = await kit()
  const device = await engine.testDevice({
    fetch: (request) => through(request, async () => await app.fetch(request, env)),
    token,
    lazy: true,
  })
  const core = device.engine.core
  await core.commit(core.addSpace(space, device.root, 'owner'))
  expect(await engine.firstPass(core, core.spaces.get(space), null)).toBe(true)
  await rooms.settle()
  expect((await device.engine.pass(space))?.finished).toBe(true)
  return {
    engine,
    device,
    indexing: new engine.Indexing(device.engine, device.reading, memoryIndex()),
  }
}

const pulls = (device: Device) => device.asked.filter((one) => one.endsWith('/v2/docs/pull'))

describe('a browser keeping only the words it uses, against the Worker', () => {
  test('takes the tree and no words, knows each note by its scan, and searches the rest', async () => {
    const plans = await note('Plans.md', PLANS)
    await note('Ideas.md', IDEAS)
    const { device, indexing } = await browser()

    expect(pulls(device)).toEqual([])
    expect([...device.disk.files.keys()]).toEqual([])
    expect(
      device.engine
        .awayFiles()
        .map((one) => one.path)
        .sort(),
    ).toEqual([`${device.root}/Ideas.md`, `${device.root}/Plans.md`])

    const refreshed = await indexing.refresh()
    expect(refreshed[0]?.scans.map((one) => one.path).sort()).toEqual(['Ideas.md', 'Plans.md'])
    const scan = indexing.scans().get(plans)
    expect(scan?.tags).toEqual(['work'])
    expect(scan?.links.map((one) => one.target)).toEqual(['Ideas'])
    expect(scan?.tasks?.map((one) => one.text)).toEqual(['Dig the beds'])

    const hits: string[] = []
    await indexing.search(
      device.root,
      parseQuery('garden'),
      [],
      10,
      (found) => {
        hits.push(...found.hits.map((hit) => `${hit.path}|${hit.text}`))
      },
      [],
    )
    expect(hits).toEqual([`${device.root}/Plans.md|The garden in spring, see [[Ideas]] #work`])
    expect(pulls(device)).toEqual([])

    expect(await device.engine.fetch(`${device.root}/Plans.md`)).toBe(true)
    expect(device.disk.files.get(`${device.root}/Plans.md`)).toBe(PLANS)
    expect(pulls(device)).toHaveLength(1)
    expect(device.engine.awayFiles().map((one) => one.path)).toEqual([`${device.root}/Ideas.md`])
  })

  test('an account that does not say it serves the rest is kept whole', async () => {
    await note('Plans.md', PLANS)
    await note('Ideas.md', IDEAS)
    const { device } = await browser(async (request, answer) => {
      const answered = await answer()
      if (!new URL(request.url).pathname.endsWith('/feed')) return answered
      const page = unframe(new Uint8Array(await answered.arrayBuffer())) as Record<string, unknown>
      delete page.index
      return new Response(frame(page), { headers: answered.headers })
    })
    expect(device.disk.files.size).toBe(2)
    expect(device.engine.awayFiles()).toEqual([])
  })

  test('one that says so with no route for it is kept whole from the next pass', async () => {
    await note('Plans.md', PLANS)
    await note('Ideas.md', IDEAS)
    const { device, indexing } = await browser(async (request, answer) =>
      new URL(request.url).pathname.endsWith('/index')
        ? new Response('404 Not Found', { status: 404 })
        : await answer(),
    )
    expect(device.disk.files.size).toBe(0)
    await indexing.refresh()
    expect(device.engine.keepingFew()).toEqual([])
    await device.engine.pass(space)
    expect(device.disk.files.get(`${device.root}/Plans.md`)).toBe(PLANS)
    expect(device.disk.files.get(`${device.root}/Ideas.md`)).toBe(IDEAS)
  })
})
