import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  class Device {
    disk = new Map<string, string>()
    kept = new Map<string, string[]>()
    written = new Map<string, number>()

    keep(path: string, content: string) {
      if (!content.trim()) return
      const held = this.kept.get(path) ?? []
      if (held.at(-1) !== content) this.kept.set(path, [...held, content])
    }
  }

  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  let here = new Device()

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)
    const answer = (value: unknown) => Promise.resolve(value as T)

    switch (command) {
      case 'read_note': {
        const held = here.disk.get(path)
        return held === undefined ? Promise.reject(new Error(`no ${path}`)) : answer(held)
      }
      case 'write_note':
        here.disk.set(path, text(args.content))
        return answer(undefined)
      case 'snapshot_note':
        here.keep(path, text(args.content))
        return answer(undefined)
      case 'list_snapshots':
        return answer(
          [...(here.kept.get(path) ?? [])]
            .map((_, at) => ({ path: `${path}#${at}`, taken_at: at, size: 0 }))
            .reverse(),
        )
      case 'read_snapshot': {
        const [note = '', at = ''] = path.split('#')
        return answer(here.kept.get(note)?.[Number(at)] ?? '')
      }
      case 'file_stamp': {
        const held = here.disk.get(path)
        return answer(held === undefined ? null : { modified: 0, len: held.length })
      }
      case 'trash_item':
        here.disk.delete(path)
        return answer(undefined)
      case 'delete_note':
        here.disk.delete(path)
        return answer(undefined)
      case 'read_file':
        return answer(new TextEncoder().encode(here.disk.get(path) ?? '').buffer)
      case 'read_tree': {
        const root = text(args.root)
        return answer({
          name: root,
          path: root,
          is_dir: true,
          modified: 0,
          created: 0,
          children: [...here.disk.keys()]
            .filter((one) => one.startsWith(`${root}/`))
            .sort()
            .map((one): Entry => ({
              name: one.split('/').pop() ?? one,
              path: one,
              is_dir: false,
              modified: here.written.get(one) ?? 0,
              created: 0,
              children: [],
            })),
        })
      }
    }
    throw new Error(`no such command: ${command}`)
  }

  return {
    Device,
    invoke,
    use: (device: Device) => (here = device),
  }
})

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: world.invoke,
}))

const SERVICE = new URL('../../../../../../services/sync/', import.meta.url).href
interface Env {
  db: { exec(sql: string): void }
  close(): void
}
interface Answer<T> {
  status: number
  json: T
}
interface Harness {
  testEnv: () => Env
  signIn: (env: Env, email: string) => Promise<string>
  call: <T>(
    env: Env,
    path: string,
    options?: { token?: string; body?: unknown; method?: string },
  ) => Promise<Answer<T>>
}
interface Worker {
  default: { fetch(request: Request, env: Env): Promise<Response> }
}
const { default: worker } = (await import(/* @vite-ignore */ `${SERVICE}src/index.ts`)) as Worker
const { call, signIn, testEnv } = (await import(
  /* @vite-ignore */ `${SERVICE}test/harness.ts`
)) as Harness
const { newMirror } = await import('./mirror')
const { pull, push } = await import('./pass')
type Mirror = import('./mirror').Mirror
type Device = InstanceType<typeof world.Device>

const NOBODY = new Set<string>()
const ROOT = '/Plans'

let env: Env
let token: string
let spaceId: string
let device: Device
let offers: string[]
let answering: { to: RegExp; status: number; left: number; page?: boolean } | null
let told: string[]
let listsSaid: { path: string; hash: string }[][]

async function offeredIn(asked: Request): Promise<string | null> {
  const isNote =
    (asked.method === 'POST' && asked.url.endsWith('/notes')) ||
    (asked.method === 'PUT' && /\/v1\/notes\/[^/]+$/.test(asked.url))
  if (!isNote) return null
  const { path } = (await asked.clone().json()) as { path: string }
  return path
}

beforeEach(async () => {
  env = testEnv()
  offers = []
  told = []
  listsSaid = []
  answering = null
  device = new world.Device()
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const asked = new Request(url, init)
    const offered = await offeredIn(asked)
    if (asked.method === 'PUT' && asked.url.endsWith('/files')) {
      const { files } = (await asked.clone().json()) as { files: { path: string; hash: string }[] }
      listsSaid.push(files)
    }
    if (offered !== null) offers.push(offered)
    if (
      answering &&
      answering.left > 0 &&
      answering.to.test(`${asked.method} ${asked.url} ${String(offered)}`)
    ) {
      answering.left -= 1
      return new Response(answering.page ? '<html>too large</html>' : '{"error":"no"}', {
        status: answering.status,
      })
    }
    return worker.fetch(asked, env)
  })
  token = await signIn(env, 'a@example.com')
  const made = await call<{ space?: { id: string } }>(env, '/v1/spaces', {
    token,
    body: { name: 'Plans' },
  })
  spaceId = made.json.space?.id ?? ''
})

afterEach(() => {
  vi.unstubAllGlobals()
  env.close()
})

async function pass(mirror: Mirror) {
  world.use(device)
  await pull(mirror, token, NOBODY)
  await push(mirror, token, NOBODY, { refused: (path) => told.push(path) })
}

async function pathsOnAccount(): Promise<string[]> {
  const page = await call<{ notes: { path: string; deleted?: boolean }[] }>(
    env,
    `/v1/spaces/${spaceId}/changes?since=0`,
    { token },
  )
  return page.json.notes
    .filter((one) => !one.deleted)
    .map((one) => one.path)
    .sort()
}

const put = (name: string, content: string) => device.disk.set(`${ROOT}/${name}`, content)
const BIG = 'x'.repeat(5 * 1024 * 1024)
const DEEP = `${'d/'.repeat(210)}deep.md`

for (const [name, content] of [
  ['board.term', '{"term":1}\n'],
  ['tasks.base', 'views: []\n'],
  ['big.md', BIG],
  ['tab\there.md', 'words\n'],
  [DEEP, 'words\n'],
] as const) {
  test(`${name.slice(0, 16)} refused, the files after it go up and it is said`, async () => {
    put('a.md', 'first\n')
    put(name, content)
    put('z.md', 'last\n')
    const mirror = newMirror(spaceId, ROOT)

    await pass(mirror)

    expect(await pathsOnAccount()).toEqual(['a.md', 'z.md'])
    expect(told).toEqual([name])
    expect(mirror.notes[name]).toBeUndefined()
    expect(mirror.offered[name]).toBeUndefined()
    expect(device.disk.get(`${ROOT}/${name}`)).toBe(content)
  })
}

test('a kind sync v1 cannot carry is not offered at all', async () => {
  put('board.term', '{"term":1}\n')
  put('tasks.base', 'views: []\n')

  await pass(newMirror(spaceId, ROOT))

  expect(offers).toEqual([])
  expect(told.sort()).toEqual(['board.term', 'tasks.base'])
})

test('a tracked note grown past the limit stays the note it was, on both sides', async () => {
  put('grown.md', 'small\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  const entry = { ...mirror.notes['grown.md'] }

  put('grown.md', BIG)
  put('z.md', 'after\n')
  await pass(mirror)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['grown.md', 'z.md'])
  expect(mirror.notes['grown.md']).toEqual(entry)
  expect(mirror.offered['grown.md']).toBeUndefined()
  expect(device.disk.get(`${ROOT}/grown.md`)).toBe(BIG)
  expect(told).toEqual(['grown.md'])

  put('grown.md', 'small again\n')
  await pass(mirror)
  expect(told).toEqual(['grown.md'])
  expect(mirror.notes['grown.md']?.version).toBeGreaterThan(entry.version ?? 0)
})

test('a delete still lands past a refused file', async () => {
  put('gone.md', 'going\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/gone.md`)
  put('tasks.base', 'views: []\n')
  put('big.md', BIG)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual([])
  expect(mirror.notes['gone.md']).toBeUndefined()
})

test('a refused file is not asked about again until it changes, or the next launch', async () => {
  put('big.md', BIG)
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  await pass(mirror)
  await pass(mirror)
  expect(offers).toEqual(['big.md'])

  put('big.md', `${BIG}more`)
  await pass(mirror)
  await pass(mirror)
  expect(offers).toEqual(['big.md', 'big.md'])

  await pass(JSON.parse(JSON.stringify(mirror)) as Mirror)
  expect(offers).toEqual(['big.md', 'big.md', 'big.md'])
})

test('a refused create leaves the record of an earlier write in the air', async () => {
  put('a.md', BIG)
  const mirror = newMirror(spaceId, ROOT)
  mirror.offered['a.md'] = 'the hash of a write whose answer never came'

  await pass(mirror)

  expect(mirror.offered['a.md']).toBe('the hash of a write whose answer never came')
})

for (const [status, kind] of [
  [500, 'a server failing'],
  [503, 'a room away'],
  [429, 'a rate'],
  [507, 'a full account'],
] as const) {
  test(`${kind} on a create is not taken for a refusal`, async () => {
    put('a.md', 'first\n')
    const mirror = newMirror(spaceId, ROOT)
    answering = { to: /POST .*a\.md$/, status, left: 1 }

    await expect(pass(mirror)).rejects.toMatchObject({ status })
    expect(told).toEqual([])

    await pass(mirror)
    expect(await pathsOnAccount()).toEqual(['a.md'])
    expect(told).toEqual([])
  })
}

test('a network that is down is not taken for a refusal', async () => {
  put('a.md', 'first\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  put('a.md', 'second\n')
  const real = globalThis.fetch
  world.use(device)
  await pull(mirror, token, NOBODY)
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')))
  await expect(push(mirror, token, NOBODY)).rejects.toThrow('Failed to fetch')
  vi.stubGlobal('fetch', real)

  await pass(mirror)
  expect(told).toEqual([])
  const words = await call<{ content: string }>(
    env,
    `/v1/notes/${mirror.notes['a.md']?.id ?? ''}`,
    {
      token,
    },
  )
  expect(words.json.content).toBe('second\n')
})

test('a write the account fails on is sent again', async () => {
  put('a.md', 'first\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  put('a.md', 'second\n')
  answering = { to: /PUT .*a\.md$/, status: 500, left: 1 }

  await expect(pass(mirror)).rejects.toMatchObject({ status: 500 })
  expect(mirror.offered['a.md']).toBeDefined()

  await pass(mirror)
  expect(told).toEqual([])
  expect(mirror.offered['a.md']).toBeUndefined()
})

test('a PDF too big to keep leaves the notes going, and is not read again', async () => {
  put('paper.pdf', '%PDF-1.7\n')
  put('z.md', 'last\n')
  const mirror = newMirror(spaceId, ROOT)
  answering = { to: /PUT .*\/v1\/blobs\//, status: 413, left: 1 }

  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['z.md'])
  expect(told).toEqual(['paper.pdf'])
  expect(mirror.files['paper.pdf']).toBeUndefined()

  await pass(mirror)
  expect(mirror.files['paper.pdf']).toBeUndefined()

  device.written.set(`${ROOT}/paper.pdf`, 5)
  await pass(mirror)
  expect(mirror.files['paper.pdf']).toBeDefined()
})

test('a list of more PDFs than a space keeps leaves the notes going', async () => {
  for (let at = 0; at <= 200; at++) put(`paper${String(at)}.pdf`, `%PDF-1.7 ${String(at)}\n`)
  put('z.md', 'last\n')
  const mirror = newMirror(spaceId, ROOT)
  let lists = 0
  const real = globalThis.fetch
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT' && url.endsWith('/files')) lists += 1
    return real(url, init)
  })

  await pass(mirror)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['z.md'])
  expect(lists).toBe(1)
  expect(told).toHaveLength(201)
  expect(mirror.files).toEqual({})
})

async function wordsOf(id: string): Promise<string> {
  return (await call<{ content: string }>(env, `/v1/notes/${id}`, { token })).json.content
}

test('a folder renamed past the path limit keeps its notes on the account', async () => {
  put('notes/one.md', 'one\n')
  put('notes/two.md', 'two\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/notes/one.md`)
  device.disk.delete(`${ROOT}/notes/two.md`)
  put(`${'long/'.repeat(90)}one.md`, 'one\n')
  put(`${'long/'.repeat(90)}two.md`, 'two\n')
  await pass(mirror)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['notes/one.md', 'notes/two.md'])
  expect(mirror.notes['notes/one.md']).toBeDefined()

  device.disk.delete(`${ROOT}/${'long/'.repeat(90)}one.md`)
  device.disk.delete(`${ROOT}/${'long/'.repeat(90)}two.md`)
  await pass(mirror)
  expect(await pathsOnAccount()).toEqual([])
})

test('a note renamed and grown past the limit stays on the account', async () => {
  const words = 'the first line\nthe second line\n'
  put('a.md', words)
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  const id = mirror.notes['a.md']?.id ?? ''

  device.disk.delete(`${ROOT}/a.md`)
  put('b.md', `${words}${BIG}\n`)
  await pass(mirror)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['a.md'])
  expect(await wordsOf(id)).toBe(words)

  put('b.md', words)
  await pass(mirror)
  expect(await pathsOnAccount()).toEqual(['b.md'])
})

test('a note renamed to a kind v1 cannot carry stays on the account', async () => {
  put('a.md', 'the words\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/a.md`)
  put('a.base', 'the words\n')
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual(['a.md'])
})

test('a base of the same name holding other words does not hold a delete', async () => {
  put('tasks.md', 'a list of things\n')
  put('tasks.base', 'views: []\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/tasks.md`)
  await pass(mirror)

  expect(await pathsOnAccount()).toEqual([])
})

test('a delete waits where the account would not say what the note held', async () => {
  put('a.md', 'the words\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/a.md`)
  put('b.md', `the words\n${BIG}`)
  answering = {
    to: new RegExp(`GET .*/v1/notes/${mirror.notes['a.md']?.id ?? ''}`),
    status: 500,
    left: 1,
  }
  await pass(mirror)
  expect(await pathsOnAccount()).toEqual(['a.md'])

  put('b.md', BIG)
  await pass(mirror)
  expect(await pathsOnAccount()).toEqual([])
})

test('a full account still takes a delete, and says it is full', async () => {
  put('gone.md', 'going\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/gone.md`)
  put('new.md', 'other words\n')
  put('z.md', 'more words\n')
  answering = { to: /POST .*new\.md$/, status: 507, left: 1 }
  await expect(pass(mirror)).rejects.toMatchObject({ status: 507 })

  expect(await pathsOnAccount()).toEqual([])
  expect(offers.filter((one) => one === 'z.md')).toEqual([])
  expect(told).toEqual([])

  await pass(mirror)
  expect(await pathsOnAccount()).toEqual(['new.md', 'z.md'])
})

test('a note renamed on a full account stays until the new name lands', async () => {
  put('a.md', 'the words\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/a.md`)
  put('b.md', 'the words\n')
  answering = { to: /POST .*b\.md$/, status: 507, left: 1 }
  await expect(pass(mirror)).rejects.toMatchObject({ status: 507 })
  expect(await pathsOnAccount()).toEqual(['a.md'])

  await pass(mirror)
  expect(await pathsOnAccount()).toEqual(['b.md'])
})

test('a note behind one the full account stopped at holds its delete as well', async () => {
  put('z.md', 'the words\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)

  device.disk.delete(`${ROOT}/z.md`)
  put('a.md', 'other words\n')
  put('y.md', 'the words\n')
  answering = { to: /POST .*a\.md$/, status: 507, left: 1 }
  await expect(pass(mirror)).rejects.toMatchObject({ status: 507 })

  expect(await pathsOnAccount()).toEqual(['z.md'])
})

for (const [status, on] of [
  [413, /POST .*a\.md$/],
  [400, /POST .*a\.md$/],
] as const) {
  test(`an edge's own ${String(status)} on a create ends the pass and is tried again`, async () => {
    put('a.md', 'first\n')
    const mirror = newMirror(spaceId, ROOT)
    answering = { to: on, status, left: 1, page: true }

    await expect(pass(mirror)).rejects.toMatchObject({ status })
    expect(told).toEqual([])

    await pass(mirror)
    expect(await pathsOnAccount()).toEqual(['a.md'])
  })
}

test("an edge's own 413 on a write is sent again", async () => {
  put('a.md', 'first\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  put('a.md', 'second\n')
  answering = { to: /PUT .*a\.md$/, status: 413, left: 1, page: true }

  await expect(pass(mirror)).rejects.toMatchObject({ status: 413 })
  await pass(mirror)

  expect(await wordsOf(mirror.notes['a.md']?.id ?? '')).toBe('second\n')
})

test('a PDF on the list stays on it, as it was, when its new bytes are refused', async () => {
  put('paper.pdf', '%PDF-1.7 small\n')
  put('other.pdf', '%PDF-1.7 other\n')
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  const was = mirror.files['paper.pdf']?.hash ?? ''
  expect(was).not.toBe('')

  put('paper.pdf', '%PDF-1.7 too big now\n')
  device.written.set(`${ROOT}/paper.pdf`, 5)
  answering = { to: /PUT .*\/v1\/blobs\//, status: 413, left: 1 }
  await pass(mirror)

  expect(told).toEqual(['paper.pdf'])
  expect(mirror.files['paper.pdf']?.hash).toBe(was)
  expect(listsSaid.at(-1)?.find((one) => one.path === 'paper.pdf')?.hash).toBe(was)

  const lists = listsSaid.length
  await pass(mirror)
  expect(listsSaid).toHaveLength(lists)
  expect(mirror.files['paper.pdf']?.hash).toBe(was)
})

test('a merge past the limit is that note’s trouble, and the notes after it go', async () => {
  const shared = `${'x'.repeat(70)}\n`.repeat(46_000)
  put('a.md', `top\n${shared}bottom\n`)
  const mirror = newMirror(spaceId, ROOT)
  await pass(mirror)
  const entry = mirror.notes['a.md']
  world.use(device)
  await pull(mirror, token, NOBODY)

  await call(env, `/v1/notes/${entry?.id ?? ''}`, {
    token,
    method: 'PUT',
    body: {
      path: 'a.md',
      content: `${'t'.repeat(600_000)}\ntop\n${shared}bottom\n`,
      baseVersion: entry?.version,
    },
  })
  put('a.md', `top\n${shared}bottom\n${'b'.repeat(600_000)}\n`)
  put('zz.md', 'after\n')
  await push(mirror, token, NOBODY, { refused: (path) => told.push(path) })

  expect(told).toEqual(['a.md'])
  expect(await pathsOnAccount()).toEqual(['a.md', 'zz.md'])
})

test('a create paired with a note, whose write is refused, stays paired and goes on', async () => {
  put('a.md', 'theirs\n')
  const other = newMirror(spaceId, ROOT)
  await pass(other)
  put('z.md', 'after\n')
  put('a.md', 'mine\n')
  const mirror = newMirror(spaceId, ROOT)
  world.use(device)
  answering = { to: /PUT .*a\.md$/, status: 400, left: 1 }
  await push(mirror, token, NOBODY, { refused: (path) => told.push(path) })

  expect(told).toEqual(['a.md'])
  expect(mirror.notes['a.md']).toBeDefined()
  expect(await pathsOnAccount()).toEqual(['a.md', 'z.md'])
})
