import { beforeEach, describe, expect, test, vi } from 'vitest'

/** One space moved between a disk and an account that both live in memory, driven
 *  a pass at a time. What this file is about is the one decision a pass has to
 *  make - both sides changed, now what - and how the answer changes for a note
 *  that is open in a room.
 *
 *  The loop around it, and the pairing of folders with spaces, are tested next
 *  door in sync.test.ts against the whole store. Here `pull` and `push` are called
 *  directly, because which notes are in rooms is something they are handed. */

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
  const calls: string[] = []
  let seq = 0

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) throw new Error(`no such file: ${path}`)
      return Promise.resolve(held as T)
    }

    if (command === 'write_note') {
      calls.push(`write ${path}`)
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'delete_note') {
      disk.delete(path)
      return Promise.resolve(undefined as T)
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

      const tree: Entry = {
        name: root,
        path: root,
        is_dir: true,
        modified: 0,
        created: 0,
        children,
      }
      return Promise.resolve(tree as T)
    }

    throw new Error(`no such command: ${command}`)
  }

  /** The account's own hash, worked out the way the service works it out, so a
   *  pass comparing hashes is comparing real ones. */
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
    writeNote: async (_token: string, id: string, path: string, content: string) => {
      calls.push(`writeNote ${path}`)
      const note = remote.get(id)
      if (!note) throw new Error('no such note')

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      calls.push(`createNote ${path}`)
      const note: Remote = {
        id: `n-${path}`,
        path,
        content,
        version: 1,
        seq: ++seq,
        deleted: false,
      }
      remote.set(note.id, note)
      return { note: await present(note) }
    },
    deleteNote: (_token: string, id: string) => {
      calls.push(`deleteNote ${id}`)
      const note = remote.get(id)
      if (note) Object.assign(note, { deleted: true, seq: ++seq })
      return Promise.resolve({ ok: true as const })
    },
    saveSpaceFiles: () => Promise.resolve({ files: [], missing: [] as string[] }),
  }

  /** A note the account holds, and what its next version will be called. */
  function addRemote(path: string, content: string): string {
    const note: Remote = { id: `n-${path}`, path, content, version: 1, seq: ++seq, deleted: false }
    remote.set(note.id, note)
    return note.id
  }

  function editRemote(id: string, content: string) {
    const note = remote.get(id)
    if (note) Object.assign(note, { content, version: note.version + 1, seq: ++seq })
  }

  function reset() {
    disk.clear()
    remote.clear()
    calls.length = 0
    seq = 0
  }

  return { addRemote, api, calls, disk, editRemote, invoke, remote, reset }
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: fake.api,
}))

const { newMirror, pull, push, within } = await import('./mirror')

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

/** A space paired with the account, with one note that both sides agree about and
 *  a mirror that has already seen it. */
async function paired(path: string, content: string) {
  const id = fake.addRemote(path, content)
  fake.disk.set(`${ROOT}/${path}`, content)

  const mirror = newMirror('s-one', ROOT)
  await pull(mirror, 'token', NOBODY)
  fake.calls.length = 0

  return { mirror, id }
}

/** Whether a conflict copy was written anywhere on the disk. */
function conflicts(): string[] {
  return [...fake.disk.keys()].filter((path) => path.includes('from another device'))
}

describe('a note both sides changed', () => {
  test('keeps the other copy beside ours when there is no room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(conflicts()[0] ?? '')).toBe('base\nwritten there\n')
    // Ours stays where it was, and is sent up as the newer version next.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('writes no second copy for a note that is in a room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten here\nwritten there\n')

    await pull(mirror, 'token', new Set([id]))

    expect(conflicts()).toEqual([])
    // The room settled the two before either became a file, so what comes down is
    // simply what the note now says.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\nwritten there\n')
  })

  test('leaves a note in a room to the room rather than sending the file', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')

    expect(await push(mirror, 'token', new Set([id]))).toBe(false)
    expect(fake.calls).toEqual([])
    // And the account's copy is untouched: the room is what writes it.
    expect(fake.remote.get(id)?.content).toBe('base\n')
  })

  test('sends the file for a note that is in no room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('writeNote note.md')
    expect(fake.remote.get(id)?.content).toBe('base\nwritten here\n')
  })
})

describe('a note only one side changed', () => {
  test('comes down whether or not it is in a room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.editRemote(id, 'base\nfrom elsewhere\n')

    await pull(mirror, 'token', new Set([id]))

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nfrom elsewhere\n')
    expect(conflicts()).toEqual([])
  })

  test('is still created on the account when it is new here', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/fresh.md`, 'new words\n')

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('createNote fresh.md')
  })
})

describe('a file inside a space', () => {
  test('is named the way the account names it', () => {
    expect(within('/Notes', '/Notes/deep/one.md')).toBe('deep/one.md')
    expect(within('C:\\Notes', 'C:\\Notes\\deep\\one.md')).toBe('deep/one.md')
    expect(within('/Notes/', '/Notes/one.md')).toBe('one.md')
  })

  test('is nothing at all when it is somewhere else', () => {
    expect(within('/Notes', '/Other/one.md')).toBeNull()
    expect(within('/Notes', '/NotesToo/one.md')).toBeNull()
    expect(within('/Notes', '/Notes')).toBeNull()
  })
})
