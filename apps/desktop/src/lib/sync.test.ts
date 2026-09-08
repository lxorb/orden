import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
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
    spaces: [] as {
      id: string
      name: string
      bookmarks?: Bookmark[]
      /** What the account lets this session do here. Absent is its own. */
      role?: 'owner' | 'write' | 'read'
    }[],
    notes: [] as Note[],
    /** Every write the account received, in order. */
    calls: [] as string[],
    /** And every folder this machine took away, by how it took it. */
    local: [] as string[],
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
      case 'trash_item':
        // Which of the two a folder went through is the difference between
        // gone and recoverable, so the fake writes it down.
        remote.local.push(`${command} ${path}`)
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
    space: { id: string; name: string; bookmarks?: Bookmark[]; role?: string },
    position: number,
  ) => ({
    ...space,
    position,
    icon: null,
    role: space.role ?? 'owner',
    shared: (space.role ?? 'owner') !== 'owner',
    // What the account says it holds, which is what a machine bringing it down
    // for the first time counts against.
    notes: remote.notes.filter((note) => note.spaceId === space.id && !note.deleted).length,
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
    leaveSpace: async (_token: string, id: string) => {
      remote.calls.push(`leaveSpace ${id}`)
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
    remote.local = []
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

/** The store graph, loaded here rather than by whichever `beforeEach` runs
 *  first, which was seven seconds of it against a hook's budget of thirty. What
 *  `resetModules` costs each test after this is the re-execution alone, a tenth
 *  of a second. See docs/conventions.md. */
await Promise.all([
  import('./account.svelte'),
  import('./sync.svelte'),
  import('./workspace.svelte'),
])

beforeEach(async () => {
  fake.reset()
  // Put back rather than cleared: a test that stubs a global of its own ends by
  // unstubbing all of them, which takes this one with it. Whichever test runs
  // next should not be able to tell.
  vi.stubGlobal('localStorage', memoryStorage())

  // The stores are singletons that remember mirrors and tabs from one test to
  // the next, so each test gets freshly made ones.
  vi.resetModules()
  ;({ account } = await import('./account.svelte'))
  ;({ sync } = await import('./sync.svelte'))
  ;({ workspace } = await import('./workspace.svelte'))
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

/** The two globals the loop listens on, stood in for. It adds and removes
 *  listeners on both at every start and every stop, and node has neither. */
function standInForTheWindow(): void {
  const listeners = { addEventListener: () => undefined, removeEventListener: () => undefined }
  vi.stubGlobal('document', { hidden: false, ...listeners })
  vi.stubGlobal('window', listeners)
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

describe('a space somebody shared', () => {
  /** An account holding one space that belongs to somebody else, with a note
   *  already in it. */
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

    // Something writes into the folder anyway - another program, or a machine
    // that has since lost the role. The pass says nothing about it, because
    // saying it would be refused and because a folder somebody is reading is
    // not a statement about what the space should hold.
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

  test('is let go of rather than deleted when the folder goes', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    fake.remote.calls = []

    const [space] = workspace.spaces
    if (space) await sync.forget(space.root)

    expect(fake.remote.calls).toEqual(['leaveSpace s-Theirs'])
  })

  test('takes its folder with it when the sharing is taken back', async () => {
    sharedWithMe('write')
    await signIn()
    account.settled()
    await sync.pass()
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Theirs'])

    // The account stops listing it, with no marker: the space still exists, it
    // is simply not this one's to reach. Uploading the folder again would put a
    // copy of somebody else's space into this account.
    fake.remote.spaces = []
    fake.remote.calls = []
    await afterTheReconcileInterval(() => sync.pass())

    expect(workspace.spaces).toEqual([])
    expect(fake.remote.calls).toEqual([])
  })

  test('leaves that folder somewhere it can be got back from', async () => {
    // Nobody's Recently deleted holds a space somebody stopped sharing, so the
    // copy on this disk is the last one of what was read here.
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

    // The account would refuse the list, and asking on every pass is a refusal
    // on every pass.
    expect(fake.remote.calls).toEqual([])
  })
})

describe('the mirrors this machine remembers', () => {
  /** Starts the loop, which is what reads them back, with the two globals it
   *  listens on stood in for. */
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
    // Otherwise a folder that mirrored a space somebody shared reads, under the
    // next account to sign in here, as a space that went - and goes.
    localStorage.setItem(
      'nib:mirrors',
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

  test('are kept by a machine that wrote them before there was an account beside them', async () => {
    // The shape an older version wrote. Whoever signs in now is who they are
    // about, because they are the only account that machine had.
    localStorage.setItem(
      'nib:mirrors',
      JSON.stringify({ '/Notes': { spaceId: 's-Notes', root: '/Notes' } }),
    )

    await started()
    try {
      expect(sync.remoteIdFor('/Notes')).toBe('s-Notes')
    } finally {
      stopped()
    }
  })
})

describe('turning syncing off while a pass is in the air', () => {
  test('leaves the light off and does not start the loop again', async () => {
    accountWithNotes()
    await signIn()
    account.settled()
    // One pass first, so there is a mirror for the next one to work on.
    await sync.pass()

    standInForTheWindow()
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

describe('the first pass, which somebody is waiting on', () => {
  /** The state the app holds the whole surface for; see arriving.svelte.ts. */
  let arriving: typeof import('./arriving.svelte').arriving

  beforeEach(async () => {
    standInForTheWindow()
    ;({ arriving } = await import('./arriving.svelte'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** The loop, started with its own first tick held back.
   *
   *  Every test below drives the pass itself, and the tick `start` schedules
   *  would otherwise race it: whichever got there first would take the one thing
   *  under test, since a session has only one first pass. */
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

    // Counted rather than looked for on the disk: what is under test is when the
    // pass begins, and a whole pass finishing is a different claim.
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

      // Nought, not an interval.
      await vi.advanceTimersByTimeAsync(0)
      expect(asked).toBe(1)
    } finally {
      fake.api.listSpaces = real
      stoppedAgain()
    }
  })

  test('says so the moment the code is accepted, before anything has been asked', async () => {
    await machineWithNotes()
    accountWithNotes()

    await signIn()

    // Before the question about the notes already here, before the loop, before
    // one note has come down. Nothing is claimed about how much yet.
    expect(arriving.showing).toBe(true)
    expect(arriving.total).toBe(null)
    expect(account.syncable).toBe(false)
  })

  test('stays up across the round trip the pass opens with', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    // Held open on the account's listing, which is the round trip that used to
    // happen behind a screen saying nothing at all.
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

    // Signing in again on the same machine raises it, because a code being
    // accepted is all that is known at that point.
    await signIn()
    expect(arriving.showing).toBe(true)

    // And the loop, which does know, puts it straight back down: nothing of
    // theirs is on its way, so there is nothing to hold anybody behind.
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

    // The total came from the account's listing, before the first note landed;
    // the count is what actually arrived. They agree, and the state has gone.
    // Read before the loop is stopped, because stopping forgets both.
    expect(arriving.total).toBe(3)
    expect(arriving.done).toBe(3)
    expect(arriving.showing).toBe(false)

    stoppedAgain()
  })

  test('leaves the rail and the tree holding what came down, with no reload', async () => {
    await machineWithNotes()
    accountWithNotes()
    await signIn()
    account.settled()

    startedWithTheTickHeld()
    await sync.pass()
    expect(arriving.showing).toBe(false)
    stoppedAgain()

    // The rail has the account's space by the time the wait is over, and the
    // notes are on the disk under it.
    expect(workspace.spaces.map((space) => space.name)).toContain('Account')
    expect(fake.disk.get('/Account/Hello.md')).toBe('# Hello from the account')

    // And opening it shows them, without anything being reloaded.
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

    // The same machine, come back to. Everything is already here, so the sync
    // light is the whole report.
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

    // A code accepted raises it, and syncing is held off until that question is
    // answered - which is the one stretch where somebody is waiting hardest.
    // Stopping the loop used to take the wait with it, and left a blank screen.
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
