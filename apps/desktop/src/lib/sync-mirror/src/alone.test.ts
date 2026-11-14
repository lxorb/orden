import { beforeEach, describe, expect, test, vi } from 'vitest'

const { ApiError } = await import('../../accounts/src/api')

const fake = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  interface Remote {
    id: string
    path: string
    content: string
    version: number
    seq: number
    deleted: boolean
  }

  const disk = new Map<string, string>()
  const remote = new Map<string, Remote>()
  let seq = 0
  let loseTheAnswer = false
  let between: (() => void) | null = null

  function meanwhile() {
    const now = between
    between = null
    now?.()
  }

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      return Promise.resolve(held as T)
    }

    if (command === 'write_note') {
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'snapshot_note' || command === 'delete_note') {
      if (command === 'delete_note') disk.delete(path)
      return Promise.resolve(undefined as T)
    }

    if (command === 'file_stamp') {
      const held = disk.get(path)
      return Promise.resolve((held === undefined ? null : { modified: 0, len: held.length }) as T)
    }

    if (command === 'read_tree') {
      const root = text(args.root)
      const children = [...disk.keys()]
        .filter((one) => one.startsWith(`${root}/`))
        .sort()
        .map((one): Entry => ({
          name: one.split('/').pop() ?? one,
          path: one,
          is_dir: false,
          modified: 0,
          created: 0,
          children: [],
        }))

      return Promise.resolve({
        name: root,
        path: root,
        is_dir: true,
        modified: 0,
        created: 0,
        children,
      } as T)
    }

    throw new Error(`no such command: ${command}`)
  }

  async function hashOf(content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  async function present(note: Remote) {
    return {
      id: note.id,
      path: note.path,
      seq: note.seq,
      version: note.version,
      updatedAt: 0,
      deleted: note.deleted,
      size: note.content.length,
      hash: await hashOf(note.content),
    }
  }

  const api = {
    changes: async (_token: string, _spaceId: string, since: number) => {
      const notes = [...remote.values()]
        .filter((one) => one.seq > since)
        .sort((a, b) => a.seq - b.seq)

      return {
        notes: await Promise.all(notes.map(present)),
        cursor: notes.at(-1)?.seq ?? since,
        more: false,
      }
    },
    readNote: async (_token: string, id: string) => {
      const note = remote.get(id)
      if (!note) throw new Error('no such note')
      return { note: await present(note), content: note.content }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      baseVersion: number,
    ) => {
      const note = remote.get(id)
      if (!note) throw new Error('no such note')
      meanwhile()

      if (note.version !== baseVersion) {
        throw new ApiError(409, 'a note already lives there', {
          note: await present(note),
          content: note.content,
        })
      }

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      if (loseTheAnswer) {
        loseTheAnswer = false
        throw new TypeError('Failed to fetch')
      }

      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      const taken = [...remote.values()].find((one) => one.path === path && !one.deleted)
      if (taken) {
        throw new ApiError(409, 'a note already lives there', {
          note: await present(taken),
          content: taken.content,
        })
      }

      const note: Remote = {
        id: `n-${path}`,
        path,
        content,
        version: 1,
        seq: ++seq,
        deleted: false,
      }
      remote.set(note.id, note)
      if (loseTheAnswer) {
        loseTheAnswer = false
        throw new TypeError('Failed to fetch')
      }

      return { note: await present(note) }
    },
    deleteNote: (_token: string, id: string) => {
      const note = remote.get(id)
      if (note) Object.assign(note, { deleted: true, seq: ++seq })
      return Promise.resolve({ ok: true as const })
    },
    saveSpaceFiles: () => Promise.resolve({ files: [], missing: [] as string[] }),
  }

  function addRemote(path: string, content: string): string {
    const note: Remote = { id: `n-${path}`, path, content, version: 1, seq: ++seq, deleted: false }
    remote.set(note.id, note)
    return note.id
  }

  function settles(path: string, content: string) {
    const note = [...remote.values()].find((one) => one.path === path && !one.deleted)
    if (!note) throw new Error(`no note at ${path}`)

    Object.assign(note, { content, version: note.version + 1, seq: ++seq })
  }

  function reset() {
    disk.clear()
    remote.clear()
    seq = 0
    loseTheAnswer = false
    between = null
  }

  return {
    addRemote,
    api,
    disk,
    hashOf,
    invoke,
    lose: () => (loseTheAnswer = true),
    meanwhile: (then: () => void) => (between = then),
    remote,
    reset,
    settles,
  }
})

vi.mock('../../platform/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/api')>()),
  invoke: fake.invoke,
}))

vi.mock('../../accounts/src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../accounts/src/api')>()),
  api: fake.api,
}))

const { newMirror, readMirror } = await import('./mirror')
const { pull, push } = await import('./pass')
type Mirror = import('./mirror').Mirror
type Joined = import('./pass').Joined

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

async function alone(path: string, content: string) {
  const id = fake.addRemote(path, content)
  fake.disk.set(`${ROOT}/${path}`, content)

  const mirror = newMirror('s-one', ROOT)
  await pull(mirror, 'token', NOBODY)
  await push(mirror, 'token', NOBODY)

  return { mirror, id }
}

function types(path: string, content: string) {
  fake.disk.set(`${ROOT}/${path}`, content)
}

async function pass(mirror: Mirror, rooms: Joined = NOBODY) {
  await pull(mirror, 'token', rooms)
  await push(mirror, 'token', rooms)
}

function files(): string[] {
  return [...fake.disk.keys()].sort()
}

function account(): string[] {
  return [...fake.remote.values()]
    .filter((one) => !one.deleted)
    .map((one) => one.path)
    .sort()
}

function reloaded(mirror: Mirror, { caches = true } = {}): Mirror {
  const written = JSON.parse(
    JSON.stringify(caches ? mirror : { ...mirror, notes: {}, files: {}, dropped: true }),
  ) as unknown

  const read = readMirror(mirror.root, written)
  if (!read) throw new Error('a mirror that no longer reads as one')
  return read
}

describe('one device typing in one note', () => {
  test('makes one file and one note however many passes run', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(mirror)
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  test('makes no second copy when a push lands and its answer is lost', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\none\ntwo\n')
  })

  test('makes no second copy when the lost answer is a launch ago', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    const next = reloaded(mirror)
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  test('makes no second copy when a full storage dropped the note cache', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await push(mirror, 'token', NOBODY)

    const next = reloaded(mirror, { caches: false })
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  test('makes one note when the note is renamed between keystrokes', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)

    fake.disk.delete(`${ROOT}/Plan.md`)
    types('Notes on the plan.md', '# Notes on the plan\none\n')
    await pass(mirror)

    types('Notes on the plan.md', '# Notes on the plan\none\ntwo\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Notes on the plan.md`])
    expect(account()).toEqual(['Notes on the plan.md'])
  })

  test.fails('does not put the old name back when a rename outran the mirror', async () => {
    const { mirror } = await alone('Plan.md', '# Plan\n')

    fake.disk.delete(`${ROOT}/Plan.md`)
    types('Notes on the plan.md', '# Notes on the plan\n')

    const next = reloaded({ ...mirror, notes: {}, cursor: 0 }, { caches: false })
    await pass(next)

    expect(files()).toEqual([`${ROOT}/Notes on the plan.md`])
    expect(account()).toEqual(['Notes on the plan.md'])
  })

  test('makes no second copy when its room settles while the push is in the air', async () => {
    const { mirror, id } = await alone('Plan.md', '# Plan\n')
    const room = new Set<string>()

    types('Plan.md', '# Plan\none\n')

    fake.meanwhile(() => {
      room.add(id)
      fake.settles('Plan.md', '# Plan\none\n')
    })
    await pass(mirror, room)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })

  test('offers the note again once its room has gone', async () => {
    const { mirror, id } = await alone('Plan.md', '# Plan\n')
    const room = new Set<string>()

    types('Plan.md', '# Plan\none\n')
    fake.meanwhile(() => {
      room.add(id)
      fake.settles('Plan.md', '# Plan\none\n')
    })
    await pass(mirror, room)

    room.clear()
    types('Plan.md', '# Plan\none\ntwo\n')
    await pass(mirror, room)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
    expect([...fake.remote.values()][0]?.content).toBe('# Plan\none\ntwo\n')
  })

  test('makes no second copy when a create landed and its answer was lost', async () => {
    const mirror = newMirror('s-one', ROOT)
    types('Plan.md', '# Plan\n')

    fake.lose()
    await expect(push(mirror, 'token', NOBODY)).rejects.toThrow()

    types('Plan.md', '# Plan\none\n')
    await pass(mirror)

    expect(files()).toEqual([`${ROOT}/Plan.md`])
    expect(account()).toEqual(['Plan.md'])
  })
})
