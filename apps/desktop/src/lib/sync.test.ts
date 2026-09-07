import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Bookmark } from './workspace/bookmarks.svelte'

/** Syncing is driven here the way the app drives it, one pass at a time,
 *  against a disk and an account that both live in memory. Under node there is
 *  neither a platform shim nor a network, so both are stood in for before the
 *  stores are imported - which is why those come in further down. */

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
    spaces: [] as { id: string; name: string; bookmarks?: Bookmark[] }[],
    notes: [] as Note[],
    /** Every write the account received, in order. */
    calls: [] as string[],
    seq: 0,
  }

  const basename = (path: string) => path.split('/').pop() ?? path
  const parent = (path: string) => path.split('/').slice(0, -1).join('/') || '/'
  /** A space is a folder straight under the root, and a folder exists while
   *  something is in it - the same rule the desktop's disk follows. */
  const spaces = () => [...new Set([...disk.keys()].map((path) => `/${path.split('/')[1]}`))].sort()

  function tree(root: string): Entry {
    if (!spaces().includes(root)) throw new Error('root is not a directory')

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

  /** What an invoke was given, when it is the kind of value it should be:
   *  `args` is a bag of unknowns. */
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
        for (const key of [...disk.keys()]) if (key.startsWith(`${path}/`)) disk.delete(key)
        return undefined as T
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
      case 'delete_note':
        disk.delete(path)
        return undefined as T
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
    space: { id: string; name: string; bookmarks?: Bookmark[] },
    position: number,
  ) => ({
    ...space,
    position,
    icon: null,
    bookmarks: space.bookmarks ?? [],
    createdAt: 0,
    updatedAt: 0,
    blog: { enabled: false, subdomain: null, domain: null, title: null, note: null, dns: [] },
  })

  /** The space these two answer about. Neither is called before one exists, so
   *  an empty list here means the test set itself up wrong. */
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
    listSpaces: async () => ({ spaces: remote.spaces.map(listed), deleted: [] as string[] }),
    createSpace: async (_token: string, name: string) => {
      remote.calls.push(`createSpace ${name}`)
      const space = { id: `s-${name}`, name }
      remote.spaces.push(space)
      return { space: listed(space, remote.spaces.length - 1) }
    },
    changes: async (_token: string, spaceId: string, since: number) => {
      const notes = remote.notes.filter((note) => note.spaceId === spaceId && note.seq > since)
      return {
        notes: await Promise.all(notes.map(wire)),
        cursor: Math.max(since, ...notes.map((note) => note.seq)),
        more: false,
      }
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
    writeNote: async (_token: string, id: string, path: string, content: string) => {
      remote.calls.push(`writeNote ${path}`)
      const note = found(id)
      Object.assign(note, { path, content, version: note.version + 1, seq: ++remote.seq })
      return { note: await wire(note) }
    },
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
    reorderSpaces: async () => ({ ok: true as const }),
    setSpaceIcon: async () => ({ space: listed(firstRemoteSpace(), 0) }),
    renameSpace: async () => ({ space: listed(firstRemoteSpace(), 0) }),
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

  function reset() {
    disk.clear()
    remote.spaces = []
    remote.notes = []
    remote.calls = []
    remote.seq = 0
  }

  return { disk, remote, invoke, api, addRemoteNote, reset }
})

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: fake.invoke,
}))

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  api: fake.api,
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

beforeEach(async () => {
  fake.reset()
  localStorage.clear()

  // The stores are singletons that remember mirrors and tabs from one test to
  // the next, so each test gets freshly made ones.
  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  ;({ sync } = await import('./sync.svelte'))
  ;({ workspace } = await import('./workspace.svelte'))

  // Auto-save would otherwise try to write a note back a moment later.
  workspace.setAutoSave(false)
})

/** A machine with one space and a note open in it, the way a browser starts. */
async function machineWithNotes() {
  fake.disk.set('/Notes/Read me.md', '# Read me')
  workspace.spaces = [{ id: 'local', name: 'Notes', root: '/Notes' }]
  workspace.activeSpaceId = 'local'
  await workspace.loadTree()
  await workspace.open('/Notes/Read me.md')
}

/** An account that already holds a space with a note in it. */
function accountWithNotes() {
  fake.remote.spaces.push({ id: 's-Account', name: 'Account' })
  fake.addRemoteNote('s-Account', 'Hello.md', '# Hello from the account')
}

async function signIn() {
  account.email = 'me@example.com'
  expect(await account.verify('123456')).toBe(true)
}

/** Runs something with the clock far enough on that the loop asks the account
 *  for its spaces again: within one interval it works from the list it already
 *  has, which is the whole point of the interval. */
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

    // The code is accepted, and the request that follows it is not.
    const real = fake.api.listSpaces
    fake.api.listSpaces = () => Promise.reject(new Error('offline'))

    try {
      account.email = 'me@example.com'
      // False here would tell the sign-in sheet the code was refused, and the
      // question about the notes on this machine would never be asked - while
      // the session it made in passing let syncing upload them unasked.
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

  test('erasing them brings the account down in their place, without a restart', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()

    await workspace.eraseLocalSpaces()
    account.settled()
    await sync.pass()

    expect(workspace.spaces.map((space) => space.name)).toEqual(['Account'])
    expect(workspace.activeSpace?.name).toBe('Account')
    expect(workspace.tree?.children.map((entry) => entry.name)).toEqual(['Hello.md'])
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    // Nothing that was erased reaches the account, and nothing of the
    // account's is taken for deleted.
    expect(fake.remote.calls).toEqual([])
    expect(fake.remote.spaces.map((space) => space.name)).toEqual(['Account'])

    // No tab is left pointing at a note that is gone.
    expect(workspace.tabs.every((tab) => !tab.path)).toBe(true)
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

    // What was on screen stays on screen.
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
})

describe('a mirror whose folder is gone', () => {
  test('is left alone rather than read as every note deleted', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    await sync.pass()

    // The folder goes without syncing hearing of it.
    await fake.invoke('delete_space', { path: '/Account' })
    workspace.spaces = []

    await sync.run()
    expect(fake.remote.calls).toEqual([])
  })
})

describe('the bookmarks of a space', () => {
  /** A machine that has bookmarked a note in the space it holds. */
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

    // Another machine dropped it. The pass that next asks the account for its
    // spaces takes that, rather than offering this machine's copy back.
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

describe('turning syncing off while a pass is in the air', () => {
  test('leaves the light off and does not start the loop again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    // One pass first, so there is a mirror for the next one to work on.
    await sync.pass()

    const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined }
    vi.stubGlobal('document', { hidden: false, ...listeners })
    vi.stubGlobal('window', listeners)
    vi.useFakeTimers()

    // Holds the next pass open on the network, so it is still in flight when
    // syncing is turned off - which is what signing out looks like from here.
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

      // The pass finished after the stop; what it thinks the state is no
      // longer holds.
      expect(sync.status).toBe('off')

      // And it must not have set the next timer: a stopped loop stays stopped.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
      expect(asked).toBe(1)
    } finally {
      fake.api.changes = real
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
