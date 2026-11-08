import { beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf, type Caller } from '../../automation/caller'

vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const work = { id: 'work', name: 'Work', root: '/s/Work' }

interface FakeTab {
  id: string
  kind: string
  path: string | null
  paneId: string
  shown: string
  doc: string
  page?: number
  note: {
    kind: string
    path: string | null
    shared: string | null
    home: string | null
    name: string
    live: { readerAt: number | null }
  }
}

function tab(id: string, kind: string, path: string | null, more: Partial<FakeTab> = {}): FakeTab {
  return {
    id,
    kind,
    path,
    paneId: 'p1',
    shown: id,
    doc: '',
    note: { kind, path, shared: null, home: 'work', name: 'Untitled', live: { readerAt: null } },
    ...more,
  }
}

let tabs: FakeTab[] = []
const showing: Record<string, string> = {}

const workspace = {
  spaces: [work],
  activeSpaceId: 'work',
  activeSpace: work,
  get tabs() {
    return tabs
  },
  activeTabId: 'n1',
  previewTabId: null as string | null,
  panes: {
    focusedId: 'p1',
    frame: {
      kind: 'split',
      id: 's1',
      along: 'row',
      fraction: 0.3,
      sides: [
        { kind: 'pane', id: 'p1', activeTabId: null, linked: false, stacked: false },
        { kind: 'pane', id: 'p2', activeTabId: null, linked: false, stacked: false },
      ],
    },
    at: (id: string) => (['p1', 'p2'].includes(id) ? { id } : null),
    equalise: vi.fn(),
  },
  moveTab: vi.fn((id: string, pane: string) => {
    const one = tabs.find((tab) => tab.id === id)
    if (one) one.paneId = pane
  }),
  get active() {
    return tabs.find((one) => one.id === this.activeTabId) ?? null
  },
  get tree() {
    return {
      name: 'Work',
      path: '/s/Work',
      is_dir: true,
      modified: 0,
      created: 0,
      children: [
        {
          name: 'Plan.md',
          path: '/s/Work/Plan.md',
          is_dir: false,
          modified: 1,
          created: 1,
          children: [],
        },
      ],
    }
  },
  outside: (path: string) => !path.startsWith('/s/Work/'),
  showing: (pane: string) => tabs.find((one) => one.id === showing[pane]) ?? null,
  spaceOf: (note: { home: string | null }) => note.home,
  webAddressOf: () => null,
  documentAt: () => null,
  noteText: (path: string) => Promise.resolve(path === '/s/Work/Plan.md' ? '# Plan\n' : null),
  openUnsaved: vi.fn(
    (kind: string, _text: string, _name?: string, _beside?: string | null, _activate?: boolean) => {
      const made = tab(`new-${kind}`, kind, null)
      tabs.push(made)
      return made
    },
  ),
  openPage: vi.fn((url: string) => {
    const made = tab('web-new', 'web', null)
    tabs.push(made)
    return url ? made.id : null
  }),
  openGraph: vi.fn(),
  open: vi.fn(() => Promise.resolve()),
  openEntry: vi.fn(() => Promise.resolve()),
  save: vi.fn((_tab: FakeTab, folder: string, file: string) =>
    Promise.resolve(`${folder}/${file}`),
  ),
  rename: vi.fn(() => Promise.resolve()),
  moveMany: vi.fn(() => Promise.resolve()),
  activate: vi.fn(),
  close: vi.fn(),
  split: vi.fn(),
  showSpace: vi.fn(),
  loadTree: vi.fn(() => Promise.resolve()),
  scheduleSession: vi.fn(),
}

vi.mock('../../workspace.svelte', () => ({ workspace }))

let answer: Record<string, unknown> = { status: 'ok', result: {} }
const asked: { command: string; args: Record<string, unknown> }[] = []
const others = new Set(['/s/Work/Report.pages.pdf'])

vi.mock('../../tauri', async (original) => ({
  ...(await original<typeof import('../../tauri')>()),
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    asked.push({ command, args })
    if (command === 'path_exists') return Promise.resolve(others.has(String(args.path)))
    return Promise.resolve(command === 'agents_ask' ? answer : null)
  },
}))

let readOnly = false
vi.mock('../../sharing.svelte', () => ({
  isShared: () => false,
  reachedByOthers: (path: string | null) => path !== null && othersWrite.has(path),
  reachedAs: (path: string | null) => (path !== null && othersWrite.has(path) ? 'space' : null),
  reachedByOthersIn: () => false,
  canWriteAt: () => !readOnly,
}))
const othersWrite = new Set<string>()
vi.mock('../../web-tab/pages.svelte', () => ({ pages: { addressOf: () => null } }))
vi.mock('../../views.svelte', () => ({ views: { of: () => null } }))
vi.mock('../../sync.svelte', () => ({ sync: { nudge: () => undefined } }))
vi.mock('../../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../../modes.svelte', () => ({ modes: { pagesPaper: 'a4' } }))
const settings = { show: vi.fn() }
vi.mock('../../settings.svelte', () => ({ settings }))

const openDocument = vi.fn((_path: string) => Promise.reject(new Error('no PDF here')))
vi.mock('../../pdf/document', () => ({ openDocument }))

const trash = {
  error: null as string | null,
  items: [
    {
      id: 'device:1',
      ref: '1',
      kind: 'note',
      name: 'Old.md',
      detail: 'Work/archive',
      deletedAt: 5,
      purgeAt: 9,
      source: 'device',
    },
    {
      id: 'note:2',
      ref: '2',
      kind: 'note',
      name: 'Diary.md',
      detail: 'Secret',
      deletedAt: 4,
      purgeAt: 9,
      source: 'account',
    },
  ],
  load: vi.fn(() => Promise.resolve()),
  restore: vi.fn((_item: unknown) => Promise.resolve()),
  restorable: vi.fn((_item: unknown) => true),
}
vi.mock('../../trash.svelte', () => ({ trash }))

const showPad = vi.fn()
vi.mock('../../scratchpad/pad', () => ({
  scratchpad: { where: () => Promise.resolve('/app/Scratchpad.md'), show: showPad },
}))

const docs = {
  readNote: vi.fn((at: { path: string; tab?: string }) =>
    Promise.resolve({ path: at.path, rev: 'r1', text: 'words' }),
  ),
  writeNote: vi.fn((_agent: unknown, at: { path: string; tab?: string }) =>
    Promise.resolve({ path: at.path, rev: 'r2' }),
  ),
  editNote: vi.fn(() => Promise.resolve({ rev: 'r2' })),
}
vi.mock('../docs', async () => ({ ...(await import('../docs/problem')), notes: docs }))

const card = { id: 'card-1', type: 'text', text: 'Idea', x: 0, y: 0, width: 200, height: 60 }
const drawn = {
  picked: ['card-1'],
  canvas: { nodes: [card], edges: [], ink: [] },
  edit: vi.fn(),
}
vi.mock('../../canvas/store.svelte', () => ({
  CanvasStore: { drawing: (note: unknown) => (note === tabs[2]?.note ? drawn : null) },
}))

vi.mock('../../terminal/shells.svelte', () => ({
  shells: {
    ask: () =>
      Promise.resolve([
        { id: 'pwsh', name: 'PowerShell' },
        { id: 'bash', name: 'Git Bash' },
      ]),
    chosen: { id: 'pwsh', name: 'PowerShell' },
  },
}))

const openTerminal = vi.fn((shell: string, _where: unknown) => {
  const made = tab(`term-${shell}`, 'terminal', null)
  tabs.push(made)
  return Promise.resolve(made)
})
vi.mock('../../terminal/open', () => ({ openTerminal }))

const renameTerminal = vi.fn((_tab: unknown, _name: string) => Promise.resolve())
vi.mock('../../terminal/rename', () => ({ renameTerminal }))

const running = new Set<string>()
vi.mock('../../terminal/running', () => ({
  shellRunning: (id: string) => running.has(id),
}))

vi.mock('../../terminal/history', () => ({
  historyOf: () =>
    Promise.resolve({ cols: 80, rows: 24, at: 7, text: '\x1b[32mbuilt\x1b[0m\r\nok\r\n' }),
}))

const screen = {
  rows: ['PS C:\\> git status', 'On branch main', ''],
  typed: [] as string[],
}
const term = {
  get buffer() {
    return {
      active: {
        type: 'normal',
        baseY: 0,
        cursorY: screen.rows.length - 1,
        length: screen.rows.length,
        getLine: (at: number) => {
          const row = screen.rows[at]
          return row === undefined ? undefined : { isWrapped: false, translateToString: () => row }
        },
      },
    }
  },
  modes: { applicationCursorKeysMode: false },
  getSelection: () => 'On branch',
  input: (data: string) => {
    screen.typed.push(data)
    screen.rows.splice(screen.rows.length - 1, 0, `> ${data.trim()}`, 'done')
  },
  onWriteParsed: () => ({ dispose: () => undefined }),
}
const online = {
  blocked: null as { why: string; lasting: boolean } | null,
  held: false,
  taken: 0,
  ended: false,
  again: 0,
}
vi.mock('../../terminal/sessions.svelte', () => ({
  sessionOf: (tab: { id: string; path: string | null; doc: string }) => {
    const isOnline = tab.path?.endsWith('.term') === true || tab.doc.startsWith('{"v":1')
    return {
      term: {
        ...term,
        input: (data: string) => {
          if (isOnline && online.blocked) online.taken += 1
          else term.input(data)
        },
      },
      host: { isConnected: true },
      online: isOnline,
      current: isOnline ? online.blocked === null : running.has(tab.id),
      agentHeld: isOnline && online.held,
      ended: isOnline && online.ended,
      startAgain: () => {
        online.again += 1
        online.ended = false
        online.blocked = null
        running.add(tab.id)
      },
      agentBlocked: () =>
        isOnline
          ? online.blocked
          : running.has(tab.id)
            ? null
            : { why: 'its shell is not running', lasting: false },
      agentTyped: (data: string) => {
        if (isOnline && online.blocked) return online.blocked.why
        term.input(data)
        return null
      },
    }
  },
}))

const account = { accountToken: 'token' as string | null }
vi.mock('../../account.svelte', async (original) => {
  const real = await original<typeof import('../../account.svelte')>()
  Object.defineProperty(real.account, 'accountToken', { get: () => account.accountToken })
  return real
})
const machine = {
  known: null as unknown,
  refused: null as string | null,
  refresh: vi.fn(() => Promise.resolve()),
}
vi.mock('../../online/machine.svelte', () => ({ machine }))
const session = { createdAt: 1, space: 'work', trashed: false, title: null, alive: null, at: 2 }
const listed = vi.fn(() =>
  Promise.resolve([
    { ...session, term: 'f1', session: 's_build', path: 'Build.term', program: 'node' },
    { ...session, term: null, session: 's_new', path: null, program: null, alive: true },
  ]),
)
vi.mock('../../online/calls', () => ({ listed }))
vi.mock('../../sync2/runner.svelte', () => ({
  runner: { fileOf: (id: string) => (id === 'f1' ? '/s/Work/Build.term' : null) },
}))
let making: string | null = null
const madeOnline = vi.fn((_beside: string | null, _activate: boolean) => {
  if (making) return Promise.resolve(making)
  const made = tab('online-new', 'terminal', null, {
    shown: 'Terminal',
    doc: '{"v":1,"machine":"m_1","session":"s_new"}\n',
  })
  tabs.push(made)
  return Promise.resolve(made)
})
vi.mock('../../online/open', () => ({ madeOnline }))

const { runAgentVerb } = await import('./index')

const EVERY = ['context', 'notes.read', 'notes.write', 'tree', 'workspace', 'terminal']

function agent(scopes: string[] = EVERY, change: Record<string, unknown> = {}): Caller {
  return callerOf({
    id: 'claude-code',
    name: 'Claude Code',
    scopes,
    spaces: 'all',
    mode: 'unsupervised',
    programs: ['git'],
    sites: { 'bank.example': 'deny' },
    ...change,
  })
}

function call(verb: string, args: Record<string, unknown>, caller: Caller = agent()) {
  return runAgentVerb(verb, args, caller)
}

const focusing = [...EVERY, 'workspace.focus']

beforeEach(() => {
  tabs = [
    tab('n1', 'note', '/s/Work/Plan.md', { shown: 'Plan' }),
    tab('d1', 'note', null, { shown: 'Draft' }),
    tab('c1', 'canvas', null, { paneId: 'p2' }),
    tab('t1', 'terminal', null, {
      shown: 'PowerShell',
      doc: JSON.stringify({ shell: 'pwsh', folder: null, key: 'k1' }),
    }),
    tab('s1', 'note', '/s/Work/Pinned.md', { shown: 'Pinned' }),
  ]
  online.blocked = null
  online.held = false
  online.taken = 0
  online.ended = false
  online.again = 0
  account.accountToken = 'token'
  machine.known = { allowed: true, machine: { id: 'm_1', state: 'awake', held: false } }
  machine.refused = null
  making = null
  showing.p1 = 'n1'
  showing.p2 = 'c1'
  workspace.activeTabId = 'n1'
  workspace.previewTabId = 'd1'
  running.clear()
  screen.rows = ['PS C:\\> git status', 'On branch main', '']
  screen.typed = []
  answer = { status: 'ok', result: {} }
  asked.length = 0
  vi.clearAllMocks()
})

describe('where the reader is', () => {
  test('every tab, of every kind, with its pane and its state', async () => {
    const said = (await call('get_context', {})) as { result: Record<string, unknown> }
    expect(said.result).toMatchObject({
      space: 'Work',
      selected: { id: 'n1', kind: 'note', path: 'Plan.md', selected: true, front: true },
      tabs: [
        { id: 'n1', pane: 'p1', front: true },
        { id: 'd1', unsaved: true, preview: true, front: false },
        { id: 'c1', kind: 'canvas', unsaved: true, pane: 'p2', front: true, selected: false },
        { id: 't1', kind: 'terminal', running: false },
        { id: 's1', path: 'Pinned.md' },
      ],
    })
  })

  test("a tab of another space gives no path, rather than this machine's whole one", async () => {
    const outside = workspace.outside
    workspace.outside = (path: string) => !/^\/s\/(Work|Home)\//.test(path)
    tabs.push(tab('h1', 'note', '/s/Home/Todo.md', { shown: 'Todo' }))
    try {
      const said = (await call('get_context', {})) as { result: { tabs: { id: string }[] } }
      expect(said.result.tabs.find((one) => one.id === 'h1')).not.toHaveProperty('path')
    } finally {
      workspace.outside = outside
    }
  })

  test('the selection is the selected tab kind', async () => {
    workspace.activeTabId = 'c1'
    expect(await call('get_context', {})).toMatchObject({
      result: { selection: { picked: ['card-1'] } },
    })

    workspace.activeTabId = 't1'
    running.add('t1')
    expect(await call('get_context', {})).toMatchObject({
      result: { selection: { running: true, selected: 'On branch' } },
      untrusted: 'tab titles and terminal output',
    })
  })

  test('a long terminal selection is cut like a note selection', async () => {
    workspace.activeTabId = 't1'
    running.add('t1')
    const was = term.getSelection
    term.getSelection = () => 'x'.repeat(5000 * 200)
    try {
      const said = (await call('get_context', {})) as {
        result: { selection: { selected: string; truncated?: boolean } }
      }
      expect(said.result.selection.selected).toHaveLength(20_000)
      expect(said.result.selection.truncated).toBe(true)
    } finally {
      term.getSelection = was
    }
  })

  test('a note shared with the reader, in front, is read as data', async () => {
    const theirs = tab('theirs', 'note', null, { shown: 'Their plan' })
    theirs.note.shared = 'item-1'
    tabs.push(theirs)
    workspace.activeTabId = 'theirs'
    expect(await call('get_context', {})).toMatchObject({ untrusted: 'note shared with you' })
  })

  test('a tab of a shared space, in front of the reader’s own, is read as data', async () => {
    tabs.push(tab('team', 'note', '/s/Team/Plan.md', { shown: 'Plan' }))
    workspace.activeTabId = 'team'
    othersWrite.add('/s/Team/Plan.md')
    try {
      expect(await call('get_context', {})).toMatchObject({ untrusted: 'shared note Plan.md' })
    } finally {
      othersWrite.clear()
    }
  })
})

describe('a tab of every kind, made behind the reader', () => {
  test('a note with words, a canvas, a page note: behind, beside the selected tab', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'note', content: 'Hello' }),
    ).toMatchObject({ result: { id: 'new-note', unsaved: true } })
    expect(workspace.openUnsaved).toHaveBeenLastCalledWith('note', '', undefined, 'n1', false)
    expect(docs.writeNote).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Claude Code' }),
      { path: '', tab: 'new-note' },
      'Hello',
    )

    await call('workspace_tabs', { op: 'new', kind: 'canvas' })
    expect(workspace.openUnsaved.mock.lastCall?.slice(0, 1)).toEqual(['canvas'])
    await call('workspace_tabs', { op: 'new', kind: 'pages' })
    expect(workspace.openUnsaved.mock.lastCall?.[0]).toBe('pages')
    expect(workspace.openUnsaved.mock.lastCall?.[4]).toBe(false)
    expect(workspace.activate).not.toHaveBeenCalled()
  })

  test('in front only with workspace.focus', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'note', background: false }),
    ).toMatchObject({ code: 'not_granted' })
    expect(workspace.openUnsaved).not.toHaveBeenCalled()

    await call('workspace_tabs', { op: 'new', kind: 'note', background: false }, agent(focusing))
    expect(workspace.openUnsaved).toHaveBeenLastCalledWith('note', '', undefined, null, true)
  })

  test('a denied site by another spelling is denied all the same (#1078)', async () => {
    for (const url of [
      'https://login.bank.example./',
      'https://LOGIN.Bank.Example/',
      'https://bank.example.:443/x',
    ]) {
      expect(await call('workspace_tabs', { op: 'new', kind: 'web', url }), url).toMatchObject({
        code: 'site_denied',
      })
    }
    expect(workspace.openPage).not.toHaveBeenCalled()
  })

  test('a web tab on its page, never a denied site or something not on the web', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'https://docs.example/' }),
    ).toMatchObject({ result: { id: 'web-new' } })
    expect(workspace.openPage).toHaveBeenCalledWith('https://docs.example/', 'behind')

    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'https://login.bank.example/' }),
    ).toMatchObject({ code: 'site_denied' })
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'web', url: 'file:///C:/secret.txt' }),
    ).toMatchObject({ code: 'bad_arguments' })
    expect(workspace.openPage).toHaveBeenCalledTimes(1)
  })

  test('a terminal in the shell and folder asked for, behind', async () => {
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'terminal', shell: 'git bash', cwd: 'src' }),
    ).toMatchObject({ result: { id: 'term-bash', kind: 'terminal' } })
    expect(openTerminal).toHaveBeenCalledWith('bash', {
      folder: '/s/Work/src',
      beside: 'n1',
      activate: false,
    })

    expect(
      await call('workspace_tabs', { op: 'new', kind: 'terminal', shell: 'fish' }),
    ).toMatchObject({ code: 'bad_arguments', message: expect.stringContaining('Git Bash') })
  })

  test('in confirm mode, a new tab asks first', async () => {
    answer = { status: 'needs_approval', approval: 'a1', summary: 'A new note tab' }
    expect(
      await call('workspace_tabs', { op: 'new' }, agent(EVERY, { mode: 'confirm' })),
    ).toMatchObject({ status: 'needs_approval' })
    expect(workspace.openUnsaved).not.toHaveBeenCalled()
  })
})

describe('opening', () => {
  test('a page behind; the graph only in front; the scratchpad behind', async () => {
    await call('workspace_tabs', { op: 'open', url: 'https://docs.example/a' })
    expect(workspace.openPage).toHaveBeenCalledWith('https://docs.example/a', 'behind')

    expect(await call('workspace_tabs', { op: 'open', view: 'graph' })).toMatchObject({
      code: 'not_granted',
    })
    await call('workspace_tabs', { op: 'open', view: 'graph' }, agent(focusing))
    expect(workspace.openGraph).toHaveBeenCalled()

    expect(await call('workspace_tabs', { op: 'open', view: 'scratchpad' })).toMatchObject({
      result: { scratchpad: true },
    })
    expect(showPad).toHaveBeenCalledWith(null, false)
    expect(workspace.open).not.toHaveBeenCalled()
  })
})

describe('naming and saving', () => {
  test('a file tab renamed is the file renamed, through the one rename', async () => {
    expect(
      await call('workspace_tabs', { op: 'rename', tab: 'n1', name: 'Roadmap' }),
    ).toMatchObject({ result: { from: 'Plan.md', to: 'Roadmap.md' } })
    expect(workspace.rename).toHaveBeenCalledWith('/s/Work/Plan.md', 'Roadmap.md')
  })

  test('an unsaved tab renamed keeps no file and takes the name', async () => {
    expect(await call('workspace_tabs', { op: 'rename', tab: 'd1', name: 'Ideas' })).toMatchObject({
      result: { id: 'd1' },
    })
    expect(tabs[1]?.note.name).toBe('Ideas')
    await call('workspace_tabs', { op: 'rename', tab: 't1', name: 'Server' })
    expect(renameTerminal).toHaveBeenCalledWith(tabs[3], 'Server')
    expect(await call('workspace_tabs', { op: 'rename', tab: 'd1', name: 'a/b' })).toMatchObject({
      code: 'bad_arguments',
    })
  })

  test('an unsaved tab saved at a path, under its kind ending', async () => {
    expect(
      await call('workspace_tabs', { op: 'save', tab: 'c1', path: 'boards/Map' }),
    ).toMatchObject({ result: { path: 'boards/Map.canvas' } })
    expect(workspace.save).toHaveBeenCalledWith(tabs[2], '/s/Work/boards', 'Map.canvas')

    expect(await call('workspace_tabs', { op: 'save', tab: 'n1', path: 'x' })).toMatchObject({
      code: 'exists',
    })
  })

  test('an unsaved tab is not saved into a space shared to be read', async () => {
    readOnly = true
    try {
      expect(
        await call('workspace_tabs', { op: 'save', tab: 'c1', path: 'boards/Map' }),
      ).toMatchObject({ code: 'read_only' })
      expect(workspace.save).not.toHaveBeenCalled()
    } finally {
      readOnly = false
    }
  })
})

describe('a file of every kind', () => {
  const written = () =>
    Object.fromEntries(
      asked
        .filter((one) => one.command === 'write_note')
        .map((one) => [String(one.args.path), String(one.args.content)]),
    )

  test('a canvas, a page note and a web note, by ending or by kind', async () => {
    expect(await call('create_note', { path: 'boards/Map.canvas' })).toMatchObject({
      result: { path: 'boards/Map.canvas', created: true },
    })
    expect(await call('create_note', { path: 'Lecture', kind: 'pages' })).toMatchObject({
      result: { path: 'Lecture.pages' },
    })
    expect(
      await call('create_note', { path: 'Docs', kind: 'web', url: 'https://docs.example/' }),
    ).toMatchObject({ result: { path: 'Docs.url' } })

    const files = written()
    expect(JSON.parse(files['/s/Work/boards/Map.canvas'] ?? '')).toMatchObject({ nodes: [] })
    expect(JSON.parse(files['/s/Work/Lecture.pages'] ?? '').nodes).toHaveLength(1)
    expect(files['/s/Work/Docs.url']).toContain('URL=https://docs.example/')
  })

  test('never over a file, never a web note with no address', async () => {
    expect(await call('create_note', { path: 'Plan.md' })).toMatchObject({ code: 'exists' })
    expect(await call('create_note', { path: 'Docs.url' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('create_note', { path: 'x', kind: 'sheet' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(written()).toEqual({})
  })

  test('never a page note beside a PDF it would take for its paper', async () => {
    expect(await call('create_note', { path: 'Report', kind: 'pages' })).toMatchObject({
      code: 'exists',
    })
    expect(written()).toEqual({})
  })
})

describe('a note and a canvas, by their tab', () => {
  test('a file tab is read as its path; a draft by the tab', async () => {
    await call('read_note', { tab: 'n1' })
    expect(docs.readNote).toHaveBeenLastCalledWith({ path: 'Plan.md', space: 'work' }, undefined)

    await call('read_note', { tab: 'd1' })
    expect(docs.readNote).toHaveBeenLastCalledWith(
      { path: '', space: 'work', tab: 'd1' },
      undefined,
    )

    expect(await call('read_note', { tab: 'c1' })).toMatchObject({ code: 'bad_arguments' })
    expect(await call('read_note', { tab: 'nope' })).toMatchObject({ code: 'no_such_tab' })
  })

  test('the scratchpad is a note by its name, and never a tab', async () => {
    await call('read_note', { tab: 'scratchpad' })
    expect(docs.readNote).toHaveBeenLastCalledWith(
      { path: 'Scratchpad.md', space: 'work', tab: 'scratchpad' },
      undefined,
    )

    await call('write_note', { tab: 'scratchpad', content: 'jotted' })
    expect(docs.writeNote).toHaveBeenLastCalledWith(
      expect.anything(),
      { path: 'Scratchpad.md', space: 'work', tab: 'scratchpad' },
      'jotted',
      undefined,
    )
    expect(workspace.open).not.toHaveBeenCalled()
  })

  test('a path and a tab that name two notes are refused, and one note named twice is read', async () => {
    docs.readNote.mockClear()
    for (const tab of ['scratchpad', 'n1', 'd1']) {
      expect(await call('read_note', { path: 'Inbox.md', tab })).toMatchObject({
        code: 'bad_arguments',
        message: expect.stringContaining('name different notes'),
      })
    }
    expect(docs.readNote).not.toHaveBeenCalled()

    await call('read_note', { path: 'Plan.md', tab: 'n1' })
    expect(docs.readNote).toHaveBeenLastCalledWith({ path: 'Plan.md', space: 'work' }, undefined)
    await call('read_note', { path: 'Plan', tab: 'n1' })
    expect(docs.readNote).toHaveBeenLastCalledWith({ path: 'Plan.md', space: 'work' }, undefined)
  })

  test('a canvas drawn and never saved is read and edited by its tab, on the surface', async () => {
    expect(await call('read_canvas', { tab: 'c1' })).toMatchObject({
      result: { path: '', nodes: [card], ink: 0 },
    })

    expect(
      await call('edit_canvas', {
        tab: 'c1',
        ops: [{ op: 'edit_text', id: 'card-1', text: 'Plan' }],
      }),
    ).toMatchObject({ result: { path: '' } })
    expect(drawn.edit).toHaveBeenCalledWith(
      expect.objectContaining({ nodes: [expect.objectContaining({ text: 'Plan' })] }),
    )
  })
})

describe('a PDF, Settings and Recently deleted', () => {
  test('a PDF read by its tab is its file', async () => {
    tabs.push(tab('pdf1', 'pdf', '/s/Work/paper.pdf'))
    expect(await call('read_pdf', { tab: 'pdf1' })).toMatchObject({ code: 'failed' })
    expect(openDocument).toHaveBeenCalledWith('/s/Work/paper.pdf')
    expect(await call('read_pdf', { tab: 'n1' })).toMatchObject({ code: 'bad_arguments' })
  })

  test('Settings opens at a section, only with workspace.focus', async () => {
    expect(await call('workspace_tabs', { op: 'open', view: 'settings' })).toMatchObject({
      code: 'not_granted',
    })
    expect(
      await call(
        'workspace_tabs',
        { op: 'open', view: 'settings', section: 'ai' },
        agent(focusing),
      ),
    ).toMatchObject({ result: { settings: 'ai' } })
    expect(settings.show).toHaveBeenCalledWith('ai')
    expect(
      await call(
        'workspace_tabs',
        { op: 'open', view: 'settings', section: 'nope' },
        agent(focusing),
      ),
    ).toMatchObject({ code: 'bad_arguments' })
  })

  test('the list as far as the grant reaches, and one thing put back', async () => {
    const only = agent(EVERY, { spaces: ['Work'] })
    expect(await call('recently_deleted', { op: 'list' }, only)).toMatchObject({
      result: [{ id: 'device:1', name: 'Old.md', from: 'Work/archive' }],
    })
    expect(await call('recently_deleted', { op: 'restore', id: 'note:2' }, only)).toMatchObject({
      code: 'not_found',
    })
    expect(trash.restore).not.toHaveBeenCalled()

    expect(await call('recently_deleted', { op: 'restore', id: 'device:1' }, only)).toMatchObject({
      result: { restored: true, from: 'Work/archive' },
    })
    expect(trash.restore).toHaveBeenCalledWith(trash.items[0])
  })

  test('nothing is put back into a space shared to be read', async () => {
    trash.restorable.mockReturnValueOnce(false)
    trash.restore.mockClear()

    const only = agent(EVERY, { spaces: ['Work'] })
    expect(await call('recently_deleted', { op: 'restore', id: 'device:1' }, only)).toMatchObject({
      code: 'read_only',
    })
    expect(trash.restore).not.toHaveBeenCalled()
  })
})

describe('tabs moved and panes arranged (#1078)', () => {
  test('a tab goes to a pane by its id or toward a side, only when asked for', async () => {
    expect(await call('workspace_tabs', { op: 'move', tab: 'n1', pane: 'p2' })).toMatchObject({
      code: 'not_granted',
    })
    expect(workspace.moveTab).not.toHaveBeenCalled()

    await call('workspace_tabs', { op: 'move', tab: 'n1', pane: 'p2', at: 0 }, agent(focusing))
    expect(workspace.moveTab).toHaveBeenLastCalledWith('n1', 'p2', 0)
    await call('workspace_tabs', { op: 'move', tab: 'c1', toward: 'left' }, agent(focusing))
    expect(workspace.moveTab).toHaveBeenLastCalledWith('c1', 'p1', null)
    expect(
      await call('workspace_tabs', { op: 'move', tab: 'n1', toward: 'up' }, agent(focusing)),
    ).toMatchObject({ code: 'bad_arguments' })
    expect(
      await call('workspace_tabs', { op: 'move', tab: 'n1', pane: 'p9' }, agent(focusing)),
    ).toMatchObject({ code: 'bad_arguments' })
  })

  test('the panes split, made even or gathered into one', async () => {
    await call('workspace_tabs', { op: 'arrange', layout: 'rows', tab: 'n1' }, agent(focusing))
    expect(workspace.split).toHaveBeenLastCalledWith('column', 'n1')
    await call('workspace_tabs', { op: 'arrange', layout: 'even' }, agent(focusing))
    expect(workspace.panes.equalise).toHaveBeenCalledWith('p1')
    await call('workspace_tabs', { op: 'arrange', layout: 'single' }, agent(focusing))
    expect(workspace.moveTab).toHaveBeenCalledWith('c1', 'p1')
    expect(
      await call('workspace_tabs', { op: 'arrange', layout: 'grid' }, agent(focusing)),
    ).toMatchObject({ code: 'bad_arguments' })
  })
})

describe('the reader terminals', () => {
  const withOnline = () =>
    tabs.push(tab('o1', 'terminal', '/s/Work/Build.term', { shown: 'Build', doc: '' }))

  test('read: the screen as lines once running, the lines it came back with before', async () => {
    expect(await call('read_terminal', { tab: 't1' })).toMatchObject({
      result: { tab: 't1', running: false, output: 'built\nok', restored: 7 },
      untrusted: 'terminal output',
    })

    running.add('t1')
    expect(await call('read_terminal', { tab: 't1', lines: 1 })).toMatchObject({
      result: { running: true, output: 'On branch main', truncated: true },
    })
    expect(await call('read_terminal', { tab: 'n1' })).toMatchObject({ code: 'bad_arguments' })
  })

  test('type: an allowed program with Enter goes, and answers what it printed', async () => {
    running.add('t1')
    const said = await call('type_terminal', { tab: 't1', text: 'git log', wait_ms: 1 })
    expect(screen.typed).toEqual(['git log\r'])
    expect(said).toMatchObject({
      result: { typed: 'git log + Enter' },
      untrusted: 'terminal output',
    })
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('type: anything else asks, and Ctrl+C alone does not', async () => {
    running.add('t1')
    answer = { status: 'needs_approval', approval: 'a2', summary: 'rm' }
    expect(await call('type_terminal', { tab: 't1', text: 'rm -rf build' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(asked.find((one) => one.command === 'agents_ask')?.args).toMatchObject({
      category: 'terminal',
    })
    expect(screen.typed).toEqual([])

    answer = { status: 'ok', result: {} }
    asked.length = 0
    await call('type_terminal', { tab: 't1', keys: ['Ctrl+C'], wait_ms: 1 })
    expect(screen.typed).toEqual(['\x03'])
    expect(asked.some((one) => one.command === 'agents_ask')).toBe(false)
  })

  test('an online terminal is read and typed into as a local one is (#1125)', async () => {
    withOnline()
    running.add('o1')
    expect(await call('read_terminal', { tab: 'o1', lines: 1 })).toMatchObject({
      result: { tab: 'o1', running: true, output: 'On branch main', truncated: true },
      untrusted: 'terminal output',
    })
    const said = await call('type_terminal', { tab: 'o1', text: 'git log', wait_ms: 1 })
    expect(screen.typed).toEqual(['git log\r'])
    expect(said).toMatchObject({ result: { tab: 'o1', typed: 'git log + Enter' } })

    answer = { status: 'needs_approval', approval: 'a3', summary: 'rm' }
    expect(await call('type_terminal', { tab: 'o1', text: 'rm -rf build' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(screen.typed).toEqual(['git log\r'])
  })

  test('run_terminal in a tab runs there, a local terminal and an online one alike', async () => {
    withOnline()
    running.add('t1')
    running.add('o1')
    for (const tab of ['t1', 'o1']) {
      expect(
        await call('run_terminal', { tab, command: 'git status', timeout_ms: 1 }),
      ).toMatchObject({
        result: { tab, typed: 'git status + Enter' },
        untrusted: 'terminal output',
      })
    }
    expect(screen.typed).toEqual(['git status\r', 'git status\r'])

    answer = { status: 'needs_approval', approval: 'a4', summary: 'rm' }
    expect(await call('run_terminal', { tab: 'o1', command: 'rm -rf build' })).toMatchObject({
      status: 'needs_approval',
    })
    expect(screen.typed).toHaveLength(2)
  })

  test('an online terminal another device holds is never taken over by an agent', async () => {
    withOnline()
    online.blocked = { why: 'Laptop holds this session', lasting: true }
    online.held = true
    expect(await call('type_terminal', { tab: 'o1', text: 'git log' })).toMatchObject({
      code: 'by_hand',
    })
    expect(online.taken).toBe(0)
    expect(screen.typed).toEqual([])
    expect(await call('read_terminal', { tab: 'o1' })).toMatchObject({
      result: { tab: 'o1', last_screen: true },
    })
  })

  test('an online terminal kept to its owner is read, never typed in', async () => {
    withOnline()
    online.blocked = { why: "its machine's owner keeps typing in it to themselves", lasting: true }
    expect(await call('type_terminal', { tab: 'o1', text: 'git log' })).toMatchObject({
      code: 'not_granted',
    })
    expect(screen.typed).toEqual([])
  })

  test('an online terminal whose shell ended starts a new one, as Enter would', async () => {
    withOnline()
    online.ended = true
    online.blocked = { why: 'its shell ended', lasting: false }
    await call('type_terminal', { tab: 'o1', text: 'git log', wait_ms: 1 })
    expect(online.again).toBe(1)
    expect(online.taken).toBe(0)
    expect(screen.typed).toEqual(['git log\r'])
  })

  test('the tab list says an online terminal runs while its session is live', async () => {
    withOnline()
    running.add('o1')
    const listed = await call('workspace_tabs', { op: 'list' })
    expect(listed).toMatchObject({
      result: expect.arrayContaining([expect.objectContaining({ id: 'o1', running: true })]),
    })
  })

  test('an agent opens an online terminal, behind, and types into and reads it (#1125)', async () => {
    expect(await call('workspace_tabs', { op: 'new', kind: 'online' })).toMatchObject({
      result: { id: 'online-new', kind: 'terminal', online: true, running: false },
    })
    expect(madeOnline).toHaveBeenCalledWith('n1', false)

    expect(
      await call('type_terminal', { tab: 'online-new', text: 'git log', wait_ms: 1 }),
    ).toMatchObject({ result: { tab: 'online-new', typed: 'git log + Enter' } })
    expect(screen.typed).toEqual(['git log\r'])
    expect(await call('read_terminal', { tab: 'online-new' })).toMatchObject({
      result: { tab: 'online-new', output: expect.stringContaining('git log') },
      untrusted: 'terminal output',
    })
    expect(online.taken).toBe(0)
  })

  test('opening an online terminal asks as opening any tab does, and in front only with focus', async () => {
    answer = { status: 'needs_approval', approval: 'a5', summary: 'A new online tab' }
    expect(
      await call(
        'workspace_tabs',
        { op: 'new', kind: 'online' },
        agent(EVERY, { mode: 'confirm' }),
      ),
    ).toMatchObject({ status: 'needs_approval' })
    expect(madeOnline).not.toHaveBeenCalled()

    answer = { status: 'ok', result: {} }
    expect(
      await call('workspace_tabs', { op: 'new', kind: 'online', background: false }),
    ).toMatchObject({ code: 'not_granted' })
    await call('workspace_tabs', { op: 'new', kind: 'online', background: false }, agent(focusing))
    expect(madeOnline).toHaveBeenCalledWith(null, true)
  })

  test('an online terminal the account will not make is refused with why', async () => {
    for (const [why, code] of [
      ['signed-out', 'not_granted'],
      ['list', 'not_granted'],
      ['sessions', 'failed'],
      ['other', 'failed'],
    ] as const) {
      making = why
      expect(await call('workspace_tabs', { op: 'new', kind: 'online' }), why).toMatchObject({
        code,
        message: expect.stringContaining(`${why}:`),
      })
    }
    expect(tabs.some((one) => one.id === 'online-new')).toBe(false)
  })

  test('the online machine is listed with its sessions, and the tab or file each opens in', async () => {
    tabs.push(
      tab('o1', 'terminal', null, {
        shown: 'Shell',
        doc: '{"v":1,"machine":"m_1","session":"s_new"}\n',
      }),
    )
    expect(await call('workspace_tabs', { op: 'list', kind: 'online' })).toMatchObject({
      result: {
        allowed: true,
        machine: { id: 'm_1', state: 'awake', held: false },
        sessions: [
          { session: 's_build', name: 'node', space: 'work', path: 'Build.term' },
          { session: 's_new', name: 'Terminal', alive: true, tab: 'o1' },
        ],
      },
      untrusted: 'tab titles and terminal output',
    })

    const elsewhere = agent(EVERY, { spaces: ['Other'] })
    workspace.activeSpace = { id: 'other', name: 'Other', root: '/s/Other' }
    workspace.spaces.push(workspace.activeSpace)
    try {
      const said = await call('workspace_tabs', { op: 'list', kind: 'online' }, elsewhere)
      expect(said).toMatchObject({ result: { sessions: [{ session: 's_new' }] } })
      expect((said as { result: { sessions: unknown[] } }).result.sessions).toHaveLength(1)
    } finally {
      workspace.spaces.pop()
      workspace.activeSpace = work
    }
  })

  test('no machine yet, not allowed, signed out: the list says so or refuses with why', async () => {
    machine.known = { allowed: true, machine: null }
    expect(await call('workspace_tabs', { op: 'list', kind: 'online' })).toMatchObject({
      result: { allowed: true, machine: null, sessions: [] },
    })
    expect(listed).not.toHaveBeenCalled()

    machine.known = { allowed: false, machine: null }
    expect(await call('workspace_tabs', { op: 'list', kind: 'online' })).toMatchObject({
      result: { allowed: false, machine: null, sessions: [] },
    })

    machine.refused = 'off'
    expect(await call('workspace_tabs', { op: 'list', kind: 'online' })).toMatchObject({
      code: 'failed',
      message: expect.stringContaining('off:'),
    })

    account.accountToken = null
    expect(await call('workspace_tabs', { op: 'list', kind: 'online' })).toMatchObject({
      code: 'not_granted',
    })
  })

  test('type: one line, known keys, and never the command line', async () => {
    expect(await call('type_terminal', { tab: 't1', text: 'a\nb' })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(await call('type_terminal', { tab: 't1', keys: ['F13'] })).toMatchObject({
      code: 'bad_arguments',
    })
    expect(
      await runAgentVerb('type_terminal', { tab: 't1', text: 'ls' }, { agent: null }),
    ).toMatchObject({ code: 'by_hand' })
  })
})
