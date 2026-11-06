import { beforeEach, describe, expect, test, vi } from 'vitest'

const { ApiError } = await import('../api')

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
    updatedAt?: number
  }

  const disk = new Map<string, string>()
  const remote = new Map<string, Remote>()
  const calls: string[] = []
  const fetched: string[] = []
  const history = new Map<string, string[]>()
  const modified = new Map<string, number>()
  const unreadable = new Set<string>()
  const renamed: { hook: (() => void) | null } = { hook: null }
  const refusing: { delete: Error | null; moving: Set<string> } = {
    delete: null,
    moving: new Set(),
  }
  const readsLeft = new Map<string, number>()
  const blobs = new Set<string>()
  const blobsPut: string[] = []
  const trash = new Map<string, { path: string; content: string }>()
  let seq = 0

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      if (unreadable.has(path)) {
        return Promise.reject(new Error(`stream did not contain valid UTF-8: ${path}`))
      }
      return Promise.resolve(held as T)
    }

    if (command === 'file_stamp') {
      const held = disk.get(path)
      if (held === undefined) return Promise.resolve(null as T)
      return Promise.resolve({ modified: modified.get(path) ?? 0, len: held.length } as T)
    }

    if (command === 'write_note') {
      calls.push(`write ${path}`)
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'snapshot_note') {
      const content = text(args.content)
      const kept = history.get(path) ?? []
      if (content.trim() && kept.at(-1) !== content) history.set(path, [...kept, content])
      return Promise.resolve(undefined as T)
    }

    if (command === 'list_snapshots') return Promise.resolve([] as T)

    if (command === 'rename_note') {
      const from = text(args.from)
      const to = text(args.to)
      calls.push(`rename ${from} ${to}`)
      const held = disk.get(from)
      if (held === undefined) return Promise.reject(new Error(`no such file: ${from}`))
      if (refusing.moving.has(from)) return Promise.reject(new Error(`${from} is in use`))
      if (disk.has(to)) return Promise.reject(new Error(`${to} is already there`))

      disk.delete(from)
      disk.set(to, held)
      renamed.hook?.()
      const paper = disk.get(`${from}.pdf`)
      if (from.endsWith('.pages') && paper !== undefined) {
        disk.delete(`${from}.pdf`)
        disk.set(`${to}.pdf`, paper)
      }
      return Promise.resolve(undefined as T)
    }

    if (command === 'delete_note') {
      calls.push(`delete ${path}`)
      disk.delete(path)
      return Promise.resolve(undefined as T)
    }

    if (command === 'trash_item') {
      calls.push(`trash ${path}`)
      const held = disk.get(path)
      if (held === undefined) return Promise.reject(new Error('nothing is there'))

      const id = `t-${trash.size}`
      trash.set(id, { path, content: held })
      disk.delete(path)
      return Promise.resolve({ id } as T)
    }

    if (command === 'restore_trash') {
      const held = trash.get(text(args.id))
      if (!held) return Promise.reject(new Error('nothing to restore'))

      trash.delete(text(args.id))
      disk.set(held.path, held.content)
      return Promise.resolve(held.path as T)
    }

    if (command === 'read_file') {
      const held = disk.get(path)
      const left = readsLeft.get(path)
      if (held === undefined || left === 0) {
        return Promise.reject(new Error(`no such file: ${path}`))
      }
      if (left !== undefined) readsLeft.set(path, left - 1)
      return Promise.resolve(new TextEncoder().encode(held).buffer as T)
    }

    if (command === 'read_tree') {
      const root = text(args.root)
      const children = [...disk.keys()]
        .filter((one) => one.startsWith(`${root}/`) && !one.split('/').pop()?.startsWith('.'))
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
      updatedAt: note.updatedAt ?? 0,
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
      fetched.push(note.path)
      return { note: await present(note), content: note.content }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      _baseVersion = 0,
    ) => {
      calls.push(`writeNote ${path}`)
      const note = remote.get(id)
      if (!note) throw new Error('no such note')

      Object.assign(note, { path, content, version: note.version + 1, seq: ++seq })
      return { note: await present(note) }
    },
    createNote: async (_token: string, _spaceId: string, path: string, content: string) => {
      calls.push(`createNote ${path}`)

      const taken = [...remote.values()].find((one) => one.path === path && !one.deleted)
      if (taken) {
        throw new ApiError(409, 'a note already lives there', {
          note: await present(taken),
          content: taken.content,
        })
      }

      const named = `n-${path}`
      const note: Remote = {
        id: remote.has(named) ? `${named}-${seq + 1}` : named,
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
      if (refusing.delete) return Promise.reject(refusing.delete)
      const note = remote.get(id)
      if (note) Object.assign(note, { deleted: true, seq: ++seq })
      return Promise.resolve({ ok: true as const })
    },
    saveSpaceFiles: (_token: string, _spaceId: string, files: { hash: string }[]) =>
      Promise.resolve({
        files: [],
        missing: files.map((one) => one.hash).filter((hash) => !blobs.has(hash)),
      }),
    putBlob: (_token: string, hash: string) => {
      blobs.add(hash)
      blobsPut.push(hash)
      return Promise.resolve({ ok: true as const })
    },
    said: () => Promise.resolve({ said: [] as string[] }),
    saidAs: () => Promise.reject(new ApiError(404, 'no such version')),
  }

  function addRemote(path: string, content: string): string {
    const note: Remote = { id: `n-${path}`, path, content, version: 1, seq: ++seq, deleted: false }
    remote.set(note.id, note)
    return note.id
  }

  function deleteRemote(id: string) {
    const note = remote.get(id)
    if (note) Object.assign(note, { deleted: true, version: note.version + 1, seq: ++seq })
  }

  function renameRemote(id: string, path: string, content?: string) {
    const note = remote.get(id)
    if (!note) return
    Object.assign(note, { path, version: note.version + 1, seq: ++seq })
    if (content !== undefined) note.content = content
  }

  function editRemote(id: string, content: string, updatedAt = 0) {
    const note = remote.get(id)
    if (note) Object.assign(note, { content, version: note.version + 1, seq: ++seq, updatedAt })
  }

  function reset() {
    disk.clear()
    remote.clear()
    history.clear()
    modified.clear()
    unreadable.clear()
    trash.clear()
    readsLeft.clear()
    blobs.clear()
    blobsPut.length = 0
    refusing.delete = null
    refusing.moving.clear()
    renamed.hook = null
    calls.length = 0
    fetched.length = 0
    seq = 0
  }

  return {
    addRemote,
    api,
    blobsPut,
    calls,
    deleteRemote,
    disk,
    editRemote,
    fetched,
    history,
    invoke,
    modified,
    readsLeft,
    refusing,
    remote,
    renameRemote,
    renamed,
    reset,
    trash,
    unreadable,
  }
})

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: fake.api,
}))

const { newMirror, readMirror, within } = await import('./mirror')
const { asidesBack, movedHere, pull, push } = await import('./pass')
type Clash = import('./conflicts').Clash

const ROOT = '/Notes'
const NOBODY: ReadonlySet<string> = new Set()

beforeEach(() => {
  fake.reset()
})

async function paired(path: string, content: string) {
  const id = fake.addRemote(path, content)
  fake.disk.set(`${ROOT}/${path}`, content)

  const mirror = newMirror('s-one', ROOT)
  await pull(mirror, 'token', NOBODY)
  fake.calls.length = 0

  return { mirror, id }
}

function conflicts(): string[] {
  return [...fake.disk.keys()].filter((path) => path.includes('from another device'))
}

describe('a note renamed on this machine', () => {
  const HERE = '# One' + String.fromCharCode(10)

  function renameOnDisk(from: string, to: string) {
    const held = fake.disk.get(`${ROOT}/${from}`) ?? ''
    fake.disk.delete(`${ROOT}/${from}`)
    fake.disk.set(`${ROOT}/${to}`, held)
  }

  test('keeps its id, and the account holds one note at the new name', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    expect(await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)).toBe(true)

    expect(fake.calls).toEqual(['writeNote Two.md'])
    expect(fake.remote.get(id)?.path).toBe('Two.md')
    expect(fake.remote.get(id)?.deleted).toBe(false)
    expect(mirror.notes['Two.md']?.id).toBe(id)
    expect(mirror.notes['One.md']).toBeUndefined()
  })

  test('and the pass that follows has nothing left to do about it', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()].sort()).toEqual([`${ROOT}/Two.md`])
    expect([...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.id)).toEqual([
      id,
    ])
  })

  test('and a rename that only changes case is the same note, not another one', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'one.md')

    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/one.md`)

    expect(fake.calls).toEqual(['writeNote one.md'])
    expect([...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.id)).toEqual([
      id,
    ])
    expect(mirror.notes['one.md']?.id).toBe(id)
  })

  test('and follows a room that moved past this machine while the name changed', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    const THEIRS = '# One, and a sentence somebody typed' + String.fromCharCode(10)
    fake.editRemote(id, THEIRS)
    const stale = fake.api.writeNote
    fake.api.writeNote = async (token, noteId, path, content, base) => {
      if (base !== fake.remote.get(noteId)?.version) throw new ApiError(409, 'a version behind', {})
      return stale(token, noteId, path, content, base)
    }

    try {
      expect(await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)).toBe(true)
    } finally {
      fake.api.writeNote = stale
    }

    expect(fake.remote.get(id)?.path).toBe('Two.md')
    expect(fake.remote.get(id)?.content).toBe(THEIRS)
    expect(mirror.notes['Two.md']?.id).toBe(id)
  })

  describe('and another device wrote in it while the name changed', () => {
    const THEIRS =
      '# One' + String.fromCharCode(10) + 'typed on the other device' + String.fromCharCode(10)

    async function racing(mine?: string) {
      const pairing = await paired('One.md', HERE)
      fake.editRemote(pairing.id, THEIRS)
      if (mine !== undefined) fake.disk.set(`${ROOT}/One.md`, mine)
      renameOnDisk('One.md', 'Two.md')

      const stale = fake.api.writeNote
      fake.api.writeNote = async (token, noteId, path, content, base) => {
        if (base !== fake.remote.get(noteId)?.version) throw new ApiError(409, 'behind', {})
        return stale(token, noteId, path, content, base)
      }
      try {
        await movedHere(pairing.mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
      } finally {
        fake.api.writeNote = stale
      }
      return pairing
    }

    test('brings their words down where nothing was typed here', async () => {
      const { mirror, id } = await racing()

      await pull(mirror, 'token', NOBODY)
      await push(mirror, 'token', NOBODY)

      expect(fake.remote.get(id)?.content).toBe(THEIRS)
      expect(fake.disk.get(`${ROOT}/Two.md`)).toBe(THEIRS)
      expect(conflicts()).toEqual([])
    })

    test('and keeps both where something was', async () => {
      const MINE = HERE + 'typed here' + String.fromCharCode(10)
      const { mirror, id } = await racing(MINE)

      await pull(mirror, 'token', NOBODY, { rule: 'both' })
      await push(mirror, 'token', NOBODY)

      const words = [fake.remote.get(id)?.content, ...conflicts().map((one) => fake.disk.get(one))]
      expect(words).toContain(THEIRS)
      expect(fake.disk.get(`${ROOT}/Two.md`)).toBe(MINE)
    })

    test('and asks, under the rule that asks', async () => {
      const { mirror, id } = await racing(HERE + 'typed here' + String.fromCharCode(10))
      const clashes: Clash[] = []

      await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: (one) => clashes.push(one) })
      await push(mirror, 'token', NOBODY, { held: new Set(clashes.map((one) => one.path)) })

      expect(clashes.map((one) => one.theirs)).toEqual([THEIRS])
      expect(fake.remote.get(id)?.content).toBe(THEIRS)
    })
  })

  test('and a note waiting to be settled keeps the copy nobody has looked at', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    fake.disk.set(`${ROOT}/One.md`, `${HERE}here\n`)
    fake.editRemote(id, `${HERE}there\n`)
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: () => undefined })
    renameOnDisk('One.md', 'Two.md')

    const asked: Clash[] = []
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set([id]), (one) =>
      asked.push(one),
    )

    expect(fake.remote.get(id)).toMatchObject({ path: 'Two.md', content: `${HERE}there\n` })
    expect(asked).toEqual([
      expect.objectContaining({
        path: `${ROOT}/Two.md`,
        id,
        version: fake.remote.get(id)!.version,
        theirs: `${HERE}there\n`,
      }),
    ])
    expect(mirror.notes['Two.md']).toMatchObject({ id, hash: '' })
    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe(`${HERE}here\n`)
  })

  test('and a note waiting to be settled, renamed while the account was away, is kept', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    fake.disk.set(`${ROOT}/One.md`, `${HERE}here\n`)
    fake.editRemote(id, `${HERE}there\n`)
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: () => undefined })
    renameOnDisk('One.md', 'Two.md')
    fake.refusing.delete = null
    const reading = fake.api.readNote
    fake.api.readNote = () => Promise.reject(new TypeError('Failed to fetch'))
    expect(
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set([id])),
    ).toBe(true)
    expect(mirror.notes['One.md']?.id).toBe(id)
    fake.api.readNote = reading
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY, {
      rule: 'ask',
      clashed: () => undefined,
      held: new Set([`${ROOT}/Two.md`]),
      asked: new Set([id]),
    })
    await push(mirror, 'token', NOBODY, { held: new Set([`${ROOT}/Two.md`]), asked: new Set([id]) })

    expect(fake.calls.filter((one) => /^(deleteNote|createNote)/.test(one))).toEqual([])
    expect(fake.remote.get(id)).toMatchObject({ deleted: false, content: `${HERE}there\n` })
  })

  test('and one renamed and answered while the account was away keeps its note', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    fake.disk.set(`${ROOT}/One.md`, `${HERE}here\n`)
    fake.editRemote(id, `${HERE}there\n`)
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: () => undefined })
    renameOnDisk('One.md', 'Two.md')
    const reading = fake.api.readNote
    const writing = fake.api.writeNote
    fake.api.readNote = () => Promise.reject(new TypeError('Failed to fetch'))
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set([id]))
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set())
    fake.api.readNote = reading
    fake.api.writeNote = async (token, noteId, path, content, base) => {
      if (base !== fake.remote.get(noteId)?.version) throw new ApiError(409, 'a version behind', {})
      return writing(token, noteId, path, content, base)
    }
    fake.editRemote(id, `${HERE}there\nand more there\n`)
    fake.calls.length = 0

    const clashes: Clash[] = []
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: (one) => clashes.push(one) })
    await push(mirror, 'token', NOBODY, {
      held: new Set(clashes.map((one) => one.path)),
      asked: new Set(clashes.map((one) => one.id)),
    })

    expect(fake.calls.filter((one) => /^(deleteNote|createNote)/.test(one))).toEqual([])
    expect(fake.remote.get(id)).toMatchObject({
      deleted: false,
      path: 'Two.md',
      content: `${HERE}there\nand more there\n`,
    })
    expect(clashes).toEqual([
      expect.objectContaining({
        path: `${ROOT}/Two.md`,
        id,
        theirs: `${HERE}there\nand more there\n`,
      }),
    ])
    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe(`${HERE}here\n`)
    fake.api.writeNote = writing
  })

  test('and a new note at the name one waiting to be settled left is a note of its own', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    fake.disk.set(`${ROOT}/One.md`, `${HERE}here\n`)
    fake.editRemote(id, `${HERE}there\n`)
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: () => undefined })
    renameOnDisk('One.md', 'Two.md')
    const reading = fake.api.readNote
    fake.api.readNote = () => Promise.reject(new TypeError('Failed to fetch'))
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set([id]))
    fake.api.readNote = reading
    fake.disk.set(`${ROOT}/One.md`, '# Shopping\nmilk\n')
    fake.calls.length = 0

    const clashes: Clash[] = []
    await pull(mirror, 'token', NOBODY, {
      rule: 'ask',
      clashed: (one) => clashes.push(one),
      held: new Set([`${ROOT}/Two.md`]),
      asked: new Set([id]),
    })
    await push(mirror, 'token', NOBODY, { held: new Set([`${ROOT}/Two.md`]), asked: new Set([id]) })

    expect(fake.remote.get(id)).toMatchObject({ path: 'Two.md', content: `${HERE}there\n` })
    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([
      'writeNote Two.md',
      'createNote One.md',
    ])
    expect(clashes.map((one) => one.path)).toEqual([`${ROOT}/Two.md`])
    expect(mirror.notes['One.md']?.id).not.toBe(id)
  })

  test('and one renamed twice while the account was away is told where it is now', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    fake.disk.set(`${ROOT}/One.md`, `${HERE}here\n`)
    fake.editRemote(id, `${HERE}there\n`)
    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: () => undefined })
    const reading = fake.api.readNote
    fake.api.readNote = () => Promise.reject(new TypeError('Failed to fetch'))
    renameOnDisk('One.md', 'Two.md')
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`, new Set([id]))
    renameOnDisk('Two.md', 'Three.md')
    await movedHere(mirror, 'token', `${ROOT}/Two.md`, `${ROOT}/Three.md`, new Set([id]))
    fake.api.readNote = reading
    const back = readMirror(ROOT, JSON.parse(JSON.stringify(mirror)))!

    const clashes: Clash[] = []
    await pull(back, 'token', NOBODY, {
      rule: 'ask',
      clashed: (one) => clashes.push(one),
      held: new Set([`${ROOT}/Three.md`]),
      asked: new Set([id]),
    })

    expect(fake.remote.get(id)).toMatchObject({ path: 'Three.md', content: `${HERE}there\n` })
    expect(back.notes['Three.md']).toMatchObject({ id, hash: '' })
    expect(back.untold).toBeUndefined()
    expect(clashes.map((one) => one.path)).toEqual([`${ROOT}/Three.md`])
  })

  test.each([503, 409])(
    'and a note whose write keeps answering %i holds up no other note',
    async (status) => {
      const first = await paired('A.md', HERE)
      const second = fake.addRemote('B.md', HERE)
      fake.disk.set(`${ROOT}/B.md`, HERE)
      await pull(first.mirror, 'token', NOBODY)
      fake.disk.set(`${ROOT}/A.md`, `${HERE}a\n`)
      fake.disk.set(`${ROOT}/B.md`, `${HERE}b\n`)
      const writing = fake.api.writeNote
      fake.api.writeNote = (token, id, ...rest) => {
        if (id !== first.id) return writing(token, id, ...rest)
        const note = { id, version: 1, hash: 'theirs' }
        return Promise.reject(new ApiError(status, 'no', { note, content: `${HERE}x\n` }))
      }

      await push(first.mirror, 'token', NOBODY)
      fake.api.writeNote = writing

      expect(fake.remote.get(second)?.content).toBe(`${HERE}b\n`)
    },
  )

  test('and one the account refused to rename is told again, never deleted', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new ApiError(503, 'busy', {}))
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
    await push(mirror, 'token', NOBODY)
    fake.api.writeNote = writing

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls.filter((one) => /^(deleteNote|createNote)/.test(one))).toEqual([])
    expect(fake.remote.get(id)).toMatchObject({ path: 'Two.md', deleted: false })
    expect(mirror.notes['Two.md']?.id).toBe(id)
    expect(mirror.untold).toBeUndefined()
  })

  test.each([
    ['for good', [400], 1],
    ['too often', [409], 5],
  ])('and one the account refuses %s is let go of without a delete', async (_, [status], times) => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new ApiError(status!, 'no', {}))
    try {
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
      for (let one = 1; one < times; one++) {
        expect(mirror.untold?.[id]).toBeDefined()
        await pull(mirror, 'token', NOBODY)
      }
      expect(mirror.untold).toBeUndefined()

      await pull(mirror, 'token', NOBODY)
      await push(mirror, 'token', NOBODY)
    } finally {
      fake.api.writeNote = writing
    }

    expect(fake.calls.filter((one) => one.startsWith('deleteNote'))).toEqual([])
    expect(fake.calls).toContain('createNote Two.md')
    expect(fake.remote.get(id)).toMatchObject({ path: 'One.md', deleted: false })
  })

  function clock() {
    let now = Date.UTC(2026, 9, 26, 9)
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    return {
      on: (ms: number) => {
        now += ms
      },
      [Symbol.dispose]: () => spy.mockRestore(),
    }
  }

  test.each([503, 408, 429])(
    'and one renamed while the account answers %i for a moment is told once it answers',
    async (status) => {
      const { mirror, id } = await paired('One.md', HERE)
      renameOnDisk('One.md', 'Two.md')
      const writing = fake.api.writeNote
      const reading = fake.api.readNote
      const asking = fake.api.changes
      const failing = () => Promise.reject(new ApiError(status, 'not now', {}))
      fake.api.writeNote = failing
      fake.api.readNote = failing
      fake.api.changes = failing
      try {
        using time = clock()
        await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
        for (let one = 0; one < 8; one++) {
          time.on(2_000)
          await pull(mirror, 'token', NOBODY).catch(() => false)
        }
        expect(mirror.untold?.[id]).toBeDefined()
      } finally {
        fake.api.writeNote = writing
        fake.api.readNote = reading
        fake.api.changes = asking
      }
      fake.calls.length = 0

      await pull(mirror, 'token', NOBODY)
      await push(mirror, 'token', NOBODY)

      expect(fake.calls.filter((one) => /^(deleteNote|createNote|write )/.test(one))).toEqual([])
      expect(fake.remote.get(id)).toMatchObject({ path: 'Two.md', deleted: false })
      expect([...fake.disk.keys()]).toEqual([`${ROOT}/Two.md`])
    },
  )

  test('and one the account keeps failing to rename is let go of in the end', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new ApiError(503, 'this room is not answering', {}))
    try {
      using time = clock()
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
      time.on(6 * 60 * 60_000)
      await pull(mirror, 'token', NOBODY)
      expect(mirror.untold?.[id]?.failing).toEqual({
        since: Date.now() - 6 * 60 * 60_000,
        times: 2,
      })
      const back = readMirror(ROOT, JSON.parse(JSON.stringify(mirror)))!
      expect(back.untold).toEqual(mirror.untold)
      for (let one = 0; one < 30 && mirror.untold; one++) {
        time.on(5 * 60_000)
        await pull(mirror, 'token', NOBODY)
      }
      expect(mirror.untold).toBeUndefined()

      await pull(mirror, 'token', NOBODY)
      await push(mirror, 'token', NOBODY)
    } finally {
      fake.api.writeNote = writing
    }

    expect(fake.calls.filter((one) => one.startsWith('deleteNote'))).toEqual([])
    expect(fake.calls).toContain('createNote Two.md')
    expect(fake.remote.get(id)).toMatchObject({ path: 'One.md', deleted: false })
  })

  test('and one still untold leaves the rest of the space to be read', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    const writing = fake.api.writeNote
    const asking = fake.api.changes
    fake.api.writeNote = () => Promise.reject(new ApiError(503, 'this room is not answering', {}))
    fake.api.changes = async (token, spaceId, since) => {
      const all = await asking(token, spaceId, since)
      const first = all.notes[0]
      return first ? { notes: [first], cursor: first.seq, more: all.notes.length > 1 } : all
    }
    try {
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
      fake.editRemote(id, `${HERE}there\n`)
      fake.addRemote('Other.md', '# Other\n')

      await pull(mirror, 'token', NOBODY)
    } finally {
      fake.api.writeNote = writing
      fake.api.changes = asking
    }

    expect(mirror.untold?.[id]).toBeDefined()
    expect(fake.disk.get(`${ROOT}/Other.md`)).toBe('# Other\n')
  })

  test('and a new note at the name, renamed too before the account heard, is a note of its own', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
      fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
      renameOnDisk('One.md', 'Ideas.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Ideas.md`)
      expect(mirror.untold?.[id]).toMatchObject({ from: 'One.md', to: 'Meeting.md' })
    } finally {
      fake.api.writeNote = writing
    }
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)).toMatchObject({ path: 'Meeting.md', content: HERE })
    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([
      'writeNote Meeting.md',
      'createNote Ideas.md',
    ])
    expect(mirror.notes['Meeting.md']?.id).toBe(id)
    expect(mirror.notes['Ideas.md']?.id).not.toBe(id)
  })

  test('and a new note at the name, renamed online before the account heard, is not that note', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    renameOnDisk('One.md', 'Meeting.md')
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
    fake.api.writeNote = writing
    fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
    renameOnDisk('One.md', 'Ideas.md')
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Ideas.md`)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)).toMatchObject({ path: 'Meeting.md', content: HERE })
    expect(mirror.notes['Meeting.md']?.id).toBe(id)
    expect(fake.remote.get(mirror.notes['Ideas.md']!.id)).toMatchObject({
      path: 'Ideas.md',
      content: '# Ideas\nnew\n',
    })
  })

  test('and a new note at the name, the renamed note deleted before the account heard, is not that note', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
      fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
      fake.disk.delete(`${ROOT}/Meeting.md`)
    } finally {
      fake.api.writeNote = writing
    }
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)).toMatchObject({ content: HERE, deleted: true })
    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([
      `deleteNote ${id}`,
      'createNote One.md',
    ])
    expect(mirror.notes['One.md']?.id).not.toBe(id)
    expect(fake.remote.get(mirror.notes['One.md']!.id)).toMatchObject({
      content: '# Ideas\nnew\n',
      deleted: false,
    })
    expect(mirror.untold).toBeUndefined()
  })

  test('and a new note at the name, the renamed note deleted, waits for the delete to land', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
      fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
      fake.disk.delete(`${ROOT}/Meeting.md`)
    } finally {
      fake.api.writeNote = writing
    }

    fake.refusing.delete = new TypeError('Failed to fetch')
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)
    expect(fake.remote.get(id)).toMatchObject({ content: HERE, deleted: false })
    expect(mirror.untold?.[id]).toBeDefined()

    fake.refusing.delete = null
    fake.calls.length = 0
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([
      `deleteNote ${id}`,
      'createNote One.md',
    ])
    expect(fake.remote.get(id)).toMatchObject({ content: HERE, deleted: true })
    expect(mirror.notes['One.md']?.id).not.toBe(id)
  })

  test('and one renamed back outside the app before the account heard is still that note', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
    } finally {
      fake.api.writeNote = writing
    }
    renameOnDisk('Meeting.md', 'One.md')
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([])
    expect(fake.remote.get(id)).toMatchObject({ path: 'One.md', content: HERE, deleted: false })
    expect(mirror.notes['One.md']?.id).toBe(id)
    expect(mirror.untold).toBeUndefined()
  })

  test('and a new note at the name, the renamed note deleted, is let go of when the account keeps failing the delete', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
      fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
      fake.disk.delete(`${ROOT}/Meeting.md`)
    } finally {
      fake.api.writeNote = writing
    }

    fake.refusing.delete = new ApiError(500, 'boom', {})
    {
      using time = clock()
      await pull(mirror, 'token', NOBODY)
      await push(mirror, 'token', NOBODY)
      expect(mirror.untold?.[id]?.failing?.times).toBe(1)
      for (let one = 0; one < 30 && mirror.untold; one++) {
        time.on(5 * 60_000)
        await pull(mirror, 'token', NOBODY)
        await push(mirror, 'token', NOBODY)
      }
    }
    expect(mirror.untold).toBeUndefined()
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/One.md`)).toBe('# Ideas\nnew\n')
    const alive = [...fake.remote.values()].filter((one) => !one.deleted)
    expect(alive.map((one) => one.content)).toContain('# Ideas\nnew\n')
    expect([...fake.remote.values()].map((one) => one.content)).toContain(HERE)
  })

  test('and a new note at the name, the renamed note moved to another space before the account heard, is not that note', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new ApiError(503, 'away', {}))
    try {
      renameOnDisk('One.md', 'Meeting.md')
      await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Meeting.md`)
      fake.disk.set(`${ROOT}/One.md`, '# Ideas\nnew\n')
      fake.disk.delete(`${ROOT}/Meeting.md`)
      fake.disk.set('/Other/Meeting.md', HERE)
      await movedHere(mirror, 'token', `${ROOT}/Meeting.md`, '/Other/Meeting.md')
    } finally {
      fake.api.writeNote = writing
    }
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)).toMatchObject({ content: HERE, deleted: true })
    expect(mirror.notes['One.md']?.id).not.toBe(id)
    expect(fake.remote.get(mirror.notes['One.md']!.id)).toMatchObject({
      content: '# Ideas\nnew\n',
      deleted: false,
    })
    expect(mirror.untold).toBeUndefined()
  })

  test('and one renamed on another device too takes the name the account has', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')
    const writing = fake.api.writeNote
    fake.api.writeNote = () => Promise.reject(new TypeError('Failed to fetch'))
    await movedHere(mirror, 'token', `${ROOT}/One.md`, `${ROOT}/Two.md`)
    fake.api.writeNote = writing
    fake.renameRemote(id, 'Three.md')
    fake.calls.length = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls.filter((one) => /^(deleteNote|createNote|writeNote)/.test(one))).toEqual([])
    expect(fake.remote.get(id)).toMatchObject({ path: 'Three.md', deleted: false })
    expect(mirror.notes['Three.md']?.id).toBe(id)
    expect(fake.disk.get(`${ROOT}/Three.md`)).toBe(HERE)
    expect(fake.disk.has(`${ROOT}/Two.md`)).toBe(false)
  })

  test('and a folder carries every note under it', async () => {
    const { mirror } = await paired('Kept/One.md', HERE)
    fake.addRemote('Keptish.md', '# elsewhere' + String.fromCharCode(10))
    fake.disk.set(`${ROOT}/Keptish.md`, '# elsewhere' + String.fromCharCode(10))
    await pull(mirror, 'token', NOBODY)
    fake.calls.length = 0

    renameOnDisk('Kept/One.md', 'Shelved/One.md')
    await movedHere(mirror, 'token', `${ROOT}/Kept`, `${ROOT}/Shelved`)

    expect(fake.calls).toEqual(['writeNote Shelved/One.md'])
    expect(mirror.notes['Shelved/One.md']?.id).toBe('n-Kept/One.md')
    expect(mirror.notes['Keptish.md']?.id).toBe('n-Keptish.md')
  })

  test('while a rename nobody could be told about is still read off the folder', async () => {
    const { mirror } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toContain('createNote Two.md')
    expect(fake.calls).toContain('deleteNote n-One.md')

    const alive = [...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.path)
    expect(alive).toEqual(['Two.md'])
  })

  test('and is not brought back by the pull that runs before that push', async () => {
    const { mirror, id } = await paired('One.md', HERE)
    renameOnDisk('One.md', 'Two.md')

    fake.editRemote(id, HERE)
    mirror.cursor = 0

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect([...fake.disk.keys()].sort()).toEqual([`${ROOT}/Two.md`])

    const alive = [...fake.remote.values()].filter((one) => !one.deleted).map((one) => one.path)
    expect(alive).toEqual(['Two.md'])
  })
})

describe('a note both sides changed', () => {
  test('keeps the other copy beside ours when there is no room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(conflicts()[0] ?? '')).toBe('base\nwritten there\n')
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('writes no second copy for a note that is in a room', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten here\nwritten there\n')

    await pull(mirror, 'token', new Set([id]))

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\nwritten there\n')
  })

  test('leaves a note in a room to the room rather than sending the file', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')

    expect(await push(mirror, 'token', new Set([id]))).toBe(false)
    expect(fake.calls).toEqual([])
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

describe('a note both sides changed, when somebody chose to be asked', () => {
  async function disagreeing() {
    const both = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(both.id, 'base\nwritten there\n')
    fake.calls.length = 0
    return both
  }

  test('asking leaves both copies where they are and says which note', async () => {
    const { mirror, id } = await disagreeing()
    const clashes: Clash[] = []

    await pull(mirror, 'token', NOBODY, { rule: 'ask', clashed: (one) => clashes.push(one) })

    expect(clashes).toEqual([
      {
        path: `${ROOT}/note.md`,
        id,
        version: 2,
        theirs: 'base\nwritten there\n',
        at: expect.any(Number) as number,
      },
    ])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
    expect(conflicts()).toEqual([])
    expect(fake.calls).toEqual([])
    expect(mirror.notes['note.md']).toEqual({ id, version: 2, hash: '' })
  })

  test('and a push while the question waits sends nothing over the other copy', async () => {
    const { mirror, id } = await disagreeing()
    await pull(mirror, 'token', NOBODY, { rule: 'ask' })

    expect(await push(mirror, 'token', NOBODY, { held: new Set([`${ROOT}/note.md`]) })).toBe(false)
    expect(fake.calls).toEqual([])
    expect(fake.remote.get(id)?.content).toBe('base\nwritten there\n')
  })
})

describe('a canvas both sides drew on', () => {
  const plane = (id: string) =>
    `{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [{ "id": "${id}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],\n\t\t"at": { "${id}": 1000 }\n\t}\n}\n`

  test('is merged rather than copied when it is in no room', async () => {
    const { mirror, id } = await paired('Board.canvas', plane('base'))

    fake.disk.set(`${ROOT}/Board.canvas`, plane('here'))
    fake.editRemote(id, plane('there'))

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const held = fake.disk.get(`${ROOT}/Board.canvas`) ?? ''
    expect(held).toContain('"here"')
    expect(held).toContain('"there"')
  })

  test('is left to its room, the same as a note', async () => {
    const { mirror, id } = await paired('Board.canvas', plane('base'))
    fake.disk.set(`${ROOT}/Board.canvas`, plane('here'))

    expect(await push(mirror, 'token', new Set([id]))).toBe(false)
    expect(fake.calls).toEqual([])
    expect(fake.remote.get(id)?.content).toBe(plane('base'))
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

describe('a page note', () => {
  const paper = (id: string) =>
    `{
	"nodes": [{ "id": "p1", "type": "page", "x": 0, "y": 0, "width": 794, "height": 1123 }],
	"edges": [],
	"nib": {
		"version": 1,
		"ink": [{ "id": "${id}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],
		"at": { "${id}": 1000 }
	}
}
`

  test('goes up to the account when it is new here', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/Journal.pages`, paper('here'))

    expect(await push(mirror, 'token', NOBODY)).toBe(true)
    expect(fake.calls).toContain('createNote Journal.pages')
  })

  test('and comes down onto a machine that has never seen it', async () => {
    fake.addRemote('Journal.pages', paper('elsewhere'))
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Journal.pages`)).toBe(paper('elsewhere'))
  })

  test('is merged rather than copied when both sides drew on it', async () => {
    const { mirror, id } = await paired('Journal.pages', paper('base'))

    fake.disk.set(`${ROOT}/Journal.pages`, paper('here'))
    fake.editRemote(id, paper('there'))

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const held = fake.disk.get(`${ROOT}/Journal.pages`) ?? ''
    expect(held).toContain('"here"')
    expect(held).toContain('"there"')
  })
})

describe('a path the account named', () => {
  test('is not written outside the folder the space is', async () => {
    fake.addRemote('../../escape.md', 'somebody else wrote this\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()]).toEqual([])
  })

  test('is not written outside it with the other separator either', async () => {
    fake.addRemote('..\\..\\escape.md', 'somebody else wrote this\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
    expect([...fake.disk.keys()]).toEqual([])
  })

  test('is still written when it names a folder inside the space', async () => {
    fake.addRemote('deep/one.md', 'ours\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/deep/one.md`)).toBe('ours\n')
  })
})

describe('a page of changes that never ends', () => {
  test('is asked for once rather than forever', async () => {
    const asking = fake.api.changes
    let asked = 0

    fake.api.changes = (_token: string, _spaceId: string, since: number) => {
      asked += 1
      if (asked > 3) throw new Error('asked forever')
      return Promise.resolve({ notes: [], cursor: since, more: true })
    }

    try {
      expect(await pull(newMirror('s-one', ROOT), 'token', NOBODY)).toBe(false)
      expect(asked).toBe(1)
    } finally {
      fake.api.changes = asking
    }
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

function versions(path: string): string[] {
  return fake.history.get(`${ROOT}/${path}`) ?? []
}

describe('words arriving from the account', () => {
  test('leave the words they replace restorable', async () => {
    const { mirror, id } = await paired('note.md', 'the writing that was here\n')
    fake.editRemote(id, 'what another device says\n')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what another device says\n')
    expect(versions('note.md')).toEqual(['the writing that was here\n'])
  })

  test('keep a version of a note this machine had written in', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('do not land on a conflict copy from earlier the same day', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nthe first thing they said\n')
    await pull(mirror, 'token', NOBODY)

    fake.editRemote(id, 'base\nthe second thing they said\n')
    await pull(mirror, 'token', NOBODY)

    const copy = conflicts()[0] ?? ''
    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(copy)).toBe('base\nthe second thing they said\n')
    expect(fake.history.get(copy)).toEqual(['base\nthe first thing they said\n'])
  })

  test('keep a version when a canvas is merged into the file', async () => {
    const drawn = (mark: string) =>
      `{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [{ "id": "${mark}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],\n\t\t"at": { "${mark}": 1000 }\n\t}\n}\n`

    const { mirror, id } = await paired('Board.canvas', drawn('base'))
    fake.disk.set(`${ROOT}/Board.canvas`, drawn('here'))
    fake.editRemote(id, drawn('there'))

    await pull(mirror, 'token', NOBODY)

    expect(versions('Board.canvas')).toEqual([drawn('here')])
  })
})

describe('a note the mirror has no entry for', () => {
  function unrecorded(path: string, here: string, there: string) {
    const id = fake.addRemote(path, there)
    fake.disk.set(`${ROOT}/${path}`, here)
    return { mirror: newMirror('s-one', ROOT), id }
  }

  test('is a conflict rather than an overwrite when the two differ', async () => {
    const { mirror } = unrecorded('note.md', 'what I wrote here\n', 'what the account holds\n')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what I wrote here\n')
    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(conflicts()[0] ?? '')).toBe('what the account holds\n')
  })

  test('and its own words go up as the newer version', async () => {
    const { mirror, id } = unrecorded('note.md', 'what I wrote here\n', 'what the account holds\n')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)?.content).toBe('what I wrote here\n')
  })

  test('is recorded and left alone when the two already agree', async () => {
    const { mirror } = unrecorded('note.md', 'the same words\n', 'the same words\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    expect(fake.calls).toEqual([])
    expect(versions('note.md')).toEqual([])

    expect(await push(mirror, 'token', NOBODY)).toBe(false)
  })

  test('is not a conflict for a file written with Windows line endings', async () => {
    const { mirror } = unrecorded('note.md', 'one\r\ntwo\r\n', 'one\ntwo\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('one\r\ntwo\r\n')
  })

  test('is simply replaced when what is here is the untouched welcome note', async () => {
    const { WELCOME, WELCOME_NAME } = await import('../welcome')
    const { mirror } = unrecorded(WELCOME_NAME, WELCOME, '# the account’s own read me\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/${WELCOME_NAME}`)).toBe('# the account’s own read me\n')
  })

  test('is left to the room when the note is open in one', async () => {
    const { mirror, id } = unrecorded('note.md', 'what I wrote here\n', 'what the room settled\n')

    await pull(mirror, 'token', new Set([id]))

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what the room settled\n')
    expect(versions('note.md')).toEqual(['what I wrote here\n'])
  })
})

describe('a first pass, with somebody waiting on it', () => {
  function untouched(...names: string[]) {
    for (const name of names) fake.addRemote(name, `# ${name}\n`)
    return newMirror('s-one', ROOT)
  }

  test('reads out every name before it asks for a single body', async () => {
    const said: string[][] = []
    const fetchedWhen: number[] = []
    const mirror = untouched('one.md', 'Work/two.md', 'three.md')

    await pull(mirror, 'token', NOBODY, {
      listed: (paths) => said.push(paths),
      wrote: () => fetchedWhen.push(said.length),
    })

    expect(said).toEqual([[`${ROOT}/one.md`, `${ROOT}/Work/two.md`, `${ROOT}/three.md`]])
    expect(fetchedWhen).toEqual([1, 1, 1])
  })

  test('leaves out a name that could not be placed in the folder', async () => {
    const said: string[][] = []
    fake.addRemote('../escape.md', 'nope\n')
    const mirror = untouched('one.md')

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    expect(said).toEqual([[`${ROOT}/one.md`]])
  })

  test('leaves out a name the account has deleted', async () => {
    const said: string[][] = []
    const id = fake.addRemote('gone.md', 'was here\n')
    await fake.api.deleteNote('token', id)
    const mirror = untouched('one.md')

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    expect(said.flat()).not.toContain(`${ROOT}/gone.md`)
  })

  test('says which path each body landed at', async () => {
    const landed: string[] = []
    const mirror = untouched('one.md', 'Work/two.md')

    await pull(mirror, 'token', NOBODY, { wrote: (path) => landed.push(path) })

    expect(landed.sort()).toEqual([`${ROOT}/Work/two.md`, `${ROOT}/one.md`])
  })

  test('fetches the note on screen first, whatever order the page came in', async () => {
    const mirror = untouched('one.md', 'two.md', 'open.md', 'four.md')

    await pull(mirror, 'token', NOBODY, { wanted: new Set(['open.md']) })

    expect(fake.fetched[0]).toBe('open.md')
    expect(fake.fetched).toEqual(['open.md', 'one.md', 'two.md', 'four.md'])
  })

  test('brings down the same words whichever end it starts from', async () => {
    const wanted = untouched('one.md', 'two.md', 'three.md')
    await pull(wanted, 'token', NOBODY, { wanted: new Set(['three.md']) })
    const both = new Map(fake.disk)

    fake.disk.clear()
    const plain = newMirror('s-two', ROOT)
    await pull(plain, 'token', NOBODY)

    expect([...fake.disk.entries()].sort()).toEqual([...both.entries()].sort())
  })

  test('a page that names nothing says so once and nothing else', async () => {
    const said: string[][] = []
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY, { listed: (paths) => said.push(paths) })

    expect(said).toEqual([[]])
  })
})

describe('the newest copy standing', () => {
  const newest = { rule: 'newest' as const }

  test('is the account’s copy when that was written after the file here', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.modified.set(`${ROOT}/note.md`, 1_000)
    fake.editRemote(id, 'base\nwritten there, later\n', 2_000)

    await pull(mirror, 'token', NOBODY, newest)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten there, later\n')
    expect(versions('note.md')).toEqual(['base\nwritten here\n'])
    expect(conflicts()).toEqual([])
  })

  test('and the file here when that was written after the account’s', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here, later\n')
    fake.modified.set(`${ROOT}/note.md`, 2_000)
    fake.editRemote(id, 'base\nwritten there\n', 1_000)

    await pull(mirror, 'token', NOBODY, newest)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here, later\n')
    expect(conflicts()).toEqual([])
  })
})

describe('a file that is there but will not read', () => {
  test('is not written over by the account’s copy of the same name', async () => {
    fake.addRemote('note.md', 'what the account holds\n')
    fake.disk.set(`${ROOT}/note.md`, 'written in some other encoding\n')
    fake.unreadable.add(`${ROOT}/note.md`)

    await pull(newMirror('s-one', ROOT), 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('written in some other encoding\n')
    expect(fake.calls).toEqual([])
  })

  test('is left out of a push rather than ending it for every note after it', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/a.md`, 'will not read\n')
    fake.unreadable.add(`${ROOT}/a.md`)
    fake.disk.set(`${ROOT}/b.md`, 'the note after it\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual(['createNote b.md'])
  })
})

describe('a delete the account did not take', () => {
  test('is asked again next pass rather than coming back from the account', async () => {
    const { mirror, id } = await paired('note.md', 'the words\n')
    fake.disk.delete(`${ROOT}/note.md`)

    fake.refusing.delete = new TypeError('Failed to fetch')
    await push(mirror, 'token', NOBODY)

    fake.refusing.delete = null
    await pull(mirror, 'token', NOBODY)
    expect(fake.disk.has(`${ROOT}/note.md`)).toBe(false)

    await push(mirror, 'token', NOBODY)
    expect(fake.remote.get(id)?.deleted).toBe(true)
  })

  test('while one the account answered is done with', async () => {
    const { mirror } = await paired('note.md', 'the words\n')
    fake.disk.delete(`${ROOT}/note.md`)
    fake.refusing.delete = new ApiError(404, 'no such note')

    await push(mirror, 'token', NOBODY)
    fake.calls.length = 0
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })
})

describe('a note deleted on another device', () => {
  const live = () =>
    [...fake.remote.values()].filter((one) => !one.deleted).map((one) => [one.path, one.content])

  test('is kept when it was written in here since, and goes back up', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.disk.set(`${ROOT}/Plan.md`, '# Plan\ntyped offline\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)
    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\ntyped offline\n')

    await push(mirror, 'token', NOBODY)
    expect(fake.calls).toEqual(['createNote Plan.md'])
    expect(live()).toEqual([['Plan.md', '# Plan\ntyped offline\n']])
  })

  test('goes when nothing was written here, with a version, and not to this device’s trash', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(fake.calls).toEqual([`delete ${ROOT}/Plan.md`])
    expect(fake.history.get(`${ROOT}/Plan.md`)).toEqual(['# Plan\n'])
    expect([...fake.trash.keys()]).toEqual([])
    expect(live()).toEqual([])
  })

  test('but a page note goes to this device’s trash, which keeps its paper beside it', async () => {
    const { mirror, id } = await paired('Lecture.pages', '{}')
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([`trash ${ROOT}/Lecture.pages`])
  })

  test('in a folder deleted there keeps the one note written in here', async () => {
    const kept = fake.addRemote('Work/Kept.md', '# Kept\n')
    const left = fake.addRemote('Work/Left.md', '# Left\n')
    fake.disk.set(`${ROOT}/Work/Kept.md`, '# Kept\n')
    fake.disk.set(`${ROOT}/Work/Left.md`, '# Left\n')
    const mirror = newMirror('s-one', ROOT)
    await pull(mirror, 'token', NOBODY)

    fake.disk.set(`${ROOT}/Work/Kept.md`, '# Kept\nand more\n')
    fake.deleteRemote(kept)
    fake.deleteRemote(left)
    fake.calls.length = 0
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Work/Kept.md`)).toBe('# Kept\nand more\n')
    expect(fake.disk.has(`${ROOT}/Work/Left.md`)).toBe(false)
    expect(fake.calls).toEqual([`delete ${ROOT}/Work/Left.md`, 'createNote Work/Kept.md'])
  })

  test('is kept when the file here will not read, since nobody can say it is unchanged', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.unreadable.add(`${ROOT}/Plan.md`)
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\n')
    expect(fake.calls).toEqual([])
  })

  test('goes when its room already carried the writing up', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.disk.set(`${ROOT}/Plan.md`, '# Plan\ntyped in the room\n')
    fake.deleteRemote(id)

    await pull(mirror, 'token', new Set([id]))

    expect(fake.disk.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(fake.calls).toEqual([`delete ${ROOT}/Plan.md`])
  })

  test('leaves alone a file another note holds under that name by now', async () => {
    const { mirror, id } = await paired('Plan.md', '# Plan\n')
    fake.remote.set('n-earlier', {
      id: 'n-earlier',
      path: 'Plan.md',
      content: '# An earlier plan\n',
      version: 2,
      seq: 50,
      deleted: true,
    })

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Plan.md`)).toBe('# Plan\n')
    expect(mirror.notes['Plan.md']?.id).toBe(id)
    expect(fake.calls).toEqual([])
  })
})

describe('a note renamed on another device', () => {
  test('is moved here rather than written beside the old name', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.renameRemote(id, 'Two.md')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe('# One\n')
    expect(fake.disk.has(`${ROOT}/One.md`)).toBe(false)
    expect(Object.keys(mirror.notes)).toEqual(['Two.md'])
    expect(fake.remote.get(id)?.deleted).toBe(false)
    expect(fake.calls.filter((one) => /^(deleteNote|createNote)/.test(one))).toEqual([])
  })

  test('and comes down with the words it was given there', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.renameRemote(id, 'Notes/Two.md', '# Two\n')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Notes/Two.md`)).toBe('# Two\n')
    expect(fake.disk.has(`${ROOT}/One.md`)).toBe(false)
    expect(mirror.notes['Notes/Two.md']?.id).toBe(id)
  })

  test('carries what was typed here under the old name, up to the note', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.disk.set(`${ROOT}/One.md`, '# One\n\nTyped here.\n')
    fake.renameRemote(id, 'Two.md')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe('# One\n\nTyped here.\n')
    expect(fake.disk.has(`${ROOT}/One.md`)).toBe(false)
    expect(fake.remote.get(id)).toMatchObject({ path: 'Two.md', content: '# One\n\nTyped here.\n' })
    expect(conflicts()).toEqual([])
  })

  test('keeps both copies when it was written in on both sides', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.disk.set(`${ROOT}/One.md`, '# Mine\n')
    fake.renameRemote(id, 'Two.md', '# Theirs\n')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    const copies = conflicts()
    expect(copies).toHaveLength(1)
    expect(fake.disk.get(copies[0]!)).toBe('# Theirs\n')
    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe('# Mine\n')
    expect(fake.remote.get(id)).toMatchObject({ deleted: false, content: '# Mine\n' })
  })

  test('is not deleted everywhere when this device deletes the old name', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.renameRemote(id, 'Two.md')

    await pull(mirror, 'token', NOBODY)
    fake.disk.delete(`${ROOT}/One.md`)
    await push(mirror, 'token', NOBODY)

    expect(fake.remote.get(id)?.deleted).toBe(false)
    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe('# One\n')
  })

  async function trading(names: string[]) {
    const ids = names.map((name) => fake.addRemote(name, `# ${name}\n`))
    for (const name of names) fake.disk.set(`${ROOT}/${name}`, `# ${name}\n`)
    const mirror = newMirror('s-one', ROOT)
    await pull(mirror, 'token', NOBODY)
    fake.calls.length = 0

    ids.forEach((id, at) => fake.renameRemote(id, names[(at + 1) % names.length]!))
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)
    return { mirror, ids }
  }

  for (const names of [
    ['A.md', 'B.md'],
    ['A.md', 'B.md', 'C.md'],
  ]) {
    test(`keeps each note's words when ${names.length} notes trade names`, async () => {
      const { mirror, ids } = await trading(names)

      names.forEach((name, at) => {
        const next = names[(at + 1) % names.length]!
        expect(fake.disk.get(`${ROOT}/${next}`)).toBe(`# ${name}\n`)
        expect(fake.remote.get(ids[at]!)).toMatchObject({ path: next, content: `# ${name}\n` })
        expect(mirror.notes[next]?.id).toBe(ids[at])
      })
      expect([...fake.disk.keys()].sort()).toEqual(names.map((name) => `${ROOT}/${name}`))
      expect(fake.calls.filter((one) => /^(writeNote|createNote|deleteNote)/.test(one))).toEqual([])
    })
  }

  async function swapping() {
    const names = ['A.md', 'B.md']
    const ids = names.map((name) => fake.addRemote(name, `# ${name}\n`))
    for (const name of names) fake.disk.set(`${ROOT}/${name}`, `# ${name}\n`)
    const mirror = newMirror('s-one', ROOT)
    await pull(mirror, 'token', NOBODY)
    fake.renameRemote(ids[0]!, 'B.md')
    fake.renameRemote(ids[1]!, 'A.md')
    fake.calls.length = 0
    return { mirror, ids }
  }

  function swapped(ids: string[]) {
    expect(fake.disk.get(`${ROOT}/B.md`)).toBe('# A.md\n')
    expect(fake.disk.get(`${ROOT}/A.md`)).toBe('# B.md\n')
    expect([...fake.disk.keys()].sort()).toEqual([`${ROOT}/A.md`, `${ROOT}/B.md`])
    expect(fake.remote.get(ids[0]!)).toMatchObject({ path: 'B.md', content: '# A.md\n' })
    expect(fake.remote.get(ids[1]!)).toMatchObject({ path: 'A.md', content: '# B.md\n' })
  }

  test('finishes a swap cut short after one note was set aside', async () => {
    const { mirror, ids } = await swapping()
    const saved = structuredClone(mirror)
    fake.disk.delete(`${ROOT}/A.md`)
    fake.disk.set(`${ROOT}/.nib-moving-${ids[0]}-A.md`, '# A.md\n')

    await pull(saved, 'token', NOBODY)
    await push(saved, 'token', NOBODY)

    swapped(ids)
    expect(fake.calls.filter((one) => /^(writeNote|createNote|deleteNote)/.test(one))).toEqual([])
  })

  for (const names of [
    ['A.md', 'B.md'],
    ['A.md', 'B.md', 'C.md'],
  ]) {
    test(`finishes ${names.length} notes trading names wherever a quit cut it short`, async () => {
      const ids = names.map((name) => fake.addRemote(name, `# ${name}\n`))
      for (const name of names) fake.disk.set(`${ROOT}/${name}`, `# ${name}\n`)
      const mirror = newMirror('s-one', ROOT)
      await pull(mirror, 'token', NOBODY)
      ids.forEach((id, at) => fake.renameRemote(id, names[(at + 1) % names.length]!))

      const account = structuredClone([...fake.remote.entries()])
      let kept = structuredClone(mirror)
      const quits = [{ mirror: kept, disk: new Map(fake.disk) }]
      fake.renamed.hook = () => quits.push({ mirror: kept, disk: new Map(fake.disk) })
      await pull(mirror, 'token', NOBODY, {
        save: () => {
          kept = structuredClone(mirror)
          quits.push({ mirror: kept, disk: new Map(fake.disk) })
        },
      })
      fake.renamed.hook = null
      expect(quits.length).toBeGreaterThan(names.length)

      for (const quit of quits) {
        fake.disk.clear()
        for (const [path, words] of quit.disk) fake.disk.set(path, words)
        fake.remote.clear()
        for (const [id, note] of structuredClone(account)) fake.remote.set(id, note)
        fake.calls.length = 0
        const again = structuredClone(quit.mirror)

        await pull(again, 'token', NOBODY)
        await push(again, 'token', NOBODY)

        names.forEach((name, at) => {
          const next = names[(at + 1) % names.length]!
          expect(fake.disk.get(`${ROOT}/${next}`)).toBe(`# ${name}\n`)
          expect(fake.remote.get(ids[at]!)).toMatchObject({
            path: next,
            content: `# ${name}\n`,
            deleted: false,
          })
        })
        expect([...fake.disk.keys()].sort()).toEqual(names.map((name) => `${ROOT}/${name}`))
        expect(fake.calls.filter((one) => /^(writeNote|createNote|deleteNote)/.test(one))).toEqual(
          [],
        )
      }
    })
  }

  for (const names of [
    ['A.md', 'B.md'],
    ['A.md', 'B.md', 'C.md'],
  ]) {
    test(`tells each rename as it is made when ${names.length} notes trade names`, async () => {
      const ids = names.map((name) => fake.addRemote(name, `# ${name}\n`))
      for (const name of names) fake.disk.set(`${ROOT}/${name}`, `# ${name}\n`)
      const mirror = newMirror('s-one', ROOT)
      await pull(mirror, 'token', NOBODY)
      ids.forEach((id, at) => fake.renameRemote(id, names[(at + 1) % names.length]!))

      const open = names.map((name) => ({ words: `# ${name}\n`, path: `${ROOT}/${name}` }))
      await pull(mirror, 'token', NOBODY, {
        moved: (from, to) => {
          for (const one of open) if (one.path === from) one.path = to
        },
      })

      for (const one of open) expect(fake.disk.get(one.path)).toBe(one.words)
    })
  }

  test('finishes a swap with only the record from before it, one note aside and one moved', async () => {
    const { mirror, ids } = await swapping()
    fake.disk.set(`${ROOT}/.nib-moving-${ids[0]}-A.md`, '# A.md\n')
    fake.disk.set(`${ROOT}/A.md`, '# B.md\n')
    fake.disk.delete(`${ROOT}/B.md`)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    swapped(ids)
    expect(fake.calls.filter((one) => /^(writeNote|createNote|deleteNote)/.test(one))).toEqual([])
  })

  test('keeps the words of a note waiting aside when another device deletes it', async () => {
    const { mirror, ids } = await swapping()
    const aside = `.nib-moving-${ids[0]}-A.md`
    mirror.notes = { [aside]: mirror.notes['A.md']!, 'B.md': mirror.notes['B.md']! }
    fake.disk.delete(`${ROOT}/A.md`)
    fake.disk.set(`${ROOT}/${aside}`, '# A.md\n\nTyped while it waited.\n')
    fake.deleteRemote(ids[0]!)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    const shown = [...fake.disk.entries()].filter(
      ([path]) => !path.split('/').pop()!.startsWith('.'),
    )
    expect(shown.map(([, words]) => words)).toContain('# A.md\n\nTyped while it waited.\n')
    expect([...fake.trash.values()].map((one) => one.content)).not.toContain(
      '# A.md\n\nTyped while it waited.\n',
    )
  })

  test('puts a note waiting aside back where sync v2 will read it', async () => {
    const { mirror, ids } = await swapping()
    const aside = `.nib-moving-${ids[0]}-A.md`
    mirror.notes = { [aside]: mirror.notes['A.md']!, 'B.md': mirror.notes['B.md']! }
    fake.disk.delete(`${ROOT}/A.md`)
    fake.disk.set(`${ROOT}/${aside}`, '# A.md\n')

    const notes = await asidesBack(ROOT, mirror.notes)

    expect(notes['A.md']?.id).toBe(ids[0])
    expect(fake.disk.get(`${ROOT}/A.md`)).toBe('# A.md\n')
    expect(fake.disk.has(`${ROOT}/${aside}`)).toBe(false)
  })

  test('and beside it when another file has its name by now', async () => {
    const { mirror, ids } = await swapping()
    const aside = `.nib-moving-${ids[0]}-A.md`
    mirror.notes = { [aside]: mirror.notes['A.md']!, 'A.md': mirror.notes['B.md']! }
    fake.disk.set(`${ROOT}/A.md`, '# B.md\n')
    fake.disk.delete(`${ROOT}/B.md`)
    fake.disk.set(`${ROOT}/${aside}`, '# A.md\n')

    const notes = await asidesBack(ROOT, mirror.notes)

    const place = Object.keys(notes).find((path) => notes[path]?.id === ids[0])!
    expect(place.startsWith('.')).toBe(false)
    expect(fake.disk.get(`${ROOT}/${place}`)).toBe('# A.md\n')
    expect(notes['A.md']?.id).toBe(ids[1])
  })

  test('never deletes a note whose words wait aside', async () => {
    const { mirror, ids } = await swapping()
    fake.disk.delete(`${ROOT}/A.md`)
    fake.disk.set(`${ROOT}/.nib-moving-${ids[0]}-A.md`, '# A.md\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).not.toContain(`deleteNote ${ids[0]}`)
    expect(fake.disk.get(`${ROOT}/A.md`)).toBe('# A.md\n')
  })

  test('leaves a swap it cannot finish as it was, and finishes it next pass', async () => {
    const { mirror, ids } = await swapping()
    fake.refusing.moving.add(`${ROOT}/B.md`)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/A.md`)).toBe('# A.md\n')
    expect(fake.disk.get(`${ROOT}/B.md`)).toBe('# B.md\n')
    expect(fake.remote.get(ids[0]!)?.content).toBe('# A.md\n')
    expect(fake.remote.get(ids[1]!)?.content).toBe('# B.md\n')
    expect(conflicts()).toEqual([])
    expect(fake.calls.filter((one) => /^(writeNote|createNote|deleteNote)/.test(one))).toEqual([])

    fake.refusing.moving.clear()
    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    swapped(ids)
    expect(conflicts()).toEqual([])
  })

  test('leaves alone a file of its new name that is already here', async () => {
    const { mirror, id } = await paired('One.md', '# One\n')
    fake.disk.set(`${ROOT}/Two.md`, '# Another two\n')
    fake.renameRemote(id, 'Two.md')

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/One.md`)).toBe('# One\n')
    expect(fake.disk.get(`${ROOT}/Two.md`)).toBe('# Another two\n')
    expect(fake.remote.get(id)?.deleted).toBe(false)
  })

  test('takes a page note’s paper with it rather than leaving it behind', async () => {
    const { mirror, id } = await paired('Journal.pages', '{}\n')
    fake.disk.set(`${ROOT}/Journal.pages.pdf`, 'paper')
    fake.renameRemote(id, 'Diary.pages')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/Diary.pages.pdf`)).toBe('paper')
    expect(fake.disk.has(`${ROOT}/Journal.pages`)).toBe(false)
    expect(fake.disk.has(`${ROOT}/Journal.pages.pdf`)).toBe(false)
  })
})

describe('a web note both sides changed', () => {
  const site = (url: string, extra = '') =>
    `[InternetShortcut]\r\nURL=${url}\r\nTitle=Docs\r\nNib-Added=2026-09-01T00:00:00.000Z\r\n${extra}`
  const BASE = site('https://docs.dev/')
  const HOME = 'Nib-Home=https://docs.dev/\r\n'

  for (const rule of ['both', 'ask', 'newest'] as const) {
    test(`settles into one file with no copy and nothing held, under ${rule}`, async () => {
      const { mirror, id } = await paired('Docs.url', BASE)
      fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/a', HOME))
      fake.modified.set(`${ROOT}/Docs.url`, 1_000)
      fake.editRemote(
        id,
        site('https://docs.dev/b', `${HOME}Nib-Icon=data:image/png;base64,AA\r\n`),
        2_000,
      )
      const clashes: Clash[] = []

      await pull(mirror, 'token', NOBODY, { rule, clashed: (one) => clashes.push(one) })

      expect(conflicts()).toEqual([])
      expect(clashes).toEqual([])
      const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
      expect(settled).toContain('URL=https://docs.dev/b')
      expect(settled).toContain('Nib-Icon=data:image/png;base64,AA')
      expect(versions('Docs.url')).toEqual([site('https://docs.dev/a', HOME)])
    })
  }

  test('keeps what only the older copy said, and the newer reading', async () => {
    const { mirror, id } = await paired('Docs.url', BASE)
    fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/a', `${HOME}Nib-Icon=data:mine\r\n`))
    fake.modified.set(`${ROOT}/Docs.url`, 3_000)
    fake.editRemote(id, site('https://docs.dev/b', HOME), 2_000)

    await pull(mirror, 'token', NOBODY)
    await push(mirror, 'token', NOBODY)

    const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
    expect(settled).toContain('URL=https://docs.dev/a')
    expect(settled).toContain('Nib-Icon=data:mine')
    expect(conflicts()).toEqual([])
    expect(fake.remote.get(id)?.content).toBe(settled)
  })

  test('made on two devices at one name is one note, not a copy', async () => {
    const id = fake.addRemote('Docs.url', site('https://docs.dev/there'))
    fake.disk.set(`${ROOT}/Docs.url`, site('https://docs.dev/here', 'Nib-Icon=data:here\r\n'))
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    const settled = fake.disk.get(`${ROOT}/Docs.url`) ?? ''
    expect(settled).toContain('URL=https://docs.dev/here')
    expect(fake.remote.get(id)?.content).toBe(settled)
  })
})

describe('a web note’s old copies', () => {
  const site = (url: string, extra = '') =>
    `[InternetShortcut]\r\nURL=${url}\r\nTitle=Docs\r\nNib-Added=2026-09-01T00:00:00.000Z\r\n${extra}`
  const COPY = 'Docs (from another device 2026-10-01).url'

  test('are folded into the note when they point where it points', async () => {
    const { mirror } = await paired('Docs.url', site('https://docs.dev/'))
    const copy = fake.addRemote(COPY, site('https://docs.dev/', 'Nib-Icon=data:theirs\r\n'))
    await pull(mirror, 'token', NOBODY)
    const second = `${ROOT}/Docs (from another device 2026-10-01) 2.url`
    fake.disk.set(second, site('https://docs.dev/'))

    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/Docs.url`)).toContain('Nib-Icon=data:theirs')
    expect([...fake.trash.values()].map((one) => one.path).sort()).toEqual(
      [`${ROOT}/${COPY}`, second].sort(),
    )
    expect(fake.remote.get(copy)?.deleted).toBe(true)
  })

  test('stay when they point somewhere else, or when the note has gone', async () => {
    const { mirror } = await paired('Docs.url', site('https://docs.dev/'))
    fake.disk.set(`${ROOT}/${COPY}`, site('https://elsewhere.dev/'))
    fake.disk.set(`${ROOT}/Gone (from another device 2026-10-01).url`, site('https://gone.dev/'))

    await push(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(2)
    expect(fake.trash.size).toBe(0)
  })
})

describe('another sync tool’s copy', () => {
  const CLASH = 'Plan (# Name clash 2026-10-05 a1b2c3C #).md'

  async function tracking() {
    const id = fake.addRemote(CLASH, 'theirs\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')
    const mirror = newMirror('s-one', ROOT)
    mirror.notes[CLASH] = { id, version: 1, hash: await sha(CLASH, 'theirs\n') }
    return { mirror, id }
  }

  async function sha(_path: string, content: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  test('is never sent to the account', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')
    fake.disk.set(`${ROOT}/Kept (conflicted copy 2026-10-05 093612)/inside.md`, 'x\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })

  test('while the note beside it goes up as ever', async () => {
    const mirror = newMirror('s-one', ROOT)
    fake.disk.set(`${ROOT}/Plan.md`, 'mine\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs\n')

    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual(['createNote Plan.md'])
  })

  test('is not written onto a disk that does not have it', async () => {
    fake.addRemote(CLASH, 'theirs\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.has(`${ROOT}/${CLASH}`)).toBe(false)
    expect(mirror.notes[CLASH]).toBeUndefined()
  })

  test('one the account has from before is neither sent nor deleted there', async () => {
    const { mirror } = await tracking()
    fake.disk.set(`${ROOT}/${CLASH}`, 'theirs, edited\n')
    await push(mirror, 'token', NOBODY)
    fake.disk.delete(`${ROOT}/${CLASH}`)
    await push(mirror, 'token', NOBODY)

    expect(fake.calls).toEqual([])
  })

  test('stays on this disk when the account lets go of it', async () => {
    const { mirror, id } = await tracking()
    fake.deleteRemote(id)

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
    expect(fake.trash.size).toBe(0)
    expect(mirror.notes[CLASH]).toBeUndefined()
  })

  test('is not written over by the account either', async () => {
    const { mirror, id } = await tracking()
    fake.editRemote(id, 'from elsewhere\n')

    await pull(mirror, 'token', NOBODY)

    expect(fake.disk.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
  })

  test('is not what a note becomes when the tool puts it aside under that name', async () => {
    const { mirror } = await paired('Plan.md', 'mine\n')
    fake.disk.set(`${ROOT}/${CLASH}`, 'mine\n')
    fake.disk.delete(`${ROOT}/Plan.md`)

    expect(await movedHere(mirror, 'token', `${ROOT}/Plan.md`, `${ROOT}/${CLASH}`)).toBe(false)
    expect(fake.calls).toEqual([])
    expect(Object.keys(mirror.notes)).toEqual(['Plan.md'])
  })
})

describe('a paper the account was never sent', () => {
  test('is not recorded as sent, and goes up on the next pass', async () => {
    fake.disk.set(`${ROOT}/paper.pdf`, '%PDF')
    fake.readsLeft.set(`${ROOT}/paper.pdf`, 1)
    const mirror = newMirror('s-one', ROOT)

    await push(mirror, 'token', NOBODY)
    expect(fake.blobsPut).toEqual([])
    expect(mirror.files['paper.pdf']).toBeUndefined()

    fake.readsLeft.delete(`${ROOT}/paper.pdf`)
    await push(mirror, 'token', NOBODY)
    expect(fake.blobsPut).toHaveLength(1)
    expect(mirror.files['paper.pdf']?.hash).toBe(fake.blobsPut[0])
  })
})
