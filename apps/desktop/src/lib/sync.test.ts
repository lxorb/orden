import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Bookmark } from './workspace/bookmarks.svelte'

const { ApiError } = await import('./api')

const fake = vi.hoisted(() => {
  interface Entry {
    name: string
    path: string
    is_dir: boolean
    modified: number
    created: number
    children: Entry[]
  }

  interface Note {
    id: string
    spaceId: string
    path: string
    content: string
    version: number
    seq: number
    deleted: boolean
  }

  const disk = new Map<string, string>()
  const remote = {
    spaces: [] as {
      id: string
      name: string
      bookmarks?: Bookmark[]
      role?: 'owner' | 'write' | 'read'
    }[],
    notes: [] as Note[],
    calls: [] as string[],
    local: [] as string[],
    deleted: [] as string[],
    seq: 0,
  }

  const basename = (path: string) => path.split('/').pop() ?? path
  const parent = (path: string) => path.split('/').slice(0, -1).join('/') || '/'
  const spaces = () => [...new Set([...disk.keys()].map((path) => `/${path.split('/')[1]}`))].sort()

  function tree(root: string): Entry {
    if (![...disk.keys()].some((one) => one.startsWith(`${root}/`))) {
      throw new Error('root is not a directory')
    }

    const node = (path: string): Entry => ({
      name: basename(path),
      path,
      is_dir: true,
      modified: 0,
      created: 0,
      children: [],
    })
    const folders = new Map([[root, node(root)]])
    const folder = (path: string): Entry => {
      let found = folders.get(path)
      if (!found) {
        found = node(path)
        folders.set(path, found)
        folder(parent(path)).children.push(found)
      }
      return found
    }

    for (const path of [...disk.keys()].filter((one) => one.startsWith(`${root}/`)).sort()) {
      const name = basename(path)
      if (name.startsWith('.')) {
        folder(parent(path))
        continue
      }
      folder(parent(path)).children.push({
        name,
        path,
        is_dir: false,
        modified: 0,
        created: 0,
        children: [],
      })
    }

    return folders.get(root)!
  }

  const text = (value: unknown) => (typeof value === 'string' ? value : '')

  async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    const path = text(args.path)

    switch (command) {
      case 'list_spaces':
        return spaces().map((root) => ({ name: basename(root), path: root })) as T
      case 'create_space': {
        const name = text(args.name)
        const root = `/${name}`
        disk.set(`${root}/.keep`, '')
        return { name, path: root } as T
      }
      case 'delete_space':
      case 'trash_item':
      case 'delete_note':
      case 'delete_folder':
        remote.local.push(`${command} ${path}`)
        disk.delete(path)
        for (const key of [...disk.keys()]) if (key.startsWith(`${path}/`)) disk.delete(key)
        return { id: `trash-${path}` } as T
      case 'read_tree':
        return tree(text(args.root)) as T
      case 'read_note': {
        const doc = disk.get(path)
        if (doc === undefined) throw new Error(`no such note: ${path}`)
        return doc as T
      }
      case 'write_note':
        disk.set(path, text(args.content))
        return undefined as T
      case 'rename_note': {
        const from = text(args.from)
        const to = text(args.to)
        const held = disk.get(from)
        if (held === undefined) throw new Error(`no such file: ${from}`)
        if (disk.has(to)) throw new Error(`${to} is already there`)
        disk.delete(from)
        disk.set(to, held)
        return undefined as T
      }
      case 'read_file': {
        const bytes = disk.get(path)
        if (bytes === undefined) throw new Error(`no such file: ${path}`)
        return new TextEncoder().encode(bytes).buffer as T
      }
      case 'list_snapshots':
        return [] as T
      default:
        return undefined as T
    }
  }

  async function sha256(text: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  const wire = async (note: Note) => ({
    id: note.id,
    path: note.path,
    seq: note.seq,
    version: note.version,
    updatedAt: 0,
    deleted: note.deleted,
    size: note.content.length,
    hash: await sha256(note.content),
  })

  const listed = (
    space: { id: string; name: string; bookmarks?: Bookmark[]; role?: string },
    position: number,
  ) => ({
    ...space,
    position,
    icon: null,
    role: space.role ?? 'owner',
    shared: (space.role ?? 'owner') !== 'owner',
    notes: remote.notes.filter((note) => note.spaceId === space.id && !note.deleted).length,
    bookmarks: space.bookmarks ?? [],
    createdAt: 0,
    updatedAt: 0,
    blog: { enabled: false, subdomain: null, domain: null, title: null, note: null, dns: [] },
  })

  const firstRemoteSpace = () => {
    const [space] = remote.spaces
    if (!space) throw new Error('the account holds no spaces')
    return space
  }

  const user = { id: 'u1', email: 'me@example.com', name: null }
  const found = (id: string) => {
    const note = remote.notes.find((one) => one.id === id)
    if (!note) throw new Error(`no such remote note: ${id}`)
    return note
  }

  const api = {
    requestCode: async () => ({ ok: true as const, resendIn: 30 }),
    verifyCode: async () => ({ token: 'session', user }),
    me: async () => ({ user }),
    signOut: async () => ({ ok: true as const }),
    usage: async () => ({ used: 0, limit: 1 }),
    listSpaces: async () => ({ spaces: remote.spaces.map(listed), deleted: remote.deleted }),
    createSpace: async (_token: string, name: string) => {
      remote.calls.push(`createSpace ${name}`)
      const space = { id: `s-${name}`, name }
      remote.spaces.push(space)
      return { space: listed(space, remote.spaces.length - 1) }
    },
    changes: async (_token: string, spaceId: string, since: number) => {
      const notes = remote.notes.filter((note) => note.spaceId === spaceId && note.seq > since)
      const page = {
        notes: await Promise.all(notes.map(wire)),
        cursor: Math.max(since, ...notes.map((note) => note.seq)),
        more: false,
      }

      between()
      return page
    },
    readNote: async (_token: string, id: string) => {
      const note = found(id)
      return { note: await wire(note), content: note.content }
    },
    createNote: async (_token: string, spaceId: string, path: string, content: string) => {
      remote.calls.push(`createNote ${path}`)
      const note = {
        id: `n-${path}`,
        spaceId,
        path,
        content,
        version: 1,
        seq: ++remote.seq,
        deleted: false,
      }
      remote.notes.push(note)
      return { note: await wire(note) }
    },
    writeNote: async (
      _token: string,
      id: string,
      path: string,
      content: string,
      baseVersion: number,
    ) => {
      remote.calls.push(`writeNote ${path}`)
      const note = found(id)

      if (note.version !== baseVersion) {
        throw new ApiError(409, 'this note changed elsewhere', {
          note: await wire(note),
          content: note.content,
        })
      }

      Object.assign(note, { path, content, version: note.version + 1, seq: ++remote.seq })
      return { note: await wire(note) }
    },
    saidAs: async () => null,
    deleteNote: async (_token: string, id: string) => {
      remote.calls.push(`deleteNote ${id}`)
      const note = remote.notes.find((one) => one.id === id)
      if (note) Object.assign(note, { deleted: true, seq: ++remote.seq })
      return { ok: true as const }
    },
    deleteSpace: async (_token: string, id: string) => {
      remote.calls.push(`deleteSpace ${id}`)
      return { ok: true as const }
    },
    leaveSpace: async (_token: string, id: string) => {
      remote.calls.push(`leaveSpace ${id}`)
      return { ok: true as const }
    },
    reorderSpaces: async () => ({ ok: true as const }),
    setSpaceIcon: async () => ({ space: listed(firstRemoteSpace(), 0) }),
    renameSpace: async (_token: string, id: string, name: string) => {
      remote.calls.push(`renameSpace ${id} ${name}`)
      return { space: listed(firstRemoteSpace(), 0) }
    },
    saveBookmarks: async (_token: string, id: string, bookmarks: Bookmark[]) => {
      remote.calls.push(`saveBookmarks ${id}`)
      const space = remote.spaces.find((one) => one.id === id)
      if (space) space.bookmarks = bookmarks
      return { bookmarks }
    },
  }

  function addRemoteNote(spaceId: string, path: string, content: string) {
    remote.notes.push({
      id: `n-${path}`,
      spaceId,
      path,
      content,
      version: 1,
      seq: ++remote.seq,
      deleted: false,
    })
  }

  function writeRemoteNote(spaceId: string, path: string, content: string) {
    const found = remote.notes.find((one) => one.spaceId === spaceId && one.path === path)
    if (!found) throw new Error(`no note at ${path}`)

    found.content = content
    found.version += 1
    found.seq = ++remote.seq
  }

  const rooms = new Set<string>()

  let inTheMiddle: (() => void) | null = null

  function between() {
    const now = inTheMiddle
    inTheMiddle = null
    now?.()
  }

  function renameRemoteNote(spaceId: string, path: string, to: string) {
    const found = remote.notes.find((one) => one.spaceId === spaceId && one.path === path)
    if (!found) throw new Error(`no note at ${path}`)

    found.path = to
    found.version += 1
    found.seq = ++remote.seq
  }

  function reset() {
    disk.clear()
    remote.spaces = []
    remote.notes = []
    remote.calls = []
    remote.local = []
    remote.deleted = []
    remote.seq = 0
    rooms.clear()
    inTheMiddle = null
  }

  return {
    disk,
    remote,
    invoke,
    api,
    addRemoteNote,
    writeRemoteNote,
    renameRemoteNote,
    meanwhile: (then: () => void) => (inTheMiddle = then),
    reset,
    rooms,
  }
})

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: fake.api,
}))

const lettingGo = vi.hoisted(() => [] as string[])

vi.mock('./rooms.svelte', () => ({
  rooms: {
    carries: (noteId: string) => fake.rooms.has(noteId),
    letGoUnreached: (noteId: string) => lettingGo.push(noteId),
    present: {},
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

let account: typeof import('./account.svelte').account
let sync: typeof import('./sync.svelte').sync
let workspace: typeof import('./workspace.svelte').workspace

await Promise.all([
  import('./account.svelte'),
  import('./sync.svelte'),
  import('./workspace.svelte'),
])

let everStarted = false

beforeEach(async () => {
  if (everStarted) await noPassInTheAir()
  everStarted = true

  fake.reset()
  vi.stubGlobal('localStorage', memoryStorage())

  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  ;({ sync } = await import('./sync.svelte'))
  ;({ workspace } = await import('./workspace.svelte'))

  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
})

async function machineWithNotes() {
  fake.disk.set('/Notes/Read me.md', '# Read me')
  workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]
  workspace.activeSpaceId = 'local'
  await workspace.loadTree()
  await workspace.open('/Notes/Read me.md')
}

function accountWithNotes() {
  fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
  fake.addRemoteNote('s-Account', 'Hello.md', '# Hello from the account')
}

async function signIn() {
  account.email = 'me@example.com'
  expect(await account.verify('123456')).toBe(true)
}

async function noPassInTheAir(): Promise<void> {
  const { setTimeout: sleep } = await import('node:timers/promises')

  for (let at = 0; at < 400 && sync.passing; at++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1)
    await sleep(5)
  }
}

function standInForTheWindow(): void {
  const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined }
  vi.stubGlobal('document', { hidden: false, ...listeners })
  vi.stubGlobal('window', listeners)
}

async function afterTheReconcileInterval(run: () => Promise<unknown>) {
  const { RECONCILE_INTERVAL } = await import('./backoff')

  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(Date.now() + RECONCILE_INTERVAL + 1)
  try {
    await run()
  } finally {
    vi.useRealTimers()
  }
}

describe('signing in when the account will not answer', () => {
  test('is still a sign-in, and still asks about the notes already here', async () => {
    await machineWithNotes()

    const real = fake.api.listSpaces
    fake.api.listSpaces = () => Promise.reject(new Error('offline'))

    try {
      account.email = 'me@example.com'
      expect(await account.verify('123456')).toBe(true)
      expect(account.signedIn).toBe(true)
      expect(account.syncable).toBe(false)
    } finally {
      fake.api.listSpaces = real
    }
  })
})

describe('signing in on a machine that already holds notes', () => {
  test('holds syncing back until the question about them is answered', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()
    expect(account.signedIn).toBe(true)
    expect(account.syncable).toBe(false)

    account.settled()
    expect(account.syncable).toBe(true)
  })

  test("keeping them sends them up and takes the account's spaces alongside", async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    account.settled()
    await sync.pass()

    expect(fake.remote.calls).toEqual(['createSpace Notes', 'createNote Read me.md'])
    expect(workspace.spaces.map((space) => space.name).sort()).toEqual(['Account', 'Notes'])
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    expect(workspace.activeSpace?.name).toBe('Notes')
    expect(workspace.active?.path).toBe('/Notes/Read me.md')
  })
})

describe('what arrives from the account', () => {
  test('is shown at once on a machine that had nothing', async () => {
    accountWithNotes()
    await signIn()
    account.settled()

    await sync.pass()

    expect(workspace.activeSpace?.name).toBe('Account')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
  })

  test('shows in the tree of the open space without anything else touching it', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    fake.addRemoteNote('s-Account', 'Later.md', '# Later')
    await sync.pass()

    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md', 'Later.md'])
  })

  async function readingWhatTheAccountSent() {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()
    await workspace.open('/Account/Hello.md')

    expect(workspace.active?.doc).toBe('# Hello from the account')
  }

  test('is put into the tab showing it, rather than left stale on screen', async () => {
    await readingWhatTheAccountSent()

    fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello from somewhere else')
    await sync.pass()

    expect(workspace.active?.doc).toBe('# Hello from somewhere else')
  })

  test('lets go of a room out of reach before the file goes into the tab (#541)', async () => {
    await readingWhatTheAccountSent()
    lettingGo.length = 0

    fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello from somewhere else')
    await sync.pass()

    expect(lettingGo).toHaveLength(1)
    expect(workspace.active?.doc).toBe('# Hello from somewhere else')
  })

  test('leaves a tab with unsaved words in it exactly as it is', async () => {
    await readingWhatTheAccountSent()

    workspace.replace('# Hello, and something I am still typing')
    fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello from somewhere else')
    await sync.pass()

    expect(workspace.active?.doc).toBe('# Hello, and something I am still typing')
  })
})

describe('notes that traded names on another device', () => {
  for (const names of [
    ['A.md', 'B.md'],
    ['A.md', 'B.md', 'C.md'],
  ]) {
    test(`leave each open tab on its own note, and tell the account nothing (${names.length})`, async () => {
      fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
      for (const name of names) fake.addRemoteNote('s-Account', name, `# ${name}`)
      await signIn()
      account.settled()
      await sync.pass()
      for (const name of names) await workspace.open(`/Account/${name}`)

      fake.renameRemoteNote('s-Account', names[0]!, '.spare')
      for (let at = names.length - 1; at > 0; at -= 1) {
        fake.renameRemoteNote('s-Account', names[at]!, names[(at + 1) % names.length]!)
      }
      fake.renameRemoteNote('s-Account', '.spare', names[1]!)
      fake.remote.calls = []
      await sync.pass()

      for (const name of names) {
        const tab = workspace.openNotes.find((one) => one.note.text === `# ${name}`)
        expect(tab?.path).toBe(`/Account/${names[(names.indexOf(name) + 1) % names.length]}`)
        expect(fake.disk.get(tab!.path)).toBe(`# ${name}`)
      }
      expect(fake.remote.calls.filter((one) => one.startsWith('writeNote'))).toEqual([])
    })
  }
})

describe('a note that is open in its room while a pass runs', () => {
  async function typingInTheOpenNote() {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    fake.disk.set('/Account/Hello.md', '# Hello, and a line typed here')

    fake.meanwhile(() => {
      fake.rooms.add('n-Hello.md')
      fake.writeRemoteNote('s-Account', 'Hello.md', '# Hello, and a line typed here')
    })

    await sync.pass()
  }

  function files(): string[] {
    return [...fake.disk.keys()]
      .filter((path) => path.startsWith('/Account/') && !path.includes('/.'))
      .sort()
  }

  test('is left where it is rather than pushed against a version that moved', async () => {
    await typingInTheOpenNote()

    expect(files()).toEqual(['/Account/Hello.md'])
    expect(fake.remote.notes.filter((one) => !one.deleted).map((one) => one.path)).toEqual([
      'Hello.md',
    ])
  })

  test('and the pass says nothing about it in the log', async () => {
    await typingInTheOpenNote()

    expect(fake.remote.calls).toEqual([])
  })
})

describe('a space a pass cannot get through', () => {
  test('leaves the others their turn, and is said', async () => {
    fake.remote.spaces.push({ id: 's-Broken', name: 'Broken' }, { id: 's-Fine', name: 'Fine' })
    fake.addRemoteNote('s-Broken', 'One.md', 'one')
    fake.addRemoteNote('s-Fine', 'Two.md', 'two')
    const changes = fake.api.changes
    fake.api.changes = (token: string, spaceId: string, since: number) =>
      spaceId === 's-Broken'
        ? Promise.reject(new Error('it stopped'))
        : changes(token, spaceId, since)
    try {
      await signIn()
      account.settled()
      await sync.pass()
      expect(fake.disk.get('/Fine/Two.md')).toBe('two')
      expect(sync.status).toBe('error')
      expect(sync.lastError).toBe('it stopped')
    } finally {
      fake.api.changes = changes
    }
  })
})

describe('a space deleted on another device', () => {
  test('leaves its folder in this device’s trash, with the words typed here', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    fake.disk.set('/Account/Hello.md', '# Hello from the account\ntyped offline')
    fake.remote.spaces = []
    fake.remote.deleted = ['s-Account']
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.spaces).toEqual([])
    expect(fake.remote.local).toEqual(['trash_item /Account'])
  })
})

describe('a mirror whose folder is gone', () => {
  test('is left alone rather than read as every note deleted', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    await fake.invoke('delete_space', { path: '/Account' })
    workspace.spaces = []

    await sync.run()
    expect(fake.remote.calls).toEqual([])
  })
})

describe('a space whose folder was renamed here', () => {
  test('keeps its one space on the account and gives it the new name', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls.length = 0

    for (const [path, text] of [...fake.disk]) {
      if (!path.startsWith('/Account/')) continue
      fake.disk.delete(path)
      fake.disk.set(path.replace('/Account/', '/Journal/'), text)
    }
    workspace.spaces = workspace.spaces.map((one) =>
      one.root === '/Account' ? { ...one, name: 'Journal', root: '/Journal' } : one,
    )

    await sync.renamed('/Account', '/Journal', 'Journal')
    await sync.run()

    expect(fake.remote.calls).toEqual(['renameSpace s-Account Journal'])
    expect(sync.remoteIdFor('/Journal')).toBe('s-Account')
    expect(sync.remoteIdFor('/Account')).toBeNull()
  })
})

describe('the bookmarks of a space', () => {
  async function machineWithABookmark() {
    await machineWithNotes()
    workspace.bookmarks.toggle({ kind: 'note', path: 'Read me.md', text: '' })
  }

  test('join the account’s own list on the first pass and are sent up', async () => {
    await machineWithABookmark()
    fake.remote.spaces.push({
      id: 's-Notes',
      name: 'Notes',
      bookmarks: [{ kind: 'search', path: '', text: 'tea' }],
    })

    await signIn()
    account.settled()
    await sync.pass()

    expect(workspace.bookmarks.of('/Notes')).toEqual([
      { kind: 'search', path: '', text: 'tea' },
      { kind: 'note', path: 'Read me.md', text: '' },
    ])
    expect(fake.remote.calls).toContain('saveBookmarks s-Notes')
    expect(fake.remote.spaces[0]?.bookmarks).toHaveLength(2)
  })

  test('follow the account from then on, so one removed elsewhere stays gone', async () => {
    await machineWithABookmark()
    fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })

    await signIn()
    account.settled()
    await sync.pass()
    expect(workspace.bookmarks.of('/Notes')).toHaveLength(1)

    const [space] = fake.remote.spaces
    if (space) space.bookmarks = []
    fake.remote.calls.length = 0
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.bookmarks.of('/Notes')).toEqual([])
    expect(fake.remote.calls).toEqual([])
  })

  test('are offered to the account as soon as one is added', async () => {
    await machineWithNotes()
    fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })

    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls.length = 0

    workspace.bookmarks.toggle({ kind: 'folder', path: 'Work', text: '' })
    await vi.waitFor(() => {
      expect(fake.remote.calls).toEqual(['saveBookmarks s-Notes'])
    })
  })
})

describe('a space somebody shared', () => {
  function sharedWithMe(role: 'write' | 'read') {
    fake.remote.spaces.push({ id: 's-Theirs', name: 'Theirs', role })
    fake.addRemoteNote('s-Theirs', 'Plan.md', '# Their plan')
  }

  test('arrives as a folder like any other', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()

    expect(fake.disk.get('/Theirs/Plan.md')).toBe('# Their plan')
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Theirs'])
  })

  test('is never written back to when it was shared to read', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    fake.disk.set('/Theirs/Mine.md', '# not mine to add')
    await workspace.loadTree()
    await sync.pass()

    expect(fake.remote.calls).toEqual([])
  })

  test('is written back to when it was shared to write', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    fake.disk.set('/Theirs/Mine.md', '# mine to add')
    await workspace.loadTree()
    await sync.pass()

    expect(fake.remote.calls).toEqual(['createNote Mine.md'])
  })

  test('a note the account refuses is said, and the notes after it go up', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    fake.disk.set('/Theirs/A too big.md', '# refused')
    fake.disk.set('/Theirs/Z.md', '# after it')
    await workspace.loadTree()
    const real = fake.api.createNote
    fake.api.createNote = (token, spaceId, path, content) =>
      path === 'A too big.md'
        ? Promise.reject(
            new ApiError(400, 'that note is too large', { error: 'that note is too large' }),
          )
        : real(token, spaceId, path, content)
    try {
      await sync.pass()
    } finally {
      fake.api.createNote = real
    }

    expect(fake.remote.calls).toEqual(['createNote Z.md'])
    expect(sync.status).not.toBe('error')
    const { unsynced } = await import('./sync2/unsynced.svelte')
    await vi.waitFor(() => expect(unsynced.said).toBe('A too big.md'))
    unsynced.dismiss()
  })

  test('is let go of rather than deleted when the folder goes', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    const [space] = workspace.spaces
    if (space) await sync.forget(space.root, 'write')

    expect(fake.remote.calls).toEqual(['leaveSpace s-Theirs'])
  })

  test('takes its folder with it when the sharing is taken back', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Theirs'])

    fake.remote.spaces = []
    fake.remote.calls = []
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.spaces).toEqual([])
    expect(fake.remote.calls).toEqual([])
  })

  test('leaves that folder somewhere it can be got back from', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()

    fake.remote.spaces = []
    await afterTheReconcileInterval(() => sync.pass())

    expect(fake.remote.local).toEqual(['trash_item /Theirs'])
  })

  test('is never asked to keep the bookmarks of one shared to read', async () => {
    sharedWithMe('read')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    workspace.bookmarks.toggle({ kind: 'note', path: 'Plan.md', text: '' })
    await afterTheReconcileInterval(() => sync.pass())

    expect(fake.remote.calls).toEqual([])
  })
})

describe('the mirrors this machine remembers', () => {
  async function started(): Promise<void> {
    standInForTheWindow()
    vi.useFakeTimers()

    await signIn()
    account.settled()
    sync.start()
  }

  function stopped(): void {
    sync.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  }

  test('belong to one account, and another one starts from nothing', async () => {
    localStorage.setItem(
      'orden:mirrors',
      JSON.stringify({
        account: 'somebody-else',
        mirrors: { '/Theirs': { spaceId: 's-Theirs', root: '/Theirs', shared: true } },
      }),
    )

    await started()
    try {
      expect(sync.remoteIdFor('/Theirs')).toBeNull()
    } finally {
      stopped()
    }
  })

  test('stay the account’s they were for when written down after it signed out', async () => {
    localStorage.setItem(
      'orden:mirrors',
      JSON.stringify({
        account: 'u1',
        mirrors: { '/Notes': { spaceId: 's-Notes', root: '/Notes' } },
      }),
    )

    await started()
    try {
      await account.signOut()
      await sync.renamed('/Notes', '/Renamed', 'Renamed')

      const written = JSON.parse(localStorage.getItem('orden:mirrors') ?? '{}') as {
        account?: unknown
        mirrors?: Record<string, unknown>
      }
      expect(written.account).toBe('u1')
      expect(Object.keys(written.mirrors ?? {})).toEqual(['/Renamed'])
    } finally {
      stopped()
    }
  })

  test('are kept by a machine that wrote them before there was an account beside them', async () => {
    localStorage.setItem(
      'orden:mirrors',
      JSON.stringify({ '/Notes': { spaceId: 's-Notes', root: '/Notes' } }),
    )

    await started()
    try {
      expect(sync.remoteIdFor('/Notes')).toBe('s-Notes')
    } finally {
      stopped()
    }
  })

  test('are found under the spelling this device gives the folder, and its notes come down', async () => {
    const written = 'Cafe\u0301'
    const here = '/Caf\u00e9'
    localStorage.setItem(
      'orden:mirrors',
      JSON.stringify({
        account: 'u1',
        seen: true,
        mirrors: { [`/${written}`]: { spaceId: 's-Cafe', root: `/${written}` } },
      }),
    )
    fake.disk.set(`${here}/.keep`, '')
    fake.remote.spaces.push({ id: 's-Cafe', name: 'Caf\u00e9' })
    fake.addRemoteNote('s-Cafe', 'two.md', '# two')
    workspace.spaces = [{ id: 'local', name: 'Caf\u00e9', root: here }]

    await started()
    try {
      expect(sync.remoteIdFor(here)).toBe('s-Cafe')
      expect(sync.roleKept(here)).toBe('owner')

      await sync.pass()

      expect(fake.disk.get(`${here}/two.md`)).toBe('# two')
      expect(fake.remote.calls.filter((one) => one.startsWith('createSpace'))).toEqual([])
      const kept = JSON.parse(localStorage.getItem('orden:mirrors') ?? '{}') as {
        mirrors?: Record<string, unknown>
      }
      expect(Object.keys(kept.mirrors ?? {})).toEqual([here])
    } finally {
      stopped()
    }
  })

  describe('are read again when the rest of the storage lands', () => {
    function landed(notes: Record<string, { id: string; version: number; hash: string }>) {
      localStorage.setItem(
        'orden:mirrors',
        JSON.stringify({
          account: 'u1',
          seen: true,
          mirrors: {
            '/Notes': { spaceId: 's-Notes', root: '/Notes', cursor: 40, notes, files: {} },
          },
        }),
      )
    }

    test('fills in the entries the first read had no room for', async () => {
      await started()
      try {
        expect(sync.tracked('/Notes/one.md')).toBeNull()

        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
        expect(sync.remoteIdFor('/Notes')).toBe('s-Notes')
      } finally {
        stopped()
      }
    })

    test('does not undo what a pass has already settled', async () => {
      fake.disk.set('/Notes/.keep', '')
      fake.remote.spaces.push({ id: 's-Notes', name: 'Notes' })
      fake.addRemoteNote('s-Notes', 'two.md', '# two')
      workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]

      await started()
      try {
        await sync.pass()
        expect(sync.tracked('/Notes/two.md')).not.toBeNull()

        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        expect(sync.tracked('/Notes/two.md')).not.toBeNull()
        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
      } finally {
        stopped()
      }
    })

    test('adds to the mirror it holds rather than swapping it for another', async () => {
      await started()
      try {
        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        landed({ 'two.md': { id: 'n2', version: 4, hash: 'bbb' } })
        sync.reread()

        expect(sync.tracked('/Notes/one.md')).toEqual({ id: 'n1', version: 3, hash: 'aaa' })
        expect(sync.tracked('/Notes/two.md')).toEqual({ id: 'n2', version: 4, hash: 'bbb' })
      } finally {
        stopped()
      }
    })

    test('a launch that starts with nothing ends with every note back', async () => {
      const many = Object.fromEntries(
        Array.from({ length: 20 }, (_one, at) => [
          `note ${String(at)}.md`,
          { id: `n${String(at)}`, version: at + 1, hash: 'f'.repeat(64) },
        ]),
      )

      localStorage.removeItem('orden:mirrors')
      await started()
      try {
        expect(sync.tracked('/Notes/note 0.md')).toBeNull()

        landed(many)
        sync.reread()

        for (let at = 0; at < 20; at++) {
          expect(sync.tracked(`/Notes/note ${String(at)}.md`), `note ${String(at)}`).toEqual({
            id: `n${String(at)}`,
            version: at + 1,
            hash: 'f'.repeat(64),
          })
        }
      } finally {
        stopped()
      }
    })

    test('says nothing at all when storage held nothing new', async () => {
      await started()
      try {
        landed({ 'one.md': { id: 'n1', version: 3, hash: 'aaa' } })
        sync.reread()

        const written = localStorage.getItem('orden:mirrors')
        sync.reread()

        expect(localStorage.getItem('orden:mirrors')).toBe(written)
      } finally {
        stopped()
      }
    })

    test('leaves another account’s mirrors where they are', async () => {
      await started()
      try {
        localStorage.setItem(
          'orden:mirrors',
          JSON.stringify({
            account: 'somebody-else',
            mirrors: { '/Theirs': { spaceId: 's-Theirs', root: '/Theirs' } },
          }),
        )
        sync.reread()

        expect(sync.remoteIdFor('/Theirs')).toBeNull()
      } finally {
        stopped()
      }
    })
  })
})

describe('a storage with no room left for the note caches', () => {
  function cramped(most: number): Storage {
    const store = new Map<string, string>()

    return {
      get length() {
        return store.size
      },
      key: (index) => [...store.keys()][index] ?? null,
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        if (value.length > most) throw new Error('QuotaExceededError')
        store.set(key, value)
      },
      removeItem: (key) => void store.delete(key),
      clear: () => store.clear(),
    }
  }

  function written(): {
    mirrors: Record<string, { cursor?: number; notes?: object; dropped?: boolean }>
  } {
    const held = localStorage.getItem('orden:mirrors')
    expect(held).not.toBeNull()
    return JSON.parse(held ?? '{}') as ReturnType<typeof written>
  }

  test('keeps the cursor, so the next pass does not read the whole account again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()

    const full = JSON.stringify({
      account: 'x',
      seen: true,
      mirrors: {
        '/Account': {
          spaceId: 's-Account',
          root: '/Account',
          cursor: 1,
          notes: {},
          offered: {},
          files: {},
          dropped: true,
        },
      },
    }).length
    vi.stubGlobal('localStorage', cramped(full + 40))

    await expect(sync.pass()).resolves.not.toThrow()

    const mirror = Object.values(written().mirrors)[0]
    expect(mirror?.cursor).toBeGreaterThan(0)
    expect(mirror?.notes).toEqual({})
    expect(mirror?.dropped).toBe(true)
    expect(sync.tracked('/Account/Hello.md')).not.toBeNull()

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })

  test('says so rather than failing the pass when nothing at all will fit', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    vi.stubGlobal('localStorage', cramped(0))

    await expect(sync.pass()).resolves.not.toThrow()
    expect(localStorage.getItem('orden:mirrors')).toBeNull()
    expect(sync.remoteIdFor('/Account')).toBe('s-Account')

    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })
})

describe('turning syncing off while a pass is in the air', () => {
  test('leaves the light off and does not start the loop again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    standInForTheWindow()
    vi.useFakeTimers()

    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const real = fake.api.changes
    let asked = 0
    fake.api.changes = async (token: string, spaceId: string, since: number) => {
      asked++
      await held
      return real(token, spaceId, since)
    }

    try {
      sync.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBe(1)

      sync.stop()
      expect(sync.status).toBe('off')

      release()
      await vi.advanceTimersByTimeAsync(0)

      expect(sync.status).toBe('off')

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(asked).toBe(1)
    } finally {
      fake.api.changes = real
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('the first pass, which somebody is waiting on', () => {
  let arriving: typeof import('./arriving.svelte').arriving

  beforeEach(async () => {
    standInForTheWindow()
    ;({ arriving } = await import('./arriving.svelte'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function startedWithTheTickHeld(): void {
    vi.useFakeTimers()
    sync.start()
  }

  function stoppedAgain(): void {
    sync.stop()
    vi.useRealTimers()
  }

  test('is scheduled for now rather than for the next interval', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    const real = fake.api.listSpaces
    let asked = 0
    fake.api.listSpaces = () => {
      asked++
      return real()
    }

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      account.settled()
      sync.start()
      expect(asked).toBe(0)

      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBe(1)
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('is not postponed by something saved in the same instant', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    const real = fake.api.listSpaces
    let asked = 0
    fake.api.listSpaces = () => {
      asked++
      return real()
    }

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      account.settled()
      sync.start()
      sync.nudge()

      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBeGreaterThan(0)
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('says so the moment the code is accepted, before anything has been asked', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()

    expect(arriving.showing).toBe(true)
    expect(arriving.total).toBe(null)
    expect(account.syncable).toBe(false)
  })

  test('stays up across the round trip the pass opens with', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    const real = fake.api.listSpaces
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fake.api.listSpaces = async () => {
      await held
      return real()
    }

    try {
      startedWithTheTickHeld()
      const running = sync.pass()
      expect(arriving.showing).toBe(true)
      expect(arriving.total).toBe(null)

      release()
      await running
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('is taken down again when the machine already holds everything', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    stoppedAgain()

    await signIn()
    expect(arriving.showing).toBe(true)

    account.settled()
    startedWithTheTickHeld()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('counts what it is bringing down, and lifts when it has', async () => {
    await machineWithNotes()
    fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
    for (const name of ['one.md', 'two.md', 'three.md']) {
      fake.addRemoteNote('s-Account', name, `# ${name}`)
    }

    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()

    expect(arriving.total).toBe(3)
    expect(arriving.done).toBe(3)
    expect(arriving.showing).toBe(false)

    stoppedAgain()
  })

  test('leaves the switcher and the tree holding what came down, with no reload', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    expect(arriving.showing).toBe(false)
    stoppedAgain()

    expect(workspace.spaces.map((space) => space.name)).toContain('Account')
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    const arrived = workspace.spaces.find((space) => space.name === 'Account')
    expect(arrived).toBeDefined()
    await workspace.showSpace(arrived?.id ?? '')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
  })

  test('says nothing on a machine that has synced before', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    stoppedAgain()

    startedWithTheTickHeld()
    expect(arriving.showing).toBe(false)

    await sync.pass()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('says nothing on a later pass of the same session', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    expect(arriving.showing).toBe(false)

    fake.addRemoteNote('s-Account', 'Later.md', '# written elsewhere')
    await sync.pass()

    expect(arriving.showing).toBe(false)
    expect(fake.disk.get('/Account/Later.md')).toBe('# written elsewhere')
    stoppedAgain()
  })

  test('is taken down by signing out', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    expect(arriving.showing).toBe(true)

    await account.signOut()
    expect(arriving.showing).toBe(false)
    stoppedAgain()
  })

  test('stands through the question about the notes already here', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()
    expect(arriving.showing).toBe(true)

    sync.stop()
    expect(arriving.showing).toBe(true)

    account.settled()
    startedWithTheTickHeld()
    expect(arriving.showing).toBe(true)
    stoppedAgain()
  })
})

describe('two passes asked for at once', () => {
  test('make a folder the account has never seen into one space, not two', async () => {
    await machineWithNotes()
    await signIn()
    account.settled()

    const real = fake.api.createSpace
    fake.api.createSpace = async (token: string, name: string) => {
      await new Promise((settle) => setTimeout(settle, 50))
      return await real(token, name)
    }
    try {
      await Promise.all([sync.pass(), sync.pass()])
      await noPassInTheAir()
      await sync.pass()
    } finally {
      fake.api.createSpace = real
    }

    expect(fake.remote.calls.filter((call) => call.startsWith('createSpace'))).toEqual([
      'createSpace Notes',
    ])
    expect(fake.remote.spaces.map((space) => space.name)).toEqual(['Notes'])
    expect(workspace.spaces.map((space) => space.name)).toEqual(['Notes'])
  })
})

describe('a pass that fails partway through', () => {
  let arriving: typeof import('./arriving.svelte').arriving

  beforeEach(async () => {
    standInForTheWindow()
    ;({ arriving } = await import('./arriving.svelte'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('says what the account said, on the light and in the log', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    const { record } = await import('./sync/record.svelte')
    const real = fake.api.changes
    fake.api.changes = () => Promise.reject(new Error('the account is having a day'))
    try {
      expect(await sync.run()).toBe(false)
    } finally {
      fake.api.changes = real
    }

    expect(sync.status).toBe('error')
    expect(sync.lastError).toBe('the account is having a day')
    expect(record.passes[0]?.failed).toBe('the account is having a day')
    expect(sync.passing).toBe(false)
  })

  test('signs out when the account says the session is finished', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    const { ApiError } = await import('./api')
    const real = fake.api.changes
    fake.api.changes = () => Promise.reject(new ApiError(401, 'unauthorized'))
    const me = fake.api.me
    fake.api.me = () =>
      Promise.reject(new ApiError(401, 'sign in first', { error: 'sign in first' }))
    try {
      await sync.run()
      await vi.waitFor(() => expect(account.token).toBeNull())
    } finally {
      fake.api.changes = real
      fake.api.me = me
    }

    expect(sync.status).not.toBe('error')
  })

  test('keeps the session when a refusal did not come from the account', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    const { ApiError } = await import('./api')
    const real = fake.api.changes
    let asked = 0
    const me = fake.api.me
    fake.api.me = async () => {
      asked++
      return me()
    }
    fake.api.changes = () => Promise.reject(new ApiError(401, 'request failed (401)', null))
    try {
      await sync.run()
      await vi.waitFor(() => expect(asked).toBe(1))
    } finally {
      fake.api.changes = real
      fake.api.me = me
    }

    expect(account.token).toBe('session')
    expect(account.signedIn).toBe(true)
  })

  test('says so, lets anybody waiting in, and leaves the loop looping', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    const real = fake.api.createSpace
    let asked = 0
    fake.api.createSpace = () => {
      asked++
      return Promise.reject(new Error('offline'))
    }

    vi.useFakeTimers()
    try {
      sync.start()
      await vi.advanceTimersByTimeAsync(0)

      expect(asked).toBe(1)
      expect(sync.status).toBe('error')
      expect(arriving.showing).toBe(false)

      const { pollDelay } = await import('./backoff')
      await vi.advanceTimersByTimeAsync(pollDelay(1, false) + 1)
      expect(asked).toBeGreaterThan(1)
    } finally {
      fake.api.createSpace = real
      sync.stop()
    }
  })
})

describe('a v2 space whose role is not known yet', () => {
  async function unknown(kept: string | null = null) {
    await signIn()
    const forgotten: string[] = []
    const runner = {
      remoteIdFor: (root: string) => (root === '/Plan' ? 's-Plan' : null),
      roleKept: () => kept,
      forget: (root: string) => {
        forgotten.push(root)
        return Promise.resolve()
      },
    }
    ;(sync as unknown as { v2: typeof runner }).v2 = runner
    account.spaces = []
    account.listed = false
    fake.remote.calls = []
    return { forgotten, done: () => ((sync as unknown as { v2: null }).v2 = null) }
  }

  test('is never deleted from the account when it is let go of', async () => {
    const { roleOf } = await import('./sharing.svelte')
    const { forgotten, done } = await unknown()
    try {
      const role = roleOf('/Plan')
      expect(role).toBeNull()
      await sync.forget('/Plan', role)

      expect(forgotten).toEqual(['/Plan'])
      expect(fake.remote.calls).not.toContain('deleteSpace s-Plan')
    } finally {
      done()
    }
  })

  test('is deleted from the account once the listing is in and this device made it', async () => {
    const { roleOf } = await import('./sharing.svelte')
    const { done } = await unknown('owner')
    try {
      account.listed = true
      const role = roleOf('/Plan')
      expect(role).toBe('owner')
      await sync.forget('/Plan', role)

      expect(fake.remote.calls).toContain('deleteSpace s-Plan')
    } finally {
      done()
    }
  })

  test('is not deleted from the account when the listing leaves it out and it was not this device’s', async () => {
    const { roleOf } = await import('./sharing.svelte')
    const { forgotten, done } = await unknown('write')
    try {
      account.listed = true
      const role = roleOf('/Plan')
      expect(role).toBeNull()
      await sync.forget('/Plan', role)

      expect(forgotten).toEqual(['/Plan'])
      expect(fake.remote.calls).not.toContain('deleteSpace s-Plan')
    } finally {
      done()
    }
  })
})

describe('an account gone back to v1 on a device that kept its spaces under v2', () => {
  function wayBack() {
    let walked: (back: boolean) => void = () => undefined
    const walkBack = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          walked = resolve
        }),
    )
    vi.doMock('./sync2/runner.svelte', () => ({ runner: { walkBack } }))
    return { walkBack, walk: (back: boolean) => walked(back) }
  }

  function countingV1() {
    const real = fake.api.listSpaces
    const counted = { asked: 0, restore: () => (fake.api.listSpaces = real) }
    fake.api.listSpaces = () => {
      counted.asked++
      return real()
    }
    return counted
  }

  async function launched() {
    sync.start()
    const { startup } = await import('./startup.svelte')
    await startup.shown()
  }

  async function until(done: () => boolean) {
    const { setTimeout: sleep } = await import('node:timers/promises')
    for (let at = 0; at < 2000 && !done(); at++) {
      await vi.advanceTimersByTimeAsync(10)
      await sleep(5)
    }
  }

  test('walks the way back before v1 starts, and v1 waits until it is walked', async () => {
    const { walkBack, walk } = wayBack()
    standInForTheWindow()
    accountWithNotes()
    await signIn()
    account.settled()
    localStorage.setItem('orden:sync-version', '2')
    const v1 = countingV1()

    try {
      await launched()
      await until(() => walkBack.mock.calls.length > 0)

      expect(walkBack).toHaveBeenCalledTimes(1)
      expect(sync.status).toBe('offline')
      expect(localStorage.getItem('orden:sync-version')).toBe('2')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(v1.asked).toBe(0)

      walk(true)
      await until(() => v1.asked > 0)
      expect(localStorage.getItem('orden:sync-version')).toBe('1')
      expect(sync.version).toBe(1)
      expect(v1.asked).toBeGreaterThan(0)
    } finally {
      sync.stop()
      v1.restore()
      vi.doUnmock('./sync2/runner.svelte')
      vi.unstubAllGlobals()
    }
  })

  test('starts nothing when the session ends before the way back is walked', async () => {
    const { walkBack, walk } = wayBack()
    standInForTheWindow()
    accountWithNotes()
    await signIn()
    account.settled()
    localStorage.setItem('orden:sync-version', '2')
    const v1 = countingV1()

    try {
      await launched()
      await until(() => walkBack.mock.calls.length > 0)
      sync.stop()
      walk(false)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(v1.asked).toBe(0)
      expect(localStorage.getItem('orden:sync-version')).toBe('2')
    } finally {
      v1.restore()
      vi.doUnmock('./sync2/runner.svelte')
      vi.unstubAllGlobals()
    }
  })

  test('starts v1 at once where this device never ran v2', async () => {
    const { walkBack } = wayBack()
    standInForTheWindow()
    accountWithNotes()
    await signIn()
    account.settled()
    const v1 = countingV1()

    try {
      sync.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(v1.asked).toBe(1)
      expect(walkBack).not.toHaveBeenCalled()
    } finally {
      sync.stop()
      v1.restore()
      vi.doUnmock('./sync2/runner.svelte')
      vi.unstubAllGlobals()
    }
  })
})

describe('an account moved to v2 while this device runs v1', () => {
  test('leaves no v1 pass behind once v2 takes over', async () => {
    const runner = {
      status: 'idle',
      lastError: null,
      lastSyncedAt: null,
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(() => Promise.resolve()),
      passNow: vi.fn(() => Promise.resolve(false)),
    }
    standInForTheWindow()
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()
    const passes = vi.spyOn(sync, 'pass')
    const { setTimeout: sleep } = await import('node:timers/promises')
    const until = async (done: () => boolean) => {
      for (let at = 0; at < 400 && !done(); at++) {
        await vi.advanceTimersByTimeAsync(100)
        await sleep(5)
      }
    }

    vi.useFakeTimers()
    try {
      sync.start()
      await until(() => passes.mock.calls.length > 1)
      expect(passes.mock.calls.length).toBeGreaterThan(1)
      await until(() => !sync.passing)
      const before = passes.mock.calls.length
      vi.doMock('./sync2/runner.svelte', () => ({ runner }))

      account.user = { ...account.user!, syncVersion: 2 }
      sync.start()
      const { startup } = await import('./startup.svelte')
      void startup.shown()
      await until(() => runner.start.mock.calls.length > 0)
      expect(runner.start).toHaveBeenCalledTimes(1)
      expect(sync.version).toBe(2)

      await vi.advanceTimersByTimeAsync(300_000)
      expect(passes).toHaveBeenCalledTimes(before)
      expect(runner.passNow).not.toHaveBeenCalled()
    } finally {
      sync.stop()
      vi.useRealTimers()
      vi.doUnmock('./sync2/runner.svelte')
      vi.unstubAllGlobals()
    }
  })
})

describe('what the account holds of a file', () => {
  async function mirrored(
    files: Record<string, string>,
    notes: Record<string, string>,
    pushedAt = 0,
    role: 'owner' | 'write' = 'owner',
  ) {
    fake.remote.spaces.push({ id: 's-Notes', name: 'Notes', role })
    const { sha256 } = await import('./bytes')
    const tracked: Record<string, { hash: string; modified: number }> = {}
    for (const [path, words] of Object.entries(files)) {
      tracked[path] = { hash: await sha256(words), modified: pushedAt }
    }
    const held: Record<string, { id: string; version: number; hash: string }> = {}
    for (const [path, words] of Object.entries(notes)) {
      held[path] = { id: `n-${path}`, version: 1, hash: await sha256(words) }
    }
    localStorage.setItem(
      'orden:mirrors',
      JSON.stringify({
        account: 'u1',
        mirrors: { '/Notes': { spaceId: 's-Notes', root: '/Notes', files: tracked, notes: held } },
      }),
    )
    standInForTheWindow()
    vi.useFakeTimers()
    await signIn()
    account.settled()
    sync.start()
    workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]
    workspace.activeSpaceId = 'local'
    await workspace.loadTree()
  }

  afterEach(() => {
    sync.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', memoryStorage())
  })

  test('a note as it was pushed is held, and goes to the account', async () => {
    fake.disk.set('/Notes/a.md', '# a')
    await mirrored({}, { 'a.md': '# a' })

    await workspace.remove('/Notes/a.md', false)
    expect(fake.remote.local).toContain('delete_note /Notes/a.md')
  })

  test('a paper as it was pushed is held, and still goes to the trash', async () => {
    fake.disk.set('/Notes/paper.pdf', '%PDF')
    await mirrored({ 'paper.pdf': '%PDF' }, {})

    expect(await sync.holds('/Notes/paper.pdf')).toBe(true)
    await workspace.remove('/Notes/paper.pdf', false)
    expect(fake.remote.local).toContain('trash_item /Notes/paper.pdf')
    expect(fake.remote.local).not.toContain('delete_note /Notes/paper.pdf')
  })

  test('a paper highlighted since the last push goes to the trash', async () => {
    fake.disk.set('/Notes/paper.pdf', '%PDF highlighted offline')
    await mirrored({ 'paper.pdf': '%PDF' }, {}, 1)

    expect(await sync.holds('/Notes/paper.pdf')).toBe(false)
    await workspace.remove('/Notes/paper.pdf', false)
    expect(fake.remote.local).toContain('trash_item /Notes/paper.pdf')
    expect(fake.remote.local).not.toContain('delete_note /Notes/paper.pdf')
  })

  test('and so does a folder whose note was typed into offline', async () => {
    fake.disk.set('/Notes/Work/a.md', '# a\nwritten offline')
    await mirrored({}, { 'Work/a.md': '# a' })

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('trash_item /Notes/Work')
    expect(fake.remote.local).not.toContain('delete_folder /Notes/Work')
  })

  test('a note edited since the last push is not held', async () => {
    fake.disk.set('/Notes/a.md', '# a\nwritten offline')
    await mirrored({}, { 'a.md': '# a' })

    expect(await sync.holds('/Notes/a.md')).toBe(false)
  })

  test('a note as it was pushed is held, whichever line endings the file keeps', async () => {
    fake.disk.set('/Notes/a.md', '# a\r\nb')
    await mirrored({}, { 'a.md': '# a\nb' })

    expect(await sync.holds('/Notes/a.md')).toBe(true)
  })

  test('a clean note whose file differs only by its line endings is not reloaded', async () => {
    fake.disk.set('/Notes/a.md', '# a\r\nb\r\n')
    await mirrored({}, { 'a.md': '# a\nb\n' })
    await workspace.open('/Notes/a.md')
    const reload = vi.spyOn(workspace, 'reload')
    await (
      sync as unknown as {
        refresh(path: string, joined: { has(id: string): boolean }): Promise<void>
      }
    ).refresh('/Notes/a.md', { has: () => false })
    expect(reload).not.toHaveBeenCalled()
    reload.mockRestore()
  })

  test('a folder whose paper was replaced since the last push goes to the trash', async () => {
    fake.disk.set('/Notes/Work/a.md', '# a')
    fake.disk.set('/Notes/Work/paper.pdf', '%PDF replaced')
    await mirrored({ 'Work/paper.pdf': '%PDF' }, { 'Work/a.md': '# a' }, 1)

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('trash_item /Notes/Work')
    expect(fake.remote.local).not.toContain('delete_folder /Notes/Work')
  })

  test('a folder holding a paper the account holds goes to the trash', async () => {
    fake.disk.set('/Notes/Work/a.md', '# a')
    fake.disk.set('/Notes/Work/paper.pdf', '%PDF')
    await mirrored({ 'Work/paper.pdf': '%PDF' }, { 'Work/a.md': '# a' })

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('trash_item /Notes/Work')
    expect(fake.remote.local).not.toContain('delete_folder /Notes/Work')
  })

  test('and so does one holding a picture', async () => {
    fake.disk.set('/Notes/Work/a.md', '# a')
    fake.disk.set('/Notes/Work/Pictures/cat.png', 'png')
    await mirrored({}, { 'Work/a.md': '# a' })

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('trash_item /Notes/Work')
    expect(fake.remote.local).not.toContain('delete_folder /Notes/Work')
  })

  test("a note held in somebody else's space goes to the trash", async () => {
    fake.disk.set('/Notes/a.md', '# a')
    await mirrored({}, { 'a.md': '# a' }, 0, 'write')

    expect(await sync.holds('/Notes/a.md')).toBe(true)
    await workspace.remove('/Notes/a.md', false)
    expect(fake.remote.local).toContain('trash_item /Notes/a.md')
    expect(fake.remote.local).not.toContain('delete_note /Notes/a.md')
  })

  test("and so does a folder of notes held in somebody else's space", async () => {
    fake.disk.set('/Notes/Work/a.md', '# a')
    await mirrored({}, { 'Work/a.md': '# a' }, 0, 'write')

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('trash_item /Notes/Work')
    expect(fake.remote.local).not.toContain('delete_folder /Notes/Work')
  })

  test('a folder of notes the account holds all of goes to the account', async () => {
    fake.disk.set('/Notes/Work/a.md', '# a')
    fake.disk.set('/Notes/Work/Deeper/b.md', '# b')
    await mirrored({}, { 'Work/a.md': '# a', 'Work/Deeper/b.md': '# b' })

    await workspace.remove('/Notes/Work', true)

    expect(fake.remote.local).toContain('delete_folder /Notes/Work')
  })
})

describe("the space's own inbox, a hidden note (#1044)", () => {
  async function withAnInbox() {
    accountWithNotes()
    fake.addRemoteNote('s-Account', '.Inbox.md', '- [ ] Call the bank\n')
    await signIn()
    account.settled()
    await sync.pass()
  }

  test('comes down, and stays on the account though the list leaves it out', async () => {
    await withAnInbox()
    expect(fake.disk.get('/Account/.Inbox.md')).toBe('- [ ] Call the bank\n')

    await sync.pass()
    expect(fake.remote.calls.filter((one) => one.startsWith('deleteNote'))).toEqual([])
    expect(fake.remote.notes.find((one) => one.path === '.Inbox.md')?.deleted).toBe(false)
  })

  test('goes up when a task is added here', async () => {
    await withAnInbox()
    fake.disk.set('/Account/.Inbox.md', '- [ ] Call the bank\n- [ ] Buy milk\n')
    await sync.pass()

    expect(fake.remote.notes.find((one) => one.path === '.Inbox.md')?.content).toBe(
      '- [ ] Call the bank\n- [ ] Buy milk\n',
    )
  })

  test('written on two devices apart keeps every task of both, and no hidden copy', async () => {
    await withAnInbox()
    fake.disk.set('/Account/.Inbox.md', '- [ ] Call the bank\n- [ ] Buy milk\n')
    fake.writeRemoteNote('s-Account', '.Inbox.md', '- [ ] Call the bank\n- [ ] Post the letter\n')
    await sync.pass()
    await sync.pass()

    const here = fake.disk.get('/Account/.Inbox.md') ?? ''
    for (const task of ['Call the bank', 'Buy milk', 'Post the letter']) {
      expect(here.split(task)).toHaveLength(2)
    }
    expect(fake.remote.notes.find((one) => one.path === '.Inbox.md')?.content).toBe(here)
    expect([...fake.disk.keys()].filter((path) => path.includes('from another device'))).toEqual([])
  })
})
