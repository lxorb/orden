import { beforeEach, describe, expect, test, vi } from 'vitest'

/** One space moved between a disk and an account that both live in memory, driven
 *  a pass at a time. What this file is about is the one decision a pass has to
 *  make - both sides changed, now what - and how the answer changes for a note
 *  that is open in a room.
 *
 *  The loop around it, and the pairing of folders with spaces, are tested next
 *  door in sync.test.ts against the whole store. Here `pull` and `push` are called
 *  directly, because which notes are in rooms is something they are handed. */

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
  }

  const disk = new Map<string, string>()
  const remote = new Map<string, Remote>()
  const calls: string[] = []
  /** The version history, as the platforms keep it: every note's earlier words,
   *  oldest first, under the note they are versions of. What the sheet lists and
   *  what Restore puts back; see recovery.svelte.ts. */
  const history = new Map<string, string[]>()
  let seq = 0

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    if (command === 'read_note') {
      const held = disk.get(path)
      // Rejected rather than thrown, the way the platform shim answers: a pass
      // catches the promise, and a file that is not there is the ordinary case
      // of a note arriving from another machine.
      if (held === undefined) return Promise.reject(new Error(`no such file: ${path}`))
      return Promise.resolve(held as T)
    }

    if (command === 'write_note') {
      calls.push(`write ${path}`)
      disk.set(path, text(args.content))
      return Promise.resolve(undefined as T)
    }

    if (command === 'snapshot_note') {
      const content = text(args.content)
      const kept = history.get(path) ?? []
      // Both platforms drop a version that repeats the one before it, and neither
      // keeps one of a note that says nothing; see src-tauri/src/history.rs and
      // web/commands.ts.
      if (content.trim() && kept.at(-1) !== content) history.set(path, [...kept, content])
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

      // A space holds one live note per path, so the service answers 409 with the
      // note that is already there rather than making a second one; see
      // services/sync/src/notes.ts. That is a pairing, not a failure.
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
    history.clear()
    calls.length = 0
    seq = 0
  }

  return { addRemote, api, calls, disk, editRemote, history, invoke, remote, reset }
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

describe('a canvas both sides drew on', () => {
  /** Two planes with one stroke each, as files. */
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

    // Every stroke was already carried by the room, so sending the file would be a
    // second writer for one plane.
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

describe('a path the account named', () => {
  test('is not written outside the folder the space is', async () => {
    fake.addRemote('../../escape.md', 'somebody else wrote this\n')
    const mirror = newMirror('s-one', ROOT)

    await pull(mirror, 'token', NOBODY)

    // Nothing on the disk, and nothing tracked: a note that cannot be placed
    // inside the space is not a note to place.
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

    // A page that says there is more and hands back the cursor it was given.
    // Following it is a pass that never finishes: the light stays on, the loop
    // never sets its next timer, and a first sync never lets anybody in.
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

/** What the version history holds for one note, oldest first. */
function versions(path: string): string[] {
  return fake.history.get(`${ROOT}/${path}`) ?? []
}

describe('words arriving from the account', () => {
  test('leave the words they replace restorable', async () => {
    const { mirror, id } = await paired('note.md', 'the writing that was here\n')
    fake.editRemote(id, 'what another device says\n')

    await pull(mirror, 'token', NOBODY)

    // The file is what the account says, and what it said before is a version -
    // the same history a save keeps, so the sheet lists it and Restore puts it
    // back. Before this, an overwrite from the account was the one overwrite that
    // left nothing behind on the machine it happened on.
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what another device says\n')
    expect(versions('note.md')).toEqual(['the writing that was here\n'])
  })

  test('keep a version of a note this machine had written in', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    // Both sides moved, so the account's copy lands beside ours - and ours is now
    // one edit further on than the version the pass kept before it.
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nwritten there\n')

    await pull(mirror, 'token', NOBODY)

    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('base\nwritten here\n')
  })

  test('do not land on a conflict copy from earlier the same day', async () => {
    const { mirror, id } = await paired('note.md', 'base\n')

    // Two conflicts on one note in one day. The copies are named after the day,
    // so the second is written to the name the first is under.
    fake.disk.set(`${ROOT}/note.md`, 'base\nwritten here\n')
    fake.editRemote(id, 'base\nthe first thing they said\n')
    await pull(mirror, 'token', NOBODY)

    fake.editRemote(id, 'base\nthe second thing they said\n')
    await pull(mirror, 'token', NOBODY)

    const copy = conflicts()[0] ?? ''
    expect(conflicts()).toHaveLength(1)
    expect(fake.disk.get(copy)).toBe('base\nthe second thing they said\n')
    // And the one it replaced is still reachable.
    expect(fake.history.get(copy)).toEqual(['base\nthe first thing they said\n'])
  })

  test('keep a version when a canvas is merged into the file', async () => {
    const drawn = (mark: string) =>
      `{\n\t"nodes": [],\n\t"edges": [],\n\t"nib": {\n\t\t"version": 1,\n\t\t"ink": [{ "id": "${mark}", "tool": "pen", "color": "1", "size": 6, "points": [0, 0, 0.5, 0, 0, 0, 4, 4, 0.5, 0, 0, 8] }],\n\t\t"at": { "${mark}": 1000 }\n\t}\n}\n`

    const { mirror, id } = await paired('Board.canvas', drawn('base'))
    fake.disk.set(`${ROOT}/Board.canvas`, drawn('here'))
    fake.editRemote(id, drawn('there'))

    await pull(mirror, 'token', NOBODY)

    // A canvas is written over rather than copied beside, so the version is the
    // only way back to the plane as this machine had it.
    expect(versions('Board.canvas')).toEqual([drawn('here')])
  })
})

describe('a note the mirror has no entry for', () => {
  /** A space the account holds, and a folder here that already has the notes in
   *  it, with nothing written down about the two. What a phone whose storage was
   *  truncated wakes up to, and what pairing a folder with a space of the same
   *  name looks like on the first pass. */
  function unrecorded(path: string, here: string, there: string) {
    const id = fake.addRemote(path, there)
    fake.disk.set(`${ROOT}/${path}`, here)
    return { mirror: newMirror('s-one', ROOT), id }
  }

  test('is a conflict rather than an overwrite when the two differ', async () => {
    const { mirror } = unrecorded('note.md', 'what I wrote here\n', 'what the account holds\n')

    await pull(mirror, 'token', NOBODY)

    // Nothing recorded is not the same as nothing written here. Before this, the
    // account's copy simply landed on top and the writing was gone from the one
    // machine that had it.
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

    // A mirror that lost its entries mends itself: the note is found agreeing
    // rather than judged, so there is no copy, and no write either.
    expect(conflicts()).toEqual([])
    expect(fake.calls).toEqual([])
    expect(versions('note.md')).toEqual([])

    // And it is tracked from here on, so the next pass has something to compare.
    expect(await push(mirror, 'token', NOBODY)).toBe(false)
  })

  test('is not a conflict for a file written with Windows line endings', async () => {
    const { mirror } = unrecorded('note.md', 'one\r\ntwo\r\n', 'one\ntwo\n')

    await pull(mirror, 'token', NOBODY)

    // The app keeps whatever line ending a file already had, so its bytes never
    // hash to what the account holds however exactly the two agree. A copy beside
    // every note in the folder is not what that means.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('one\r\ntwo\r\n')
  })

  test('is simply replaced when what is here is the untouched welcome note', async () => {
    const { WELCOME, WELCOME_NAME } = await import('../welcome')
    const { mirror } = unrecorded(WELCOME_NAME, WELCOME, '# the account’s own read me\n')

    await pull(mirror, 'token', NOBODY)

    // The seed the app wrote is nobody's writing, so it is not worth a copy.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/${WELCOME_NAME}`)).toBe('# the account’s own read me\n')
  })

  test('is left to the room when the note is open in one', async () => {
    const { mirror, id } = unrecorded('note.md', 'what I wrote here\n', 'what the room settled\n')

    await pull(mirror, 'token', new Set([id]))

    // The room settled the two character by character before either of them was
    // ever a file, so what comes down is simply what the note now says.
    expect(conflicts()).toEqual([])
    expect(fake.disk.get(`${ROOT}/note.md`)).toBe('what the room settled\n')
    // And the words it replaced are still a version.
    expect(versions('note.md')).toEqual(['what I wrote here\n'])
  })
})
