import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { answerThreadSpaces, callerOf, type Caller, READER } from '../../automation/caller'
import { AGENT_WINDOW_VERBS } from '../verbs'
import { type FileOp, FileOps, type Kind } from '../../workspace/file-ops'

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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const work = { id: 'work', name: 'Work', root: '/s/Work' }
const home = { id: 'home', name: 'Home', root: '/s/Home' }
const secret = { id: 'secret', name: 'Secret', root: '/s/Secret' }

const files = new Map<string, string>()
const folders = new Set<string>()
const unreadable = new Set<string>()
const appearing = new Map<string, string>()

interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

function treeOf(root: string): Entry {
  const top: Entry = { name: root, path: root, is_dir: true, modified: 0, created: 0, children: [] }
  const at = new Map<string, Entry>([[root, top]])
  const under = (path: string, is_dir: boolean) => {
    const parent = path.slice(0, path.lastIndexOf('/'))
    if (!at.has(parent)) under(parent, true)
    const entry: Entry = {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      is_dir,
      modified: 1,
      created: 1,
      children: [],
    }
    at.get(parent)?.children.push(entry)
    at.set(path, entry)
  }
  for (const path of [...folders].sort()) if (path.startsWith(`${root}/`)) under(path, true)
  for (const path of [...files.keys()].sort()) if (path.startsWith(`${root}/`)) under(path, false)
  return top
}

const tabs = [
  {
    id: 't1',
    kind: 'note',
    path: '/s/Work/Plan.md',
    paneId: 'p1',
    shown: 'Plan',
    note: { live: { readerAt: null }, shared: null },
  },
  {
    id: 't2',
    kind: 'note',
    path: '/s/Work/Pinned.md',
    paneId: 'p1',
    shown: 'Pinned',
    note: { live: { readerAt: null }, shared: null },
  },
  {
    id: 'w1',
    kind: 'web',
    path: '/s/Work/Docs.url',
    paneId: 'p2',
    shown: 'Docs',
    note: { live: { readerAt: null }, shared: null },
  },
]

const marks: Record<string, { kind: string; path: string; text: string }[]> = {}

const workspace = {
  spaces: [work, home, secret],
  get notes() {
    return [...files.keys()]
      .filter((path) => path.endsWith('.md'))
      .map((path) => ({ path, name: path.split('/').pop() ?? path }))
  },
  rootHolding: (path: string) =>
    [work, home, secret].find((one) => path.startsWith(`${one.root}/`))?.root ?? null,
  itemMeta: { of: () => null, set: () => undefined },
  get shownSpaces() {
    return this.spaces
  },
  activeSpaceId: 'work',
  get activeSpace() {
    return this.spaces.find((one) => one.id === this.activeSpaceId) ?? null
  },
  get tree() {
    return treeOf(this.activeSpace?.root ?? '')
  },
  tabs,
  panes: { focusedId: 'p1', at: (id: string) => (id === 'p3' ? null : { id }) },
  spaceOf: (note: { home?: string }) => note.home ?? 'work',
  activeTabId: 't1',
  previewTabId: null,
  outside: (path: string) =>
    !['/s/Work/', '/s/Home/', '/s/Secret/'].some((root) => path.startsWith(root)),
  get active() {
    return tabs[0]
  },
  showSpace: vi.fn(),
  selectSpace: vi.fn(),
  noteText: (path: string) => Promise.resolve(files.get(path) ?? null),
  keepsArchived: (path: string) => path === '/s/Home/Old.md',
  remove: vi.fn((path: string) => {
    files.delete(path)
    return Promise.resolve()
  }),
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve()),
  loadTree: vi.fn(() => Promise.resolve()),
  openEntry: vi.fn(() => Promise.resolve()),
  openPage: vi.fn(() => 't1'),
  close: vi.fn(),
  activate: vi.fn(),
  split: vi.fn(),
  showing: (pane: string) => tabs.find((one) => one.paneId === pane) ?? null,
  webAddressOf: () => 'https://docs.example/',
  archive: {
    keysOf: (root: string) => new Set(root === '/s/Home' ? ['Old.md'] : []),
  },
  leftOutOf: (root: string) => (root === '/s/Home' ? ['Old.md'] : []),
  bookmarks: {
    of: (root: string) => marks[root] ?? [],
    put: vi.fn((root: string, list: { kind: string; path: string; text: string }[]) => {
      marks[root] = list
    }),
    remove: vi.fn(),
  },
  documentAt: () => null,
  fileOps: new FileOps(),
  holdingUnder: vi.fn((_path: string, run: () => Promise<void>) => run()),
  undone: { moved: () => undefined },
  renameOnDisk: vi.fn(async (from: string, to: string) => {
    const { invoke } = await import('../../tauri')
    await invoke('rename_note', { from, to })
  }),
  fileMoved: vi.fn((from: string, to: string, kind: Kind) =>
    workspace.fileOps.tell({ op: 'moved', from, to, kind, root: '/s/Home' }),
  ),
}

vi.mock('../../workspace.svelte', () => ({ workspace }))

const asked: { command: string; args: Record<string, unknown> }[] = []
let answer: Record<string, unknown> = { status: 'ok', result: {} }

const PAGE = {
  url: 'https://docs.example/a',
  title: 'A page',
  html: '<article><p>Words of the page.</p></article>',
}
let captured: Record<string, unknown> = {}
function reads(result: Record<string, unknown>) {
  captured = { status: 'ok', result: { ...PAGE, ...result }, untrusted: PAGE.url }
}

const shell = {
  hangs: false,
  output: null as { onmessage: (message: unknown) => void } | null,
}

function crate(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  asked.push({ command, args })
  const path = typeof args.path === 'string' ? args.path : ''

  switch (command) {
    case 'read_tree':
      return Promise.resolve(treeOf(String(args.root)))
    case 'read_note':
      if (unreadable.has(path))
        return Promise.reject(new Error('stream did not contain valid UTF-8'))
      return files.has(path) ? Promise.resolve(files.get(path)) : Promise.reject(new Error('gone'))
    case 'path_exists': {
      const came = appearing.get(path)
      if (came !== undefined) {
        appearing.delete(path)
        files.set(path, came)
      }
      return Promise.resolve(files.has(path) || unreadable.has(path) || folders.has(path))
    }
    case 'write_note':
      files.set(path, String(args.content))
      return Promise.resolve()
    case 'rename_note': {
      const from = String(args.from)
      const to = String(args.to)
      files.set(to, files.get(from) ?? '')
      files.delete(from)
      return Promise.resolve()
    }
    case 'create_folder':
      folders.add(path)
      return Promise.resolve()
    case 'agents_ask':
    case 'agents_dialog_path':
      return Promise.resolve(answer)
    case 'agents_capture':
      return Promise.resolve(captured)
    case 'save_asset':
      return Promise.resolve(`files/${String(args.name)}`)
    case 'agents_log':
      return Promise.resolve(log)
    case 'pty_spawn':
      shell.output = args.output as typeof shell.output
      return Promise.resolve()
    case 'pty_write':
      if (args.data === 'exit\r' && !shell.hangs) shell.output?.onmessage({ exit: 0 })
      return Promise.resolve()
    default:
      return Promise.resolve(null)
  }
}

vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
  invoke: (command: string, args?: Record<string, unknown>) => crate(command, args),
}))

vi.mock('../../native', async (original) => ({
  ...(await original<typeof import('../../native')>()),
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined
  },
}))

vi.mock('../../sharing.svelte', () => ({
  trustsHtmlAt: () => true,
  isShared: (root: string) => root === '/s/Home',
  reachedByOthers: (path: string | null) =>
    path !== null && (path.startsWith('/s/Home/') || othersWrite.has(path)),
  reachedAs: (path: string | null) =>
    path === null
      ? null
      : path.startsWith('/s/Home/')
        ? 'space'
        : othersWrite.has(path)
          ? 'note'
          : null,
  reachedByOthersIn: (root: string) =>
    root === '/s/Home' || [...othersWrite].some((path) => path.startsWith(`${root}/`)),
  canWriteAt: (path: string) => ![...readOnly].some((root) => path.startsWith(`${root}/`)),
  roleOf: (root: string) => (readOnly.has(root) ? 'read' : 'owner'),
}))

const othersWrite = new Set<string>()

const readOnly = new Set<string>()

const indexed: { root: string; asked: string; args: unknown[] }[] = []

vi.mock('../../link-index.svelte', () => {
  class Links {
    root = ''
    archivedIn: (root: string) => ReadonlySet<string> = () => new Set()
    build(root: string) {
      this.root = root
      indexed.push({ root, asked: 'build', args: [] })
      return Promise.resolve()
    }
    scanned() {
      return Promise.resolve()
    }
    backlinks(path: string) {
      indexed.push({ root: this.root, asked: 'backlinks', args: [path] })
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
      return [...files]
        .filter(([at, text]) => at.startsWith(`${this.root}/`) && text.includes(`[[${name}]]`))
        .map(([at]) => ({
          path: at.slice(this.root.length + 1),
          name: '',
          line: 2,
          text: ` [[${name}]] `,
        }))
    }
    outgoing() {
      return []
    }
    retarget(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'retarget', args })
      return Promise.resolve(1)
    }
    notesMoved(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'notesMoved', args })
    }
    noteGone(...args: unknown[]) {
      indexed.push({ root: this.root, asked: 'noteGone', args })
    }
    follow(op: FileOp) {
      if (op.op === 'moved') this.notesMoved(op.from, op.to)
      else if (op.op === 'removed') this.noteGone(op.path)
    }
    noteSaved() {
      return undefined
    }
  }
  const links = new Links()
  links.root = '/s/Work'
  return { links, spaceLinks: () => new Links() }
})

vi.mock('@orden/scan/search/query', () => ({ parseQuery: (text: string) => ({ text }) }))

const searched: string[] = []

vi.mock('../../search/space', () => ({
  searchSpace: (
    root: string,
    query: { text: string },
    _terms: unknown,
    _limit: number,
    found: (batch: { hits: unknown[] }) => void,
    excluded: string[],
  ) => {
    searched.push(root)
    const hits = [...files]
      .filter(([at]) => at.startsWith(`${root}/`) && !excluded.some((one) => at.endsWith(one)))
      .filter(([, text]) => text.toLowerCase().includes(query.text.toLowerCase()))
      .map(([at, text]) => ({
        path: at,
        name: '',
        line: 0,
        text: text.split('\n')[0] ?? '',
        ranges: [],
      }))
    found({ hits })
    return Promise.resolve()
  },
}))

const docs = {
  readNote: vi.fn((at: { path: string; space: string }) => {
    const root = [work, home, secret].find((one) => one.id === at.space)?.root ?? ''
    return Promise.resolve({
      path: at.path,
      space: at.space,
      rev: 'r1',
      open: false,
      typing: false,
      text: files.get(`${root}/${at.path}`) ?? '',
      tasks: [{ anchor: { task: 'Buy milk' }, done: false, line: 2 }],
    })
  }),
  editNote: vi.fn((_agent: unknown, at: { path: string }) =>
    Promise.resolve({ path: at.path, rev: 'r2', edits: 1, lines: [0] }),
  ),
  writeNote: vi.fn((_agent: unknown, at: { path: string }, _text?: string) =>
    Promise.resolve({ path: at.path, rev: 'r2', edits: 1, lines: [0] }),
  ),
}

vi.mock('../docs', async () => ({ ...(await import('../docs/problem')), notes: docs }))

const heard: ((event: { kind: string; agent: string | null }) => void)[] = []
vi.mock('../settings/crate', () => ({
  tauriCrate: {
    hear: (on: (event: { kind: string; agent: string | null }) => void) => {
      heard.push(on)
      return Promise.resolve(() => undefined)
    },
  },
}))

vi.mock('../../commands', () => ({
  appCommands: () => [
    { id: 'files', label: 'File list', run: () => ran.push('files') },
    { id: 'record', label: 'Record', byHand: true, run: () => ran.push('record') },
    { id: 'new-terminal', label: 'New terminal', ownWindow: true, run: () => ran.push('shell') },
    { id: 'close-window', label: 'Close window', run: () => ran.push('close-window') },
    { id: 'publish', label: 'Publish this space as a blog', run: () => ran.push('publish') },
    { id: 'space:home', label: 'Space: Home', run: () => ran.push('space:home') },
    { id: 'close-all', label: 'Close all', run: () => ran.push('close-all') },
    { id: 'settings', label: 'Settings', run: () => ran.push('settings') },
    { id: 'graph', label: 'Graph', run: () => ran.push('graph') },
    { id: 'reformat', label: 'Tidy up', run: () => ran.push('reformat') },
    { id: 'edit.delete-line', label: 'Delete the line', run: () => ran.push('delete-line') },
    { id: 'undo-file', label: 'Undo', run: () => ran.push('undo-file') },
    { id: 'theme:night', label: 'Theme: Night', run: () => ran.push('theme') },
    { id: 'row-from-next-year', label: 'Something new', run: () => ran.push('new') },
    { id: 'new-unique', label: 'New note', run: () => ran.push('new-unique') },
    { id: 'new-canvas', label: 'New canvas', run: () => ran.push('new-canvas') },
    { id: 'new-database', label: 'New base', run: () => ran.push('new-database') },
    { id: 'copy-uri', label: 'Copy link', run: () => ran.push('copy') },
    {
      id: 'export-pdf',
      label: 'Export as PDF',
      run: () =>
        void import('../../dialog-answer').then(async ({ dialogAnswer }) => {
          ran.push(`export-pdf:${(await dialogAnswer()?.(true)) ?? 'cancelled'}`)
        }),
    },
  ],
}))
const ran: string[] = []

const rows = {
  focus: false,
  accent: 'violet',
  languages: new Set(['en']),
}
vi.mock('../../settings/declarations', () => ({
  declarations: () =>
    Promise.resolve([
      {
        kind: 'switch',
        key: 'editor.focusMode',
        label: 'Focus mode',
        hint: 'Dims every paragraph but the one being written.',
        get: () => rows.focus,
        set: (on: boolean) => (rows.focus = on),
      },
      {
        kind: 'swatches',
        key: 'appearance.accent',
        label: 'Accent',
        hint: 'The colour of buttons, links and the selection.',
        options: [{ value: 'violet' }, { value: 'blue' }],
        get: () => rows.accent,
        set: (value: string) => (rows.accent = value),
      },
      ...['en', 'de'].map((member) => ({
        kind: 'switch',
        key: 'spelling.languages',
        member,
        label: member,
        hint: 'The languages spelling is checked in.',
        get: () => rows.languages.has(member),
        set: (on: boolean) => (on ? rows.languages.add(member) : rows.languages.delete(member)),
      })),
    ]),
}))

const lentPage: Record<string, unknown> = { url: null, space: null }
const lending = { lend: vi.fn(() => Promise.resolve()), unlend: vi.fn() }
vi.mock('../../web-tab/lending', () => lending)

vi.mock('../../web-tab/pages.svelte', () => ({
  pages: {
    of: () => lentPage,
    addressOf: () => 'https://docs.example/a',
    read: () =>
      Promise.resolve({
        url: 'https://docs.example/a',
        title: 'A page',
        html: '<article><p>Words of the page.</p></article>',
      }),
  },
}))

vi.mock('../../versions', () => ({
  versionsOf: () => Promise.resolve([{ at: 1_000, size: 9, path: '/h/1', by: '' }]),
  versionText: () => Promise.resolve('old words'),
}))

vi.mock('../../sync.svelte', () => ({ sync: { nudge: () => undefined } }))

const openDocument = vi.hoisted(() =>
  vi.fn((_path: string) => Promise.reject(new Error('no PDF here'))),
)
vi.mock('../../pdf/document', () => ({ openDocument }))

vi.mock('../../terminal/shells.svelte', () => ({
  shells: { ask: () => Promise.resolve([]), chosen: { id: 'pwsh', name: 'PowerShell' } },
}))

vi.mock('../../tasks-model/src/api', async (actual) => {
  const real = await actual<typeof import('../../tasks-model/src/api')>()
  const disks = new Map<string, InstanceType<typeof real.MemoryTodoDisk>>()
  const store = new real.TodoStore({
    openDisk: (owner) => {
      const held = disks.get(owner ?? '') ?? new real.MemoryTodoDisk()
      disks.set(owner ?? '', held)
      return Promise.resolve(held)
    },
    now: () => Date.now(),
    channel: () => null,
    warn: () => undefined,
    later: () => () => undefined,
  })
  await store.opened({ owner: null, server: null, device: 'test' })
  return { ...real, todos: store }
})

vi.mock('../../rows/rows.svelte', async () => {
  const { rowsOfText } = await import('@orden/bases/rows')
  const spaces = [work, home, secret]
  return {
    rows: {
      get shown() {
        return this.of
      },
      ready: true,
      of: (name: string) => {
        const space = spaces.find((one) => one.name === name)
        if (!space) return []
        return [...files]
          .filter(([at]) => at.startsWith(`${space.root}/`) && at.endsWith('.md'))
          .flatMap(([at, text]) => rowsOfText(space.name, at.slice(space.root.length + 1), text))
          .filter((row) => row.kind !== 'task')
      },
    },
  }
})

let log: unknown[] = []

const { runAgentVerb, AGENT_VERBS, answerTheCrate } = await import('./index')
const { forgetIndexes } = await import('./links')
const { EXPERIMENTAL_WORD, BASES_WORD, hiddenKinds } = await import('../../settings.svelte')

const EVERY = [
  'context',
  'notes.read',
  'notes.write',
  'tree',
  'workspace',
  'workspace.focus',
  'browser',
  'browser.reader',
  'settings',
  'terminal',
]

function agent(change: Record<string, unknown> = {}): Caller {
  return callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes: EVERY,
    spaces: ['Work', 'Home'],
    mode: 'unsupervised',
    programs: ['git'],
    ...change,
  })
}

function call(verb: string, args: Record<string, unknown>, caller: Caller = agent()) {
  return runAgentVerb(verb, args, caller)
}

beforeEach(() => {
  files.clear()
  folders.clear()
  unreadable.clear()
  appearing.clear()
  readOnly.clear()
  files.set('/s/Work/Plan.md', '# Plan\n')
  files.set('/s/Work/Pinned.md', '# Pinned\n')
  files.set('/s/Home/Recipes.md', '# Recipes\n\nSee [[Soup]] tonight.\n')
  files.set('/s/Home/Soup.md', '# Soup\n\n- [ ] Buy milk\n')
  files.set('/s/Home/Old.md', '# Old soup\n')
  files.set('/s/Home/board.canvas', '{"nodes":[],"edges":[]}')
  files.set('/s/Secret/Diary.md', '# Diary\n')
  for (const key of Object.keys(marks)) Reflect.deleteProperty(marks, key)
  asked.length = 0
  indexed.length = 0
  searched.length = 0
  ran.length = 0
  answer = { status: 'ok', result: {} }
  shell.hangs = false
  reads({})
  forgetIndexes()
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, BASES_WORD]
  vi.clearAllMocks()
})

describe('the verbs', () => {
  test('are the crate list, every one', () => {
    expect([...AGENT_VERBS].sort()).toEqual(Object.keys(AGENT_WINDOW_VERBS).sort())
  })
})

describe('another space, without switching', () => {
  test('an agent reads and writes Home while the reader stays in Work, tabs untouched', async () => {
    const before = JSON.stringify(tabs)

    const calls: [string, Record<string, unknown>][] = [
      ['list_notes', { space: 'Home' }],
      ['search_notes', { space: 'Home', query: 'soup' }],
      ['list_backlinks', { space: 'Home', path: 'Soup' }],
      ['read_note', { space: 'Home', path: 'Soup' }],
      ['read_canvas', { space: 'Home', path: 'board.canvas' }],
      [
        'edit_canvas',
        { space: 'Home', path: 'board.canvas', ops: [{ op: 'add_card', text: 'Hi' }] },
      ],
      ['create_note', { space: 'Home', path: 'Stew', content: '# Stew\n' }],
      ['write_note', { space: 'Home', path: 'Soup', content: '# Soup!\n' }],
      ['append_note', { space: 'Home', path: 'Soup', content: 'More.' }],
      ['set_task', { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true }],
      ['list_versions', { space: 'Home', path: 'Soup' }],
      ['bookmarks', { space: 'Home', op: 'add', path: 'Recipes.md' }],
      ['move_file', { space: 'Home', path: 'Soup.md', to: 'Food/Soup.md' }],
      ['create_folder', { space: 'Home', path: 'Drinks' }],
      ['trash_file', { space: 'Home', path: 'Recipes.md' }],
    ]
    for (const [verb, args] of calls) {
      expect(await call(verb, args), verb).toMatchObject({ ok: true, status: 'ok' })
    }

    expect(workspace.showSpace).not.toHaveBeenCalled()
    expect(workspace.selectSpace).not.toHaveBeenCalled()
    expect(workspace.activeSpace?.name).toBe('Work')
    expect(JSON.stringify(tabs)).toBe(before)
    expect(workspace.openEntry).not.toHaveBeenCalled()
    expect(workspace.close).not.toHaveBeenCalled()
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  test('the tree of Home is read off the disk, and the search asked of Home', async () => {
    const listed = await call('list_notes', { space: 'Home' })
    expect(listed).toMatchObject({
      result: [
        { path: 'board.canvas', kind: 'canvas' },
        { path: 'Recipes.md', kind: 'note' },
        { path: 'Soup.md', kind: 'note' },
      ],
      untrusted: 'shared space Home',
    })
    expect(asked).toContainEqual({
      command: 'read_tree',
      args: { root: '/s/Home', options: { showHidden: false } },
    })

    const found = await call('search_notes', { space: 'Home', query: 'soup' })
    expect(searched).toEqual(['/s/Home'])
    expect(found).toMatchObject({
      result: [
        { space: 'Home', path: 'Recipes.md', line: 1 },
        { space: 'Home', path: 'Soup.md', line: 1 },
      ],
    })
  })

  test('a query or filter is at most 1000 characters, refused before any space is searched', async () => {
    const long = 'soup '.repeat(201)
    for (const [verb, args] of [
      ['search_notes', { query: long }],
      ['bookmarks', { space: 'Home', op: 'add', query: long }],
    ] as const) {
      expect(await call(verb, args)).toMatchObject({ code: 'bad_arguments' })
    }
    expect(searched).toEqual([])
    expect(marks['/s/Home']?.filter((one) => one.kind === 'search') ?? []).toEqual([])
  })

  test('the backlinks of Home come from an index of Home, not the window own', async () => {
    const answered = await call('list_backlinks', { space: 'Home', path: 'Soup' })
    expect(answered).toMatchObject({ result: [{ path: 'Recipes.md', line: 3 }] })
    expect(indexed).toContainEqual({ root: '/s/Home', asked: 'build', args: [] })
  })

  test('a move in Home rewrites the links through Home and tells its stores, off the reader undo', async () => {
    await call('move_file', { space: 'Home', path: 'Soup.md', to: 'Food/Soup' })

    expect(files.has('/s/Home/Food/Soup.md')).toBe(true)
    expect(workspace.holdingUnder).toHaveBeenCalledWith('/s/Home/Soup.md', expect.anything())
    expect(indexed).toContainEqual({
      root: '/s/Home',
      asked: 'retarget',
      args: ['/s/Home/Soup.md', '/s/Home/Food/Soup.md', '/s/Home', undefined, { moved: true }],
    })
    expect(workspace.fileMoved).toHaveBeenCalledWith(
      '/s/Home/Soup.md',
      '/s/Home/Food/Soup.md',
      'file',
    )
    expect(indexed).toContainEqual({
      root: '/s/Home',
      asked: 'notesMoved',
      args: ['/s/Home/Soup.md', '/s/Home/Food/Soup.md'],
    })
    expect(workspace.rename).not.toHaveBeenCalled()
    expect(workspace.moveMany).not.toHaveBeenCalled()
  })

  test('no note becomes the space’s instructions by being moved or renamed', async () => {
    for (const args of [
      { path: 'Plan.md', to: 'AGENTS' },
      { path: 'Plan.md', to: 'AGENTS.md' },
      { space: 'Home', path: 'Soup.md', to: 'AGENTS.md' },
    ]) {
      expect(await call('move_file', args)).toMatchObject({
        code: 'bad_arguments',
        message: expect.stringContaining('write_note') as string,
      })
    }
    expect(workspace.rename).not.toHaveBeenCalled()
    expect(workspace.moveMany).not.toHaveBeenCalled()
  })

  test('the space that is open takes the tree own rename', async () => {
    expect(await call('move_file', { path: 'Plan.md', to: 'Old plan' })).toMatchObject({
      result: { from: 'Plan.md', to: 'Old plan.md', space: 'work' },
    })
    expect(workspace.rename).toHaveBeenCalledWith('/s/Work/Plan.md', 'Old plan.md')
  })

  test('a space the grant does not reach does not exist', async () => {
    const listed = await call('list_spaces', {})
    expect(listed).toMatchObject({ result: [{ name: 'Work', open: true }, { name: 'Home' }] })
    expect(JSON.stringify(listed)).not.toContain('Secret')

    for (const verb of ['read_note', 'list_notes', 'search_notes', 'trash_file']) {
      expect(await call(verb, { space: 'Secret', path: 'Diary', query: 'x' }), verb).toMatchObject({
        code: 'no_such_space',
        message: 'there is no space called Secret',
      })
    }
    await call('search_notes', { query: 'diary' })
    expect(searched).toEqual(['/s/Work', '/s/Home'])
  })

  test('the reader own command line reaches every space', async () => {
    expect(await call('list_notes', { space: 'Secret' }, READER)).toMatchObject({
      result: [{ path: 'Diary.md' }],
    })
  })
})

describe('the tree', () => {
  test('hides what is archived unless asked, and filters by kind and folder', async () => {
    expect(await call('list_notes', { space: 'Home', archived: true, kind: 'note' })).toMatchObject(
      {
        result: [{ path: 'Old.md', archived: true }, { path: 'Recipes.md' }, { path: 'Soup.md' }],
      },
    )
    expect(await call('list_notes', { space: 'Home', kind: 'sticker' })).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('never writes over a file, never puts a folder inside itself, and leaves hidden ones be', async () => {
    expect(
      await call('move_file', { space: 'Home', path: 'Soup.md', to: 'Recipes' }),
    ).toMatchObject({
      code: 'exists',
    })
    folders.add('/s/Home/Food')
    expect(
      await call('move_file', { space: 'Home', path: 'Food', to: 'Food/Inner' }),
    ).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('trash_file', { space: 'Home', path: '.obsidian/app.json' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(
      await call('move_file', { space: 'Home', path: '../Work/Plan.md', to: 'x' }),
    ).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('trashes to Recently deleted with the agent named, never the archive, never a changed note', async () => {
    expect(await call('trash_file', { space: 'Home', path: 'Old.md' })).toMatchObject({
      code: 'archived',
    })
    expect(
      await call('trash_file', { space: 'Home', path: 'Soup', if_rev: 'stale' }),
    ).toMatchObject({
      code: 'rev_changed',
    })
    expect(await call('trash_file', { space: 'Home', path: 'Soup' })).toMatchObject({
      result: { path: 'Soup.md', trashed: true, space: 'home' },
    })
    expect(workspace.remove).toHaveBeenCalledWith('/s/Home/Soup.md', false, 'Claude Code')
  })

  test('closes a tab of the reader only with workspace.focus', async () => {
    expect(
      await call('trash_file', { path: 'Plan.md' }, agent({ scopes: ['tree'] })),
    ).toMatchObject({ code: 'not_granted' })
    expect(workspace.remove).not.toHaveBeenCalled()
    expect(await call('trash_file', { path: 'Plan.md' })).toMatchObject({ status: 'ok' })
  })

  test('makes a folder once', async () => {
    expect(await call('create_folder', { path: 'Ideas' })).toMatchObject({ result: { made: true } })
    expect(await call('create_folder', { path: 'Ideas' })).toMatchObject({
      result: { made: false },
    })
    expect(workspace.loadTree).toHaveBeenCalled()
  })
})

describe('the reader tabs', () => {
  test('opens behind the tab in front, and nothing more without workspace.focus', async () => {
    await call('workspace_tabs', { op: 'open', path: 'Pinned.md' })
    expect(workspace.openEntry).toHaveBeenCalledWith('/s/Work/Pinned.md', {
      activate: false,
      beside: true,
    })

    const plain = agent({ scopes: ['workspace'] })
    for (const [args, why] of [
      [{ op: 'open', path: 'Plan.md', background: false }, 'opening in front'],
      [{ op: 'open', path: 'Soup.md', space: 'Home' }, 'another space'],
      [{ op: 'focus', tab: 't2' }, 'bringing a tab to the front'],
      [{ op: 'split', tab: 't1' }, 'a split'],
      [{ op: 'close', tab: 't1' }, 'closing a tab the reader can see'],
    ] as const) {
      expect(await call('workspace_tabs', args, plain), why).toMatchObject({
        code: 'not_granted',
        message: `${why} needs workspace.focus, which this agent was not granted`,
      })
    }
    expect(workspace.showSpace).not.toHaveBeenCalled()
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  describe('of a space the grant does not reach', () => {
    const away = {
      id: 'x1',
      kind: 'web',
      path: null,
      paneId: 'p3',
      pinned: false,
      shown: 'Beta bank',
      note: { live: { readerAt: null }, shared: null, home: 'secret' },
    }
    const onlyWork = () => agent({ spaces: ['Work'] })
    beforeEach(() => {
      tabs.push(away as unknown as (typeof tabs)[number])
    })
    afterEach(() => {
      tabs.splice(tabs.indexOf(away as unknown as (typeof tabs)[number]), 1)
    })

    test('are not listed, in either list', async () => {
      const list = (await call('workspace_tabs', { op: 'list' }, onlyWork())) as {
        result: { id: string }[]
      }
      expect(list.result.map((one) => one.id)).toEqual(['t1', 't2', 'w1'])
      const context = (await call('get_context', {}, onlyWork())) as {
        result: { tabs: { id: string }[] }
      }
      expect(context.result.tabs.map((one) => one.id)).toEqual(['t1', 't2', 'w1'])
      const every = (await call('workspace_tabs', { op: 'list' }, agent({ spaces: 'all' }))) as {
        result: { id: string }[]
      }
      expect(every.result.map((one) => one.id)).toContain('x1')
    })

    test('do not exist by their id', async () => {
      for (const op of ['rename', 'focus', 'close', 'split', 'save']) {
        expect(
          await call('workspace_tabs', { op, tab: 'x1', name: 'n' }, onlyWork()),
          op,
        ).toMatchObject({ code: 'no_such_tab' })
      }
      expect(workspace.close).not.toHaveBeenCalledWith('x1')
      for (const verb of ['read_terminal', 'type_terminal']) {
        expect(await call(verb, { tab: 'x1', text: 'ls' }, onlyWork()), verb).toMatchObject({
          code: 'no_such_tab',
        })
      }
    })
  })

  test('a site kept from the reader’s tabs stays out however it is written', async () => {
    const kept = agent({
      sites: { 'denied.example': 'deny', '*.star.example': 'deny', 'bank.example': 'agent-store' },
    })
    for (const url of [
      'https://denied.example/',
      'https://denied.example./',
      'https://a.denied.example../',
      'https://a.star.example/',
      'https://bank.example/',
      'https://www.bank.example./',
    ]) {
      expect(await call('workspace_tabs', { op: 'open', url }, kept), url).toMatchObject({
        code: 'site_denied',
      })
    }
    workspace.openPage.mockClear()
    const carved = agent({ sites: { 'evil.example': 'deny', 'ok.evil.example': 'allow' } })
    expect(
      await call('workspace_tabs', { op: 'open', url: 'https://ok.evil.example/' }, carved),
    ).not.toMatchObject({ code: 'site_denied' })
    expect(workspace.openPage).toHaveBeenCalled()
  })

  test('nothing an agent does moves the reader, whatever it may (#1070)', async () => {
    const everything = agent({ mode: 'autonomous' })
    vi.mocked(workspace.openEntry).mockClear()
    for (const [verb, args] of [
      ['workspace_tabs', { op: 'open', path: 'Pinned.md' }],
      ['create_note', { path: 'Fresh.md', content: '# Fresh', open: true }],
      ['write_note', { path: 'Plan.md', content: '# Plan\n' }],
      ['create_folder', { path: 'Later' }],
      ['move_file', { path: 'Fresh.md', to: 'Later/Fresh.md' }],
      ['read_note', { path: 'Plan.md' }],
      ['get_context', {}],
    ] as const) {
      await call(verb, args, everything)
    }
    expect(workspace.openEntry).toHaveBeenCalled()
    for (const [, how] of vi.mocked(workspace.openEntry).mock.calls as unknown as [
      string,
      Record<string, unknown>,
    ][]) {
      expect(how).toMatchObject({ activate: false })
    }
    expect(workspace.activeTabId).toBe('t1')
    expect(workspace.activate).not.toHaveBeenCalled()
    expect(workspace.showSpace).not.toHaveBeenCalled()
    expect(workspace.split).not.toHaveBeenCalled()
  })

  test('lists them, a page title marked as the page', async () => {
    expect(await call('workspace_tabs', { op: 'list' })).toMatchObject({
      result: [{ id: 't1', path: 'Plan.md', front: true }, { id: 't2' }, { id: 'w1', kind: 'web' }],
      untrusted: 'tab titles',
    })
  })

  test('the context says where the reader is', async () => {
    expect(await call('get_context', {})).toMatchObject({
      result: {
        space: 'Work',
        selected: { id: 't1', path: 'Plan.md', selected: true, front: true },
        selection: null,
        typing: false,
      },
    })
  })
})

describe('what asks the reader first', () => {
  test('a version put back is deleting for good, and goes through once allowed', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'Put back' }
    expect(
      await call('restore_version', { space: 'Home', path: 'Soup', version: 'device:1000' }),
    ).toEqual({ ok: true, status: 'needs_approval', approval: 'a1', summary: 'Put back' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      agent: 'claude-code',
      category: 'deleting',
    })
    expect(docs.writeNote).not.toHaveBeenCalled()

    answer = { status: 'ok', result: {} }
    await call('restore_version', { space: 'Home', path: 'Soup', version: 'device:1000' })
    expect(asked).toContainEqual({
      command: 'snapshot_note',
      args: {
        path: '/s/Home/Soup.md',
        content: '# Soup\n\n- [ ] Buy milk\n',
        source: 'Claude Code',
      },
    })
    expect(docs.writeNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      'old words',
    )
  })

  test('every setting with a row is reached by its name, as the settings file names it', async () => {
    expect(await call('read_setting', { key: 'appearance.accent' })).toMatchObject({
      result: { key: 'appearance.accent', value: 'violet', choices: ['violet', 'blue'] },
    })
    expect(await call('read_setting', { key: 'appearance' })).toMatchObject({
      result: {
        pane: 'appearance',
        settings: [{ key: 'appearance.accent', value: 'violet' }],
      },
    })
    expect(
      await call('write_setting', { key: 'appearance.accent', value: 'orange' }),
    ).toMatchObject({ code: 'bad_arguments' })

    answer = { status: 'ok', result: {} }
    expect(await call('write_setting', { key: 'editor.focusMode', value: true })).toMatchObject({
      result: { key: 'editor.focusMode', value: true, changed: true },
    })
    expect(rows.focus).toBe(true)
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'settings',
    })
    await call('write_setting', { key: 'spelling.languages', value: ['de'] })
    expect([...rows.languages]).toEqual(['de'])
    expect(await call('read_setting', { key: 'spelling.languages' })).toMatchObject({
      result: { value: ['de'] },
    })
  })

  test('a file dialog a command opens is answered by the path, as files would', async () => {
    answer = { status: 'ok', result: { path: '/home/me/out.pdf' } }
    expect(
      await call('run_command', { id: 'export-pdf', path: '~/out.pdf' }, agent()),
    ).toMatchObject({ result: { id: 'export-pdf', path: '~/out.pdf' } })
    expect(asked.find((one) => one.command === 'agents_dialog_path')?.args).toMatchObject({
      path: '~/out.pdf',
      write: true,
    })
    await vi.waitFor(() => expect(ran).toContain('export-pdf:/home/me/out.pdf'))

    answer = { status: 'needs_approval', approval: 'a9', summary: 'Write out.pdf' }
    expect(
      await call('run_command', { id: 'export-pdf', path: '~/out.pdf' }, agent()),
    ).toMatchObject({ status: 'needs_approval' })
    await vi.waitFor(() => expect(ran).toContain('export-pdf:cancelled'))
  })

  test('a setting asks, and a value it cannot be is refused before anybody is asked', async () => {
    expect(await call('write_setting', { key: 'scheme', value: 'purple' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
    expect(await call('read_setting', { key: 'sync_token' })).toMatchObject({
      code: 'no_such_setting',
    })

    answer = { status: 'needs_approval', approval: 'a2', summary: 'Change scheme' }
    expect(await call('write_setting', { key: 'scheme', value: 'dark' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'settings',
    })
  })

  test('the palette: never by hand or the window, publishing asks, moving the reader needs focus', async () => {
    for (const id of ['record', 'new-terminal', 'close-window']) {
      expect(await call('run_command', { id }), id).toMatchObject({ code: 'by_hand' })
    }
    expect(
      await call('run_command', { id: 'space:home' }, agent({ scopes: ['workspace'] })),
    ).toMatchObject({
      code: 'not_granted',
    })

    answer = { status: 'needs_approval', approval: 'a3', summary: 'Publish' }
    expect(await call('run_command', { id: 'publish' })).toMatchObject({ status: 'needs_approval' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'publishing',
    })

    expect(await call('run_command', { id: 'files' })).toMatchObject({ result: { id: 'files' } })
    expect(ran).toEqual(['files'])
  })

  test('the palette: a row needs what the verb behind it needs, and an unknown row is the reader’s', async () => {
    const plain = agent({ scopes: ['workspace'] })
    for (const [id, scope] of [
      ['close-all', 'workspace.focus'],
      ['settings', 'workspace.focus'],
      ['graph', 'workspace.focus'],
      ['reformat', 'notes.write'],
      ['edit.delete-line', 'notes.write'],
      ['undo-file', 'tree'],
    ] as const) {
      ran.length = 0
      expect(await call('run_command', { id }, plain), id).toMatchObject({
        code: 'not_granted',
        message: expect.stringContaining(scope),
      })
      expect(ran, id).toEqual([])
      expect(await call('run_command', { id }), id).toMatchObject({ result: { id } })
    }
    ran.length = 0
    expect(await call('run_command', { id: 'files' }, plain)).toMatchObject({
      result: { id: 'files' },
    })
    expect(await call('run_command', { id: 'row-from-next-year' })).toMatchObject({
      code: 'by_hand',
    })
    answer = { status: 'needs_approval', approval: 'a3', summary: 'Theme' }
    expect(await call('run_command', { id: 'theme:night' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(ran).toEqual(['files'])
    expect(
      await call('run_command', { id: 'row-from-next-year' }, agent({ mode: 'autonomous' })),
    ).toMatchObject({ result: { id: 'row-from-next-year' } })
  })

  test('the palette: a row that makes a file needs to write as well as to move the reader', async () => {
    for (const id of ['new-unique', 'new-canvas', 'new-database']) {
      ran.length = 0
      expect(
        await call('run_command', { id }, agent({ scopes: ['workspace', 'workspace.focus'] })),
        id,
      ).toMatchObject({ code: 'not_granted', message: expect.stringContaining('notes.write') })
      expect(
        await call('run_command', { id }, agent({ scopes: ['workspace', 'notes.write'] })),
        id,
      ).toMatchObject({ code: 'not_granted', message: expect.stringContaining('workspace.focus') })
      expect(ran, id).toEqual([])
      expect(await call('run_command', { id }), id).toMatchObject({ result: { id } })
    }
    for (const id of ['export-pdf', 'copy-uri']) {
      expect(await call('run_command', { id }), id).toMatchObject({ code: 'by_hand' })
    }
  })

  test('in confirm mode every write asks, as a write', async () => {
    answer = { status: 'needs_approval', approval: 'a4', summary: 'Edit' }
    const careful = agent({ mode: 'confirm' })
    expect(
      await call(
        'edit_note',
        { space: 'Home', path: 'Soup', edits: [{ at: { end: true }, insert_after: 'x' }] },
        careful,
      ),
    ).toMatchObject({ status: 'needs_approval' })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'writing',
    })
    expect(docs.editNote).not.toHaveBeenCalled()

    asked.length = 0
    await call('read_note', { space: 'Home', path: 'Soup' }, careful)
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('the terminal: never the command line, and a program off the list asks', async () => {
    expect(await call('run_terminal', { command: 'git status' }, READER)).toMatchObject({
      code: 'by_hand',
    })

    answer = { status: 'needs_approval', approval: 'a5', summary: 'rm' }
    for (const command of ['rm -rf build', 'git status; rm -rf ~']) {
      asked.length = 0
      expect(await call('run_terminal', { command }), command).toMatchObject({
        status: 'needs_approval',
      })
      expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
        category: 'terminal',
        summary: command,
      })
    }
  })
})

describe('the AI sidebar’s two modes that act', () => {
  const changes = (scheme: string): [string, Record<string, unknown>][] => [
    [
      'edit_note',
      { space: 'Home', path: 'Soup', edits: [{ at: { end: true }, insert_after: 'x' }] },
    ],
    ['write_note', { space: 'Home', path: 'Soup', content: '# Soup!\n' }],
    ['append_note', { space: 'Home', path: 'Soup', content: 'More.' }],
    ['set_task', { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true }],
    ['create_note', { space: 'Home', path: 'Stew', content: '# Stew\n' }],
    ['edit_canvas', { space: 'Home', path: 'board.canvas', ops: [{ op: 'add_card', text: 'Hi' }] }],
    ['bookmarks', { space: 'Home', op: 'add', path: 'Recipes.md' }],
    ['move_file', { space: 'Home', path: 'Soup.md', to: 'Food/Soup.md' }],
    ['create_folder', { space: 'Home', path: 'Drinks' }],
    ['trash_file', { space: 'Home', path: 'Recipes.md' }],
    ['restore_version', { space: 'Home', path: 'Soup', version: 'device:1000' }],
    ['write_setting', { key: 'scheme', value: scheme }],
    ['run_command', { id: 'publish' }],
    ['run_terminal', { command: 'rm -rf build' }],
  ]
  const READS: [string, Record<string, unknown>][] = [
    ['read_note', { space: 'Home', path: 'Soup' }],
    ['list_backlinks', { space: 'Home', path: 'Soup' }],
  ]

  test('Agent (autonomous) is never asked anything', async () => {
    const acting = agent({ mode: 'autonomous' })
    for (const [verb, args] of [...changes('dark'), ...READS]) {
      asked.length = 0
      answer = { status: 'needs_approval', approval: 'a9', summary: verb }
      const said = await call(verb, args, acting)
      expect(said, verb).not.toMatchObject({ status: 'needs_approval' })
      expect(
        asked.some((one) => one.command === 'agents_ask'),
        verb,
      ).toBe(false)
    }
  })

  test('Full permissions (autonomous) refuses nothing kept to the reader’s hands (#1072)', async () => {
    const acting = agent({ mode: 'autonomous' })
    expect(await call('workspace_tabs', { op: 'close', tab: 't2' }, acting)).toMatchObject({
      result: { closed: 't2' },
    })
    for (const id of ['close-window', 'new-window']) {
      expect(await call('run_command', { id }, acting), id).not.toMatchObject({ code: 'by_hand' })
    }
    expect(await call('run_command', { id: 'close-window' })).toMatchObject({ code: 'by_hand' })
  })

  test('Approve (confirm) asks before every change and never before a read', async () => {
    const approving = agent({ mode: 'confirm' })
    for (const [verb, args] of changes('light')) {
      asked.length = 0
      answer = { status: 'needs_approval', approval: 'a9', summary: verb }
      expect(await call(verb, args, approving), verb).toMatchObject({ status: 'needs_approval' })
    }
    for (const [verb, args] of READS) {
      asked.length = 0
      await call(verb, args, approving)
      expect(
        asked.some((one) => one.command === 'agents_ask'),
        verb,
      ).toBe(false)
    }
  })
})

describe('the notes, on the road', () => {
  test('a note of a shared space is read as data', async () => {
    expect(await call('read_note', { space: 'Home', path: 'Soup' })).toMatchObject({
      untrusted: 'shared space Home',
    })
    expect(await call('read_note', { path: 'Plan' })).not.toHaveProperty('untrusted')
  })

  test('a note shared on its own is read as data, and so is a listing of its space', async () => {
    othersWrite.add('/s/Work/Plan.md')
    try {
      expect(await call('read_note', { path: 'Plan' })).toMatchObject({
        untrusted: 'shared note Plan.md',
      })
      expect(await call('list_notes', {})).toMatchObject({ untrusted: 'shared space Work' })
      expect(await call('list_versions', { path: 'Plan' })).toMatchObject({
        untrusted: 'shared note Plan.md',
      })
    } finally {
      othersWrite.clear()
    }
  })

  test('a property is one edit of the whole note against the words it was worked out from', async () => {
    await call('set_property', {
      space: 'Home',
      path: 'Soup',
      key: 'tags',
      value: ['food', 'warm'],
    })
    expect(docs.writeNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      '---\ntags: [food, warm]\n---\n# Soup\n\n- [ ] Buy milk\n',
      'r1',
    )
  })

  test('a property given as words is written as those words, not what YAML reads bare', async () => {
    await call('set_property', { space: 'Home', path: 'Soup', key: 'status', value: 'yes' })
    expect(docs.writeNote).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "---\nstatus: 'yes'\n---\n# Soup\n\n- [ ] Buy milk\n",
      'r1',
    )

    await call('set_property', {
      space: 'Home',
      path: 'Soup',
      key: 'tags',
      value: ['012', 'salt, pepper', 3, true],
    })
    expect(docs.writeNote).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "---\ntags: ['012', 'salt, pepper', 3, true]\n---\n# Soup\n\n- [ ] Buy milk\n",
      'r1',
    )
  })

  test('a property key is any name front matter reads back as one, and nothing else', async () => {
    await call('set_property', { space: 'Home', path: 'Soup', key: 'priorität', value: 'Hoch' })
    expect(docs.writeNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      '---\npriorität: Hoch\n---\n# Soup\n\n- [ ] Buy milk\n',
      'r1',
    )
    for (const key of ['a: b', '#tags', '- tags'])
      expect(
        await call('set_property', { space: 'Home', path: 'Soup', key, value: 'x' }),
      ).toMatchObject({ code: 'bad_arguments' })
  })

  test('a task is ticked on its own line', async () => {
    await call('set_task', { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true })
    expect(docs.editNote).toHaveBeenCalledWith(
      { id: 'claude-code', name: 'Claude Code' },
      { path: 'Soup.md', space: 'home' },
      [{ at: { task: 'Buy milk' }, replace: '- [x] Buy milk' }],
      'r1',
    )
  })

  test('an edit says the AI panel thread that asked for it', async () => {
    const asker = callerOf(
      {
        id: 'orden-anthropic',
        name: 'Claude',
        scopes: EVERY,
        spaces: 'all',
        mode: 'unsupervised',
        built_in: true,
        programs: [],
      },
      'thread-1',
    )
    await call(
      'set_task',
      { space: 'Home', path: 'Soup', at: { task: 'Buy milk' }, done: true },
      asker,
    )
    expect(docs.editNote).toHaveBeenCalledWith(
      { id: 'orden-anthropic', name: 'Claude', thread: 'thread-1' },
      { path: 'Soup.md', space: 'home' },
      [{ at: { task: 'Buy milk' }, replace: '- [x] Buy milk' }],
      'r1',
    )
  })

  test('a new note says the space it was made in, the one in front where none was named', async () => {
    expect(await call('create_note', { path: 'Fresh' })).toMatchObject({
      result: { path: 'Fresh.md', created: true, space: 'work' },
    })
    expect(await call('create_note', { path: 'boards/Map.canvas', space: 'home' })).toMatchObject({
      result: { path: 'boards/Map.canvas', created: true, space: 'home' },
    })
  })

  test('a new note is never written over one, and write_note makes one that is not there', async () => {
    expect(await call('create_note', { space: 'Home', path: 'Soup' })).toMatchObject({
      code: 'exists',
    })
    expect(
      await call('write_note', { space: 'Home', path: 'Broth', content: '# Broth\n' }),
    ).toMatchObject({
      result: { path: 'Broth.md', created: true },
    })
    expect(files.get('/s/Home/Broth.md')).toBe('# Broth\n')
  })
})

describe('a page into a note', () => {
  const capture = () => asked.find((one) => one.command === 'agents_capture')?.args
  const saved = () => asked.find((one) => one.command === 'save_asset')?.args

  test('is the markdown the clip button writes, with its source, read by the crate', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-30T10:00:00.000Z'))
    try {
      const answered = await call('capture_to_note', { tab: 'w1', as: 'clip' })
      expect(answered).toMatchObject({
        result: { path: 'A page.md', created: true },
        untrusted: 'https://docs.example/a',
      })

      const { clipNote } = await import('../../web-tab/note')
      const clip = await clipNote(PAGE, new Date())
      expect(files.get('/s/Work/A page.md')).toBe(clip)
      expect(clip).toContain('source: https://docs.example/a')
      expect(capture()).toMatchObject({ agent: 'claude-code', tab: 'w1', shape: 'clip' })
    } finally {
      vi.useRealTimers()
    }
  })

  test('an agent tab is clipped the same way, through the crate', async () => {
    const answered = await call('capture_to_note', { tab: 'a1', as: 'clip', note: 'Research' })
    expect(answered).toMatchObject({ result: { path: 'Research.md', created: true } })
    expect(files.get('/s/Work/Research.md')).toContain('Words of the page.')
    expect(capture()).toMatchObject({ agent: 'claude-code', tab: 'a1', shape: 'clip' })
  })

  test('a screenshot is a picture kept beside the note, the whole page when asked', async () => {
    reads({ html: undefined, png: btoa('PNG bytes') })
    await call('capture_to_note', { tab: 'a1', as: 'screenshot', full_page: true })

    expect(capture()).toMatchObject({ shape: 'screenshot', fullPage: true })
    const kept = saved()
    expect(String(kept?.name)).toMatch(/^page-[\d-]+\.png$/)
    expect([...(kept?.bytes as Uint8Array)]).toEqual([80, 78, 71, 32, 98, 121, 116, 101, 115])
    expect(files.get('/s/Work/A page.md')).toContain(`![[files/${String(kept?.name)}]]`)
  })

  test('a PDF is printed on the reader own paper and kept beside the note', async () => {
    reads({ html: undefined, pdf: btoa('%PDF-1.7') })
    await call('capture_to_note', { tab: 'a1', as: 'pdf' })

    expect(capture()).toMatchObject({
      shape: 'pdf',
      fullPage: false,
      page: { width: 210 / 25.4, height: 297 / 25.4, margin: 0.787, landscape: false },
    })
    expect(String(saved()?.name)).toMatch(/\.pdf$/)
    expect(files.get('/s/Work/A page.md')).toMatch(/!\[\[files\/page-[\d-]+\.pdf\]\]/)
  })

  test('the crate refusal is the answer, code and all, and nothing is written', async () => {
    captured = {
      status: 'error',
      code: 'password_field',
      message: 'a filled secret field is on the page',
    }
    expect(await call('capture_to_note', { tab: 'a1', as: 'pdf' })).toMatchObject({
      ok: false,
      status: 'error',
      code: 'password_field',
      message: 'a filled secret field is on the page',
    })
    expect(saved()).toBeUndefined()
    expect(files.has('/s/Work/A page.md')).toBe(false)

    captured = { status: 'error', code: 'stopped', message: 'the reader pressed the stop' }
    expect(await call('capture_to_note', { tab: 'w1', as: 'clip' })).toMatchObject({
      code: 'stopped',
    })
  })

  test('needs the reader tabs scope for a tab of the reader, and browser for its own', async () => {
    expect(
      await call('capture_to_note', { tab: 'w1', as: 'link' }, agent({ scopes: ['notes.write'] })),
    ).toMatchObject({ code: 'not_granted' })
    expect(
      await call(
        'capture_to_note',
        { tab: 'a1', as: 'clip' },
        agent({ scopes: ['notes.write', 'browser.reader'] }),
      ),
    ).toMatchObject({ code: 'not_granted' })
    expect(capture()).toBeUndefined()
  })

  test('a reader tab in a space the agent may not reach is not there', async () => {
    expect(
      await call(
        'capture_to_note',
        { tab: 'w1', as: 'clip', space: 'Home' },
        agent({ spaces: ['Home'] }),
      ),
    ).toMatchObject({ code: 'no_such_space' })
    expect(capture()).toBeUndefined()
  })

  test('where the engine has no road, a reader tab is clipped the button way and never photographed', async () => {
    captured = {
      status: 'error',
      code: 'unsupported_on_this_engine',
      message: 'capturing a page is not available on this engine yet',
    }
    expect(await call('capture_to_note', { tab: 'w1', as: 'clip' })).toMatchObject({
      result: { path: 'A page.md' },
    })
    expect(files.get('/s/Work/A page.md')).toContain('Words of the page.')

    for (const shape of ['screenshot', 'pdf']) {
      expect(await call('capture_to_note', { tab: 'w1', as: shape }), shape).toMatchObject({
        code: 'unsupported_on_this_engine',
      })
    }
    expect(saved()).toBeUndefined()
  })

  test('a reader page put away is clipped as its address, and not printed', async () => {
    captured = { status: 'error', code: 'no_such_tab', message: 'there is no tab w1' }
    await call('capture_to_note', { tab: 'w1', as: 'clip', note: 'Kept' })
    expect(files.get('/s/Work/Kept.md')).toContain('<https://docs.example/a>')

    expect(await call('capture_to_note', { tab: 'w1', as: 'pdf' })).toMatchObject({
      code: 'failed',
    })
  })

  test('says which shapes there are', async () => {
    expect(await call('capture_to_note', { tab: 'w1', as: 'gif' })).toMatchObject({
      code: 'bad_arguments',
      message: 'as is one of clip, screenshot, pdf, link',
    })
  })
})

describe('the log into a note', () => {
  test('is this agent calls of the day, each with what it touched', async () => {
    log = [
      {
        at: Date.parse('2026-09-30T09:00:01Z'),
        agent: 'claude-code',
        verb: 'read_note',
        args: { path: 'Soup.md' },
        status: 'ok',
      },
      {
        at: Date.parse('2026-09-30T09:00:02Z'),
        agent: 'someone-else',
        verb: 'read_note',
        args: { path: 'Diary.md' },
        status: 'ok',
      },
      {
        at: Date.parse('2026-09-30T09:00:03Z'),
        agent: 'claude-code',
        verb: 'browser_open',
        args: { url: 'https://docs.example/' },
        status: 'error',
        code: 'site_denied',
      },
    ]

    await call('attach_agent_log', { note: 'Session', session: '2026-09-30' })
    expect(files.get('/s/Work/Session.md')).toBe(
      '## Claude Code, 2026-09-30\n\n- 09:00:01 `read_note` [[Soup]]\n- 09:00:03 `browser_open` <https://docs.example/> - error (site_denied)\n',
    )
  })
})

describe('what the crate asks', () => {
  test('the reader web tabs of every space, with their space and whether in front', async () => {
    const away = {
      id: 'w2',
      kind: 'web',
      path: '/s/Home/Bank.url',
      paneId: 'p3',
      shown: 'Bank',
      note: { live: { readerAt: null }, shared: null, home: 'home' },
    }
    tabs.push(away)
    try {
      expect(await answerTheCrate('agent.reader_tabs', {})).toEqual([
        {
          id: 'w1',
          title: 'Docs',
          url: 'https://docs.example/a',
          space: 'Work',
          front: false,
          on_screen: true,
        },
        {
          id: 'w2',
          title: 'Bank',
          url: 'https://docs.example/a',
          space: 'Home',
          front: false,
          on_screen: false,
        },
      ])
    } finally {
      tabs.pop()
    }
  })

  test('a reader web tab lent to an agent, with what its pane would have told its page', async () => {
    expect(await answerTheCrate('agent.lend', { tab: 'w1' })).toBeNull()
    expect(lending.lend).toHaveBeenCalledWith('w1')
    expect(lentPage).toMatchObject({
      url: 'https://docs.example/',
      space: 'work',
      path: '/s/Work/Docs.url',
    })

    lending.lend.mockClear()
    await answerTheCrate('agent.lend', { tab: 't1' })
    await answerTheCrate('agent.lend', { tab: 'gone' })
    expect(lending.lend).not.toHaveBeenCalled()
  })

  test('which store a space keeps a site in, and a page as the clipper words it', async () => {
    expect(
      await answerTheCrate('agent.store_for', { space: 'Home', url: 'https://a.example/' }),
    ).toEqual({
      space: 'Home',
      store: null,
    })
    expect(
      await answerTheCrate('agent.markdown', {
        html: '<h2>Title</h2><p>A <b>bold</b> word.</p>',
        url: 'x',
      }),
    ).toBe('## Title\n\nA **bold** word.')
  })
})

describe('to-dos and bases', () => {
  const written = () => docs.writeNote.mock.calls.map((one) => String(one[2]))

  beforeEach(() => {
    files.set('/s/Home/Soup.md', '# Soup\n\n- [ ] Buy milk #shop\n')
    files.set('/s/Secret/Diary.md', '# Diary\n- [ ] Hidden 📅 2026-01-01\n')
  })

  test('a todo is listed, added into the open space and changed through the model', async () => {
    const { todos } = await import('../../tasks-model/src/api')
    const added = await call('add_task', { text: 'Call mum', deadline: '2026-10-06', priority: 3 })
    expect(added).toMatchObject({
      result: { title: 'Call mum', deadline: '2026-10-06', priority: 3, done: false },
    })
    const id = (added as { result: { id: string } }).result.id
    expect(todos.todo(id)?.space).toBe(work.id)
    const listed = await call('list_tasks', {})
    expect(listed).toMatchObject({ result: { total: 1, todos: [{ id, title: 'Call mum' }] } })
    expect(await call('update_task', { id, done: true, labels: ['family'] })).toMatchObject({
      result: { done: true, labels: ['family'] },
    })
    expect(await call('list_tasks', { space: 'Secret' })).toMatchObject({ code: 'no_such_space' })
    expect(await call('update_task', { id: 'nothing', done: true })).toMatchObject({
      code: 'no_such_file',
    })
    expect(await call('add_task', { text: '   ' })).toMatchObject({ code: 'bad_arguments' })
    expect(docs.writeNote).not.toHaveBeenCalled()
    await todos.remove(id)
  })

  test('calls at once on a note that is not there yet make it once, and the rest add to it', async () => {
    const { madeOrChanged } = await import('./notes')
    const place = { space: home, open: false } as Parameters<typeof madeOrChanged>[0]
    const did: string[] = []
    await Promise.all(
      ['Call mum', 'Buy leeks', 'Water the fern'].map((task) =>
        madeOrChanged(
          place,
          '.Inbox.md',
          async () => {
            did.push(`made ${task}`)
            await Promise.resolve()
            files.set('/s/Home/.Inbox.md', `- [ ] ${task}\n`)
          },
          async () => {
            did.push(`added ${task}`)
            await Promise.resolve()
          },
        ),
      ),
    )
    expect(did).toEqual(['made Call mum', 'added Buy leeks', 'added Water the fern'])
  })

  test('words added at once to a note that is not there yet are all in it', async () => {
    docs.editNote.mockClear()
    await Promise.all(
      ['One.', 'Two.', 'Three.'].map((content) =>
        call('append_note', { space: 'Home', path: 'Day', content }),
      ),
    )
    const added = docs.editNote.mock.calls.map((one) => JSON.stringify((one as unknown[])[2]))
    const wrote = [files.get('/s/Home/Day.md') ?? '', ...added].join('\n')
    for (const one of ['One.', 'Two.', 'Three.']) expect(wrote).toContain(one)
    expect(added).toHaveLength(2)
  })

  test('a base is refused while databases are off, and left as it was', async () => {
    const yaml = 'filters: file.inFolder("Books")\nviews:\n  - type: table\n    name: All\n'
    files.set('/s/Home/Books.base', yaml)
    hiddenKinds.hidden = []
    const off = {
      code: 'not_granted',
      message: expect.stringContaining('databases are turned off'),
    }
    expect(await call('query_base', { space: 'Home', path: 'Books.base' })).toMatchObject(off)
    expect(
      await call('add_row', { space: 'Home', base: 'Books.base', title: 'Emma' }),
    ).toMatchObject(off)
    expect(
      await call('edit_base', {
        space: 'Home',
        path: 'Books.base',
        ops: [{ op: 'add_view', type: 'cards', name: 'Wall' }],
      }),
    ).toMatchObject(off)
    expect(files.get('/s/Home/Books.base')).toBe(yaml)
    expect(files.has('/s/Home/Books/Emma.md')).toBe(false)
    expect(docs.writeNote).not.toHaveBeenCalled()
  })

  test('a base: queried, a row added where it looks, a view added', async () => {
    files.set(
      '/s/Home/Books.base',
      'filters: file.inFolder("Books")\nviews:\n  - type: table\n    name: All\n    order: [file.name]\n',
    )
    files.set('/s/Home/Books/Dune.md', '---\nstatus: reading\n---\n')
    expect(await call('query_base', { space: 'Home', path: 'Books.base' })).toMatchObject({
      result: { total: 1, groups: [{ rows: [{ path: 'Books/Dune.md', 'file.name': 'Dune.md' }] }] },
    })

    expect(
      await call('add_row', {
        space: 'Home',
        base: 'Books.base',
        title: 'Emma',
        properties: { status: 'to read' },
      }),
    ).toMatchObject({ result: { path: 'Books/Emma.md', created: true } })
    expect(files.get('/s/Home/Books/Emma.md')).toBe('---\nstatus: to read\n---\n')

    await call('edit_base', {
      space: 'Home',
      path: 'Books.base',
      ops: [{ op: 'add_view', name: 'Board', type: 'kanban' }],
    })
    expect(files.get('/s/Home/Books.base')).toContain('name: Board')
  })

  test('edits asked at once all land, none written over another', async () => {
    files.set('/s/Home/Books.base', 'views:\n  - type: table\n    name: All\n')
    files.set('/s/Home/board.canvas', '{"nodes":[],"edges":[]}')
    await Promise.all([
      ...['Wall', 'Board', 'Shelf'].map((name) =>
        call('edit_base', {
          space: 'Home',
          path: 'Books.base',
          ops: [{ op: 'add_view', name, type: 'cards' }],
        }),
      ),
      ...['One', 'Two', 'Three'].map((text) =>
        call('edit_canvas', {
          space: 'Home',
          path: 'board.canvas',
          ops: [{ op: 'add_card', text }],
        }),
      ),
      ...['Soup.md', 'Recipes.md'].map((path) =>
        call('bookmarks', { space: 'Home', op: 'add', path }),
      ),
    ])
    expect(marks['/s/Home']?.map((one) => one.path).sort()).toEqual(['Recipes.md', 'Soup.md'])
    for (const name of ['All', 'Wall', 'Board', 'Shelf']) {
      expect(files.get('/s/Home/Books.base')).toContain(`name: ${name}`)
    }
    for (const text of ['One', 'Two', 'Three']) {
      expect(files.get('/s/Home/board.canvas')).toContain(text)
    }
  })

  test('properties on several notes', async () => {
    expect(
      await call('edit_rows', {
        space: 'Home',
        paths: ['Soup.md', 'Recipes'],
        properties: { done: true },
      }),
    ).toMatchObject({ result: { changed: ['Soup.md', 'Recipes.md'] } })
    expect(written()[0]).toBe('---\ndone: true\n---\n# Soup\n\n- [ ] Buy milk #shop\n')
  })

  test('properties stop being set once the reader presses the stop', async () => {
    docs.writeNote.mockImplementationOnce((_agent: unknown, at: { path: string }) => {
      for (const on of heard) on({ kind: 'paused', agent: 'claude-code' })
      return Promise.resolve({ path: at.path, rev: 'r2', edits: 1, lines: [0] })
    })
    docs.writeNote.mockClear()
    expect(
      await call('edit_rows', {
        space: 'Home',
        paths: ['Soup.md', 'Recipes'],
        properties: { done: true },
      }),
    ).toMatchObject({
      status: 'error',
      code: 'stopped',
      message: expect.stringContaining('changed Soup.md') as string,
    })
    expect(docs.writeNote).toHaveBeenCalledTimes(1)
  })

  test('the stop ends a command run_terminal started, its shell killed at once', async () => {
    shell.hangs = true
    const going = call('run_terminal', { command: 'git status', timeout_ms: 600_000 })
    await vi.waitFor(() => expect(asked.some((one) => one.command === 'pty_write')).toBe(true))
    for (const on of heard) on({ kind: 'stopped', agent: null })
    expect(await going).toMatchObject({ status: 'error', code: 'stopped' })
    expect(asked.filter((one) => one.command === 'pty_kill')).toHaveLength(1)
  })

  test('an agent that may only read cannot add one', async () => {
    const { dispatch } = await import('../../automation/verbs')
    const reader = agent({ scopes: ['notes.read'] })
    expect(await dispatch('add_task', { text: 'x' }, [], 'here', reader)).toMatchObject({
      status: 'error',
      code: 'not_granted',
    })
    expect(await dispatch('list_tasks', {}, [], 'here', reader)).toMatchObject({ status: 'ok' })
  })
})

describe('a space shared to be read', () => {
  const before = () => new Map(files)
  const writes = () =>
    asked.filter((one) => ['write_note', 'save_asset', 'snapshot_note'].includes(one.command))

  beforeEach(() => readOnly.add('/s/Home'))

  test('edit_base refuses, and the base keeps its views', async () => {
    files.set('/s/Home/Books.base', 'views:\n  - type: table\n    name: All\n')
    const was = before()
    expect(
      await call('edit_base', {
        space: 'Home',
        path: 'Books.base',
        ops: [{ op: 'add_view', name: 'Board', type: 'kanban' }],
      }),
    ).toMatchObject({ code: 'read_only' })
    expect(files).toEqual(was)
    expect(writes()).toEqual([])
  })

  test('add_row refuses, and no row note is made', async () => {
    files.set(
      '/s/Home/Books.base',
      'filters: file.inFolder("Books")\nviews:\n  - type: table\n    name: All\n',
    )
    const was = before()
    expect(
      await call('add_row', { space: 'Home', base: 'Books.base', title: 'Emma' }),
    ).toMatchObject({ code: 'read_only' })
    expect(files).toEqual(was)
    expect(writes()).toEqual([])
  })

  test('capture_to_note refuses before the picture is kept, new note or old', async () => {
    reads({ html: undefined, png: btoa('PNG bytes') })
    const was = before()
    expect(
      await call('capture_to_note', { space: 'Home', tab: 'a1', as: 'screenshot' }),
    ).toMatchObject({ code: 'read_only' })
    expect(
      await call('capture_to_note', { space: 'Home', tab: 'a1', as: 'clip', note: 'Soup' }),
    ).toMatchObject({ code: 'read_only' })
    expect(files).toEqual(was)
    expect(writes()).toEqual([])
    expect(docs.editNote).not.toHaveBeenCalled()
  })

  test('attach_agent_log refuses, new note or old', async () => {
    log = [
      {
        at: Date.parse('2026-09-30T09:00:01Z'),
        agent: 'claude-code',
        verb: 'read_note',
        args: { path: 'Soup.md' },
        status: 'ok',
      },
    ]
    const was = before()
    for (const note of ['Session', 'Soup']) {
      expect(
        await call('attach_agent_log', { space: 'Home', note, session: '2026-09-30' }),
        note,
      ).toMatchObject({ code: 'read_only' })
    }
    expect(files).toEqual(was)
    expect(writes()).toEqual([])
    expect(docs.editNote).not.toHaveBeenCalled()
  })

  test('restore_version refuses, closed note or open', async () => {
    readOnly.add('/s/Work')
    const was = before()
    for (const [space, path] of [
      ['Home', 'Soup'],
      ['Work', 'Plan'],
    ]) {
      expect(
        await call('restore_version', { space, path, version: 'device:1000' }),
        path,
      ).toMatchObject({ code: 'read_only' })
    }
    expect(files).toEqual(was)
    expect(writes()).toEqual([])
    expect(docs.writeNote).not.toHaveBeenCalled()
  })
})

describe('a tab and a space named together', () => {
  const verbs: [string, Record<string, unknown>][] = [
    ['read_note', {}],
    ['write_note', { content: '# Over\n' }],
    ['edit_note', { edits: [{ at: { end: true }, insert_after: 'x' }] }],
    ['append_note', { content: 'x' }],
    ['set_property', { key: 'status', value: 'done' }],
    ['set_task', { at: { task: 'Buy milk' }, done: true }],
  ]

  test.each(verbs)('%s refuses a space that is not the tab’s own', async (verb, args) => {
    files.set('/s/Home/Plan.md', '# Home plan, kept\n')
    expect(await call(verb, { ...args, space: 'Home', tab: 't1' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(files.get('/s/Home/Plan.md')).toBe('# Home plan, kept\n')
    expect(files.get('/s/Work/Plan.md')).toBe('# Plan\n')
    for (const verb of [docs.readNote, docs.writeNote, docs.editNote]) {
      expect(verb).not.toHaveBeenCalled()
    }
  })

  test('the tab’s own space, named, is the tab’s note', async () => {
    await call('write_note', { space: 'Work', tab: 't1', content: '# Over\n' })
    expect(docs.writeNote.mock.calls.at(-1)?.[1]).toEqual({ path: 'Plan.md', space: 'work' })
    expect(files.has('/s/Home/Plan.md')).toBe(false)
  })
})

describe('a note an agent names with a dot in it', () => {
  test('a capture into a name with digits after a dot makes that name a markdown note', async () => {
    expect(
      await call('capture_to_note', { tab: 'a1', as: 'clip', note: 'Meeting 10.27' }),
    ).toMatchObject({ result: { path: 'Meeting 10.27.md', created: true } })
    expect(files.get('/s/Work/Meeting 10.27.md')).toContain('Words of the page.')
    expect(files.has('/s/Work/Meeting 10.27')).toBe(false)
  })

  test('a capture into a canvas is refused before any picture is kept', async () => {
    reads({ html: undefined, png: btoa('PNG bytes') })
    expect(
      await call('capture_to_note', { tab: 'a1', as: 'screenshot', note: 'Board.canvas' }),
    ).toMatchObject({ code: 'bad_arguments' })
    expect(files.has('/s/Work/Board.canvas')).toBe(false)
    expect(asked.some((one) => one.command === 'save_asset')).toBe(false)
  })

  test('the log of a session goes into a note, never a canvas', async () => {
    expect(
      await call('attach_agent_log', { note: 'Board.canvas', session: '2026-09-30' }),
    ).toMatchObject({ code: 'bad_arguments' })
    expect(files.has('/s/Work/Board.canvas')).toBe(false)
  })

  test('the note verbs read the same name as the capture does', async () => {
    expect(await call('create_note', { path: 'Reading 2026.10', content: '# R\n' })).toMatchObject({
      result: { path: 'Reading 2026.10.md', created: true },
    })
    expect(await call('read_note', { path: 'Reading 2026.10' })).toMatchObject({
      result: { path: 'Reading 2026.10.md' },
    })
  })
})

describe('a panel thread works in its own space', () => {
  const fromHome = () =>
    callerOf(
      {
        id: 'orden-anthropic',
        name: 'Claude',
        scopes: EVERY,
        spaces: 'all',
        mode: 'unsupervised',
        built_in: true,
      },
      'thread-home',
    )

  beforeEach(() => {
    answerThreadSpaces((thread) => (thread === 'thread-home' ? 'home' : null))
  })

  test('a note named without a space is the thread’s space’s', async () => {
    files.set('/s/Work/Soup.md', '# Work soup\n')
    expect(await call('read_note', { path: 'Soup' }, fromHome())).toMatchObject({
      result: { space: 'home', text: expect.stringContaining('- [ ] Buy milk') },
    })
    await call('write_note', { path: 'Broth', content: '# Broth\n' }, fromHome())
    expect(files.get('/s/Home/Broth.md')).toBe('# Broth\n')
    expect(files.has('/s/Work/Broth.md')).toBe(false)
    expect(await call('create_note', { path: 'Fresh' }, fromHome())).toMatchObject({
      result: { path: 'Fresh.md', created: true, space: 'home' },
    })
  })

  test('a space it names still wins', async () => {
    await call('write_note', { space: 'Work', path: 'Broth', content: '# Broth\n' }, fromHome())
    expect(files.get('/s/Work/Broth.md')).toBe('# Broth\n')
  })

  test('a tab in front is still the tab’s own note', async () => {
    await call('write_note', { tab: 't1', content: '# Over\n' }, fromHome())
    expect(docs.writeNote.mock.calls.at(-1)?.[1]).toEqual({ path: 'Plan.md', space: 'work' })
  })

  test('a thread nobody knows, or no thread, is the space in front', async () => {
    await call('write_note', { path: 'Broth', content: '# Broth\n' })
    expect(files.get('/s/Work/Broth.md')).toBe('# Broth\n')
  })

  describe('a tab of the space in front, named by its id', () => {
    const away = [
      { ...tabs[0], id: 'c9', kind: 'canvas', path: '/s/Work/board.canvas', shown: 'board' },
      { ...tabs[0], id: 'p9', kind: 'pdf', path: '/s/Work/paper.pdf', shown: 'paper' },
    ] as (typeof tabs)[number][]

    beforeEach(() => {
      tabs.push(...away)
      files.set('/s/Work/board.canvas', '{"nodes":[],"edges":[]}')
      return () => void tabs.splice(tabs.length - away.length, away.length)
    })

    test('a canvas is read and edited in the tab’s space', async () => {
      expect(await call('read_canvas', { tab: 'c9' }, fromHome())).toMatchObject({ ok: true })
      await call('edit_canvas', { tab: 'c9', ops: [{ op: 'add_card', text: 'Hi' }] }, fromHome())
      expect(files.get('/s/Work/board.canvas')).toContain('Hi')
      expect(files.get('/s/Home/board.canvas')).not.toContain('Hi')
    })

    test('a PDF is read from the tab’s space', async () => {
      openDocument.mockClear()
      await call('read_pdf', { tab: 'p9' }, fromHome())
      expect(openDocument).toHaveBeenCalledWith('/s/Work/paper.pdf')
    })

    test('a file tab renamed is the tab’s file renamed', async () => {
      expect(
        await call('workspace_tabs', { op: 'rename', tab: 't1', name: 'Roadmap' }, fromHome()),
      ).toMatchObject({ result: { from: 'Plan.md', to: 'Roadmap.md', space: 'work' } })
      expect(workspace.rename).toHaveBeenCalledWith('/s/Work/Plan.md', 'Roadmap.md')
    })
  })

  test('the context says the thread’s space, and the space each tab is in', async () => {
    expect(await call('get_context', {}, fromHome())).toMatchObject({
      result: {
        space: 'Home',
        selected: { id: 't1', path: 'Plan.md', space: 'Work' },
        tabs: [{ id: 't1', space: 'Work' }, { id: 't2', space: 'Work' }, { id: 'w1' }],
      },
    })
    const reader = (await call('get_context', {})) as { result: { selected: object } }
    expect(reader.result.selected).not.toHaveProperty('space')
  })

  test('the context of a grant that reaches the thread’s space alone names it, and no tab', async () => {
    const onlyHome = callerOf(
      {
        id: 'orden-x',
        name: 'X',
        scopes: EVERY,
        spaces: ['Home'],
        mode: 'unsupervised',
        built_in: true,
      },
      'thread-home',
    )
    expect(await call('get_context', {}, onlyHome)).toMatchObject({
      result: { space: 'Home', selected: null, tabs: [] },
    })
  })

  test('a page captured goes to the thread’s space, and the answer says so', async () => {
    const answered = await call(
      'capture_to_note',
      { tab: 'w1', as: 'clip', note: 'Kept' },
      fromHome(),
    )
    expect(answered).toMatchObject({ result: { path: 'Kept.md', space: 'home' } })
    expect(files.has('/s/Home/Kept.md')).toBe(true)
  })

  test('a thread whose space is gone from this device is refused, not sent to the front', async () => {
    answerThreadSpaces(() => 'left-long-ago')
    expect(await call('write_note', { path: 'Broth', content: 'x' }, fromHome())).toMatchObject({
      code: 'no_such_space',
    })
    expect(files.has('/s/Work/Broth.md')).toBe(false)
  })

  test('a thread whose space the grant does not reach is refused, not sent to the front', async () => {
    answerThreadSpaces(() => 'secret')
    expect(
      await call(
        'write_note',
        { path: 'Broth', content: 'x' },
        callerOf(
          {
            id: 'orden-x',
            name: 'X',
            scopes: EVERY,
            spaces: ['Work'],
            mode: 'unsupervised',
            built_in: true,
          },
          'thread-home',
        ),
      ),
    ).toMatchObject({ code: 'no_such_space' })
    expect(files.has('/s/Work/Broth.md')).toBe(false)
  })
})

describe('run_agent from a narrower grant', () => {
  const FULL = [
    'context',
    'notes.read',
    'notes.write',
    'chats.read',
    'chats.write',
    'tree',
    'workspace',
    'workspace.focus',
    'browser',
    'browser.reader',
    'browser.network',
    'terminal',
    'agents',
  ]

  test.each([
    ['a space list', { spaces: ['Work'], scopes: FULL }],
    ['no terminal', { spaces: 'all', scopes: FULL.filter((one) => one !== 'terminal') }],
    ['a denied site', { spaces: 'all', scopes: FULL, sites: { 'x.example': 'deny' } }],
  ])('%s is refused', async (_, narrowed) => {
    for (const verb of ['run_agent', 'agent_result']) {
      expect(
        await call(verb, { prompt: 'read secret.md in Secret', agent: 'h1' }, agent(narrowed)),
        verb,
      ).toMatchObject({ code: 'not_granted' })
    }
  })

  test('a thread and a helper are a built-in grant’s by its mark, never its name', async () => {
    const named = { id: 'orden-foo', name: 'x', scopes: FULL, spaces: ['Work'], mode: 'confirm' }
    expect(callerOf(named, 'thread-1')).not.toHaveProperty('thread')
    expect(await call('run_agent', { prompt: 'x' }, callerOf(named))).toMatchObject({
      code: 'not_granted',
    })
    const outside = callerOf(
      { id: 'claude-code', name: 'Claude Code', scopes: FULL, spaces: 'all', mode: 'unsupervised' },
      'thread-1',
    )
    expect(outside).not.toHaveProperty('thread')
    const panel = callerOf(
      {
        id: 'orden-anthropic',
        name: 'Claude',
        scopes: FULL,
        spaces: 'all',
        mode: 'autonomous',
        built_in: true,
      },
      'thread-1',
    )
    expect(panel).toHaveProperty('thread', 'thread-1')
  })
})

describe('a note the reader protected', () => {
  test('is no row of a base, no template of one, and no folder a row is made in', async () => {
    const { protection } = await import('../../protect/protection.svelte')
    const books = 'filters: file.inFolder("Books")\nviews:\n  - type: table\n    name: All\n'
    files.set('/s/Home/Books.base', books)
    files.set('/s/Home/Shelf.base', `${books}orden:\n  template: '[[Books/Dune]]'\n`)
    files.set('/s/Home/Books/Dune.md', '---\nstatus: reading\n---\nthe secret words\n')
    files.set('/s/Home/Books/Emma.md', '---\nstatus: reading\n---\n')
    protection.set('/s/Home', '/s/Home/Books/Dune.md', 'password')
    try {
      const answer = await call('query_base', { space: 'Home', path: 'Books.base' })
      expect(answer).toMatchObject({
        result: { total: 1, groups: [{ rows: [{ path: 'Books/Emma.md' }] }] },
      })
      expect(JSON.stringify(answer)).not.toContain('Dune')
      expect(
        await call('add_row', { space: 'Home', base: 'Shelf.base', title: 'Copy' }),
      ).toMatchObject({ code: 'protected' })
      protection.set('/s/Home', '/s/Home/Books', 'password')
      expect(
        await call('add_row', { space: 'Home', base: 'Books.base', title: 'Inside' }),
      ).toMatchObject({ code: 'protected' })
      expect(await call('query_base', { space: 'Home', path: 'Books.base' })).toMatchObject({
        result: { total: 0 },
      })
      expect(docs.writeNote).not.toHaveBeenCalled()
    } finally {
      protection.set('/s/Home', '/s/Home/Books/Dune.md', null)
      protection.set('/s/Home', '/s/Home/Books', null)
    }
  })

  test('lends no line of its own as a backlink, in this space or another', async () => {
    const { protection } = await import('../../protect/protection.svelte')
    files.set('/s/Home/Soup.md', '# Soup\n')
    files.set('/s/Home/Recipes.md', '# Recipes\n\nSee [[Soup]] tonight.\n')
    expect(await call('list_backlinks', { space: 'Home', path: 'Soup' })).toMatchObject({
      result: [{ path: 'Recipes.md' }],
    })
    protection.set('/s/Home', '/s/Home/Recipes.md', 'password')
    try {
      expect(await call('list_backlinks', { space: 'Home', path: 'Soup' })).toMatchObject({
        result: [],
      })
    } finally {
      protection.set('/s/Home', '/s/Home/Recipes.md', null)
    }
  })

  test('is refused to an agent until it is unlocked and agents are let read it', async () => {
    const { protection } = await import('../../protect/protection.svelte')
    const { unlocks } = await import('../../protect/unlocked.svelte')
    protection.set('/s/Home', '/s/Home/Soup.md', 'password')
    try {
      expect(await call('read_note', { space: 'Home', path: 'Soup' })).toMatchObject({
        code: 'protected',
      })
      const locks = protection.covering('/s/Home/Soup.md')
      unlocks.unlock(locks)
      expect(await call('read_note', { space: 'Home', path: 'Soup' })).toMatchObject({
        code: 'protected',
      })
      unlocks.letAgents(locks, true)
      expect(await call('read_note', { space: 'Home', path: 'Soup' })).not.toHaveProperty('error')
    } finally {
      protection.set('/s/Home', '/s/Home/Soup.md', null)
      unlocks.lockAll()
    }
  })
})
