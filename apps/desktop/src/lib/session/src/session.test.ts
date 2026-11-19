import { afterEach, describe, expect, test, vi } from 'vitest'
import { pane } from '../../panes/src/api'
import {
  type Draft,
  frameDraft,
  frameOf,
  type FrameDraft,
  type Layout,
  panesOf,
  readClosed,
  readDraft,
  readLayout,
  readPosition,
  readSession,
  type Session,
  withoutText,
  writeSession,
} from './session'

const spaceless = { spaces: [], activeSpace: null }

describe('reading a session that was written down', () => {
  test('brings back the spaces, the strip and where each note was', () => {
    const session = readSession({
      spaces: [{ id: 's', name: 'Notes', root: '/Notes' }],
      activeSpace: 's',
      panel: 'tree',
      active: 1,
      tabs: [
        { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false, cursor: 4, scroll: 20 },
        { path: null, name: 'Untitled', doc: '# draft', dirty: true, cursor: 0, scroll: 0 },
      ],
      positions: { '/Notes/a.md': { cursor: 4, scroll: 20, anchor: 2, at: 7 } },
    })

    expect(session?.spaces).toHaveLength(1)
    expect(session?.tabs?.map((tab) => tab.name)).toEqual(['a.md', 'Untitled'])
    expect(session?.active).toBe(1)
    expect(session?.positions?.['/Notes/a.md']).toEqual({ cursor: 4, scroll: 20, anchor: 2, at: 7 })
  })

  test('answers nothing for an entry that is not one', () => {
    for (const entry of [null, '{}', []]) expect(readSession(entry)).toBeNull()
  })

  test('keeps the notes an entry does hold when a field is unreadable', () => {
    const session = readSession({
      spaces: [{ id: 's', name: 'Notes', root: '/Notes' }, { id: 'broken' }],
      activeSpace: 12,
      panel: 'nowhere',
      tabs: [
        { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false },
        { name: 42, doc: '' },
      ],
      positions: { '/Notes/a.md': { cursor: 'four', scroll: 0 } },
    })

    expect(session).toMatchObject({ activeSpace: null, panel: null, positions: {} })
    expect(session?.spaces.map((space) => space.id)).toEqual(['s'])
    expect(session?.tabs?.map((tab) => tab.name)).toEqual(['a.md'])
  })

  test('still reads the open paths an older version wrote', () => {
    const session = readSession({
      ...spaceless,
      panel: null,
      openPaths: ['/Notes/a.md', '/Notes/b.md'],
      activePath: '/Notes/b.md',
    })

    expect(session).toMatchObject({
      openPaths: ['/Notes/a.md', '/Notes/b.md'],
      activePath: '/Notes/b.md',
    })
    expect(session?.tabs).toBeUndefined()
  })

  test('brings back both sides: what is on the right, what it showed last, what it knew', () => {
    const session = readSession({
      ...spaceless,
      panel: 'tree',
      right: ['ask', 'nowhere', 'ask', 'outline'],
      rightPanel: 'outline',
      lastRight: 'ask',
      known: ['tree', 'ask', 'somewhere'],
    })

    expect(session).toMatchObject({
      right: ['ask', 'outline'],
      rightPanel: 'outline',
      lastRight: 'ask',
      known: ['tree', 'ask'],
    })
  })
})

describe('reading one tab', () => {
  const plain = (extra: Record<string, unknown> = {}) => readDraft({ path: null, name: 'a', doc: '', ...extra })
  const web = (extra: Record<string, unknown>) => readDraft({ kind: 'web', path: null, name: 'a', doc: '', ...extra })

  test('needs a name and some text to be a tab at all', () => {
    expect(plain()).toMatchObject({ name: 'a', cursor: 0, scroll: 0 })
    expect(plain()).not.toHaveProperty('anchor')
    expect(readDraft({ path: null, doc: '' })).toBeNull()
    expect(plain({ path: 7 })).toBeNull()
  })

  test('a builtin view takes its name from the app, not from the session it was written in', () => {
    const view = (name: string, doc: string) => readDraft({ kind: 'view', path: null, name, doc })
    expect(view('Tasks', '{"builtin":"todos"}')).toMatchObject({ name: 'Todos' })
    expect(view('Mine', '{"tag":"x"}')).toMatchObject({ name: 'Mine' })
  })

  test.each(['reading', 'source'])('brings back %s only when it was written as a flag', (flag) => {
    expect(plain({ [flag]: true })).toMatchObject({ [flag]: true })
    expect(plain()).not.toHaveProperty(flag)
    expect(plain({ [flag]: 'yes' })).not.toHaveProperty(flag)
  })

  test('brings back whether it showed the markdown as written, either way', () => {
    expect(plain({ source: false })).toMatchObject({ source: false })
  })

  test.each([
    ['apart', '3f9a0c17e2b4d685'],
    ['behind', '/s/Finance/Bank.url'],
  ])('keeps the %s of a tab with no file, which a tab with one has no need of', (field, value) => {
    expect(web({ [field]: value })).toMatchObject({ [field]: value })
    expect(web({ path: '/s/a.url', [field]: value })).not.toHaveProperty(field)
  })

  const kindOf = (path: string, kind: unknown) => readDraft({ kind, path, name: path.slice(7), doc: '' })?.kind

  test.each([
    ['/Notes/Board.canvas', [undefined, 'note', 'pdf', 'graph', 'nonsense', 7], 'canvas'],
    ['/Notes/plan.md', ['canvas'], 'note'],
    ['/Notes/Svelte docs.url', [undefined, 'note', 'canvas', 'nonsense'], 'web'],
    ['/Notes/Safari page.webloc', ['note'], 'web'],
    ['/Notes/paper.pdf', ['pdf'], 'pdf'],
  ])('reads %s as what its name says, whatever the entry claims', (path, claims, kind) => {
    for (const claimed of claims) expect(kindOf(path, claimed), String(claimed)).toBe(kind)
  })

  test('leaves a tab no file names alone, which is the graph', () => {
    expect(readDraft({ kind: 'graph', path: null, name: 'Graph', doc: '' })?.kind).toBe('graph')
  })

  test('brings a terminal back as a terminal, with its shell and its folder', () => {
    const doc = '{"shell":"pwsh","folder":"/home/me/code","key":"k1"}'
    const back = readDraft({ kind: 'terminal', path: null, name: 'PowerShell', doc })

    expect(back).toMatchObject({ kind: 'terminal', path: null, name: 'PowerShell', doc })
  })

  test('brings a tab with no file back in the space it was opened in', () => {
    expect(web({ space: 'w' })).toMatchObject({ space: 'w' })
    expect(web({ space: 'w', path: '/Notes/Site.url' })).not.toHaveProperty('space')
    expect(web({ space: 7 })).not.toHaveProperty('space')
  })
})

describe('reading a closed tab', () => {
  const untitled = { path: null, name: 'Untitled', doc: '# draft' }

  test('brings back the tab, its pane and its place', () => {
    const back = readClosed({
      draft: { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false },
      paneId: 'left',
      at: 3,
    })

    expect(back).toMatchObject({ draft: { name: 'a.md' }, paneId: 'left', at: 3 })
  })

  test('fills in a pane and a place that were never written', () => {
    expect(readClosed({ draft: untitled })).toMatchObject({ paneId: '', at: 0 })
    expect(readClosed({ draft: untitled, at: -2 })?.at).toBe(0)
  })

  test('brings back where its words were put in Recently deleted', () => {
    expect(readClosed({ draft: untitled, trashed: 't1' })?.trashed).toBe('t1')
    expect(readClosed({ draft: untitled, trashed: 1 })).not.toHaveProperty('trashed')
  })

  test.each([{ paneId: 'left', at: 0 }, { draft: { name: 42 } }, null])(
    'is nothing at all without a tab in it: %j',
    (entry) => expect(readClosed(entry)).toBeNull(),
  )
})

describe('reading one place', () => {
  const folded = (folds: unknown) => readPosition({ cursor: 1, scroll: 2, folds })?.folds

  test('needs both a caret and a scroll', () => {
    expect(readPosition({ cursor: 1, scroll: 2 })).toEqual({ cursor: 1, scroll: 2, at: 0 })
    expect(readPosition({ cursor: 1 })).toBeNull()
    expect(readPosition({ cursor: Number.NaN, scroll: 2 })).toBeNull()
  })

  test('keeps the good folds and drops only the bad ones', () => {
    expect(folded([[1, 9]])).toEqual([[1, 9]])
    expect(
      folded([
        [1, 9],
        [7, 2],
      ]),
    ).toEqual([[1, 9]])
  })

  test.each([[[[0, 4]]], [[[4, 4]]], [[[9, 3]]], [[[1, 2, 3]]], [[[1, '4']]], ['all']])(
    'drops a fold that names nothing a note could have: %j',
    (folds) => expect(folded(folds)).toBeUndefined(),
  )
})

const draft = (path: string | null, doc: string, share?: string): Draft => ({
  kind: 'note',
  path,
  name: 'a.md',
  doc,
  dirty: true,
  cursor: 0,
  scroll: 0,
  ...(share ? { share } : {}),
})

const onePane = (tabs: Draft[], id = 'p1', more = {}): FrameDraft => ({
  kind: 'pane',
  pane: { id, tabs, active: 0, linked: false, ...more },
})

const split = (sides: unknown[]) => ({
  kind: 'split',
  id: 's1',
  along: 'row',
  fraction: 0.5,
  sides,
})

const panesRead = (value: unknown) => panesOf(readLayout(value)?.frame ?? onePane([]))

const both = { focused: 'p1', panel: null }

describe('reading an arrangement of panes', () => {
  test('brings back the panes, their strips and which one had the focus', () => {
    const value = {
      focused: 'p2',
      panel: 'tree',
      frame: split([onePane([draft('/Notes/a.md', '')]), onePane([draft('/Notes/b.md', '')], 'p2', { linked: true })]),
    }

    expect(readLayout(value)).toMatchObject({
      focused: 'p2',
      panel: 'tree',
      frame: { kind: 'split' },
    })
    expect(panesRead(value).map((one) => [one.id, one.linked])).toEqual([
      ['p1', false],
      ['p2', true],
    ])
  })

  test('fills in a direction and a share of the room that were never written', () => {
    const frame = readLayout({
      frame: { kind: 'split', sides: [onePane([]), onePane([], 'p2')] },
    })?.frame

    expect(frame).toMatchObject({ along: 'row', fraction: 0.5 })
    expect(frame?.kind === 'split' && frame.id.length).toBeGreaterThan(0)
  })

  test('reads a split that lost a side as the side it still has', () => {
    expect(readLayout({ frame: split([onePane([]), null]) })?.frame.kind).toBe('pane')
  })

  test('answers nothing for an arrangement with no panes in it', () => {
    expect(readLayout({ focused: 'p1' })).toBeNull()
    expect(readLayout(null)).toBeNull()
  })

  test('takes the sidebar from the arrangement rather than from beside it', () => {
    const layout = { focused: 'p1', panel: 'outline', frame: onePane([]) }
    expect(readSession({ ...spaceless, panel: 'search', layout })?.panel).toBe('outline')
  })
})

describe('an arrangement, there and back', () => {
  test('keeps the tree, the tabs and the share of the room', () => {
    const second = pane('p2', 't2')
    second.linked = true

    const written = frameDraft(
      {
        kind: 'split',
        id: 's1',
        along: 'column',
        fraction: 0.3,
        sides: [pane('p1', 't1'), second],
      },
      (one) => ({ tabs: [draft(`/Notes/${one.id}.md`, '')], active: 0 }),
    )

    expect(frameOf(written, (one) => (one.id === 'p2' ? 't2' : 't1'))).toMatchObject({
      along: 'column',
      fraction: 0.3,
      sides: [{}, { linked: true, activeTabId: 't2' }],
    })
  })
})

describe('an arrangement kept under a name', () => {
  test('holds no words for a note that lives on disk', () => {
    const layout: Layout = {
      ...both,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    }

    expect(panesOf(withoutText(layout).frame)[0]?.tabs).toMatchObject([
      { path: '/Notes/a.md', doc: '', dirty: false },
      { path: null, doc: '# nowhere else', dirty: true },
    ])
  })

  test('says which tabs were views of one note', () => {
    const shared = panesRead({
      focused: 'p1',
      frame: split([onePane([draft('/Notes/a.md', '', 'd1')]), onePane([draft('/Notes/a.md', '', 'd1')], 'p2')]),
    })

    expect(shared.map((one) => one.tabs[0]?.share)).toEqual(['d1', 'd1'])
  })
})

describe('writing the session down', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const session = (): Session => ({
    ...spaceless,
    panel: null,
    closed: [{ draft: draft('/Notes/gone.md', '# closed'), paneId: 'p1', at: 0 }],
    layout: {
      ...both,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    },
  })

  function tightStorage(refuses: (value: string, tries: number) => boolean): () => Session {
    const written: string[] = []
    let tries = 0
    vi.stubGlobal('localStorage', {
      setItem: (_key: string, value: string) => {
        if (refuses(value, tries++)) throw new DOMException('full', 'QuotaExceededError')
        written.push(value)
      },
    })
    return () => JSON.parse(written.at(-1) ?? '{}') as Session
  }

  const tabsOf = (saved: Session) => (saved.layout ? panesOf(saved.layout.frame)[0]?.tabs : [])

  test('gives up what was closed before what is open when storage is full', () => {
    const saved = tightStorage((_, tries) => tries < 1)

    expect(writeSession('orden:workspace', session())).toBe(true)
    expect(saved().closed).toEqual([])
    expect(tabsOf(saved())?.[0]).toMatchObject({ path: '/Notes/a.md', doc: '# on disk too' })
  })

  test('gives up the copies of notes that live somewhere else next', () => {
    const saved = tightStorage((_, tries) => tries < 2)

    expect(writeSession('orden:workspace', session())).toBe(true)
    expect(tabsOf(saved())).toMatchObject([
      { path: '/Notes/a.md', doc: '', dirty: false },
      { path: null, doc: '# nowhere else', dirty: true },
    ])
  })

  test('brings the closed tabs back through a restart, saying which shape it wrote', () => {
    const saved = tightStorage(() => false)
    writeSession('orden:workspace', session())

    expect(saved()).toMatchObject({ version: 2 })
    expect(readSession(saved())?.closed).toMatchObject([
      { paneId: 'p1', at: 0, draft: { path: '/Notes/gone.md', doc: '# closed' } },
    ])
  })

  test('says so when there is nothing left to give up', () => {
    tightStorage(() => true)
    expect(writeSession('orden:workspace', session())).toBe(false)
  })

  test('gives up what the words were typed on before the words', () => {
    const saved = tightStorage((value) => value.includes('THE VERSION'))
    const typed = { ...draft('/s/a.md', 'UNWRITTEN'), base: 'THE VERSION' }

    expect(writeSession('k', { ...session(), layout: { ...both, frame: onePane([typed]) } })).toBe(true)
    expect(JSON.stringify(saved())).toContain('UNWRITTEN')
  })
})

describe('a pane that stacks its notes', () => {
  test('says so when it is read back, and one that never said does not', () => {
    const tabs = [draft('/Notes/a.md', '')]
    expect(panesRead({ ...both, frame: onePane(tabs, 'p1', { stacked: true }) })[0]?.stacked).toBe(true)
    expect(panesRead({ ...both, frame: onePane(tabs) })[0]?.stacked).toBe(false)
  })

  test('and it survives the round trip out and back', () => {
    const one = pane('p1', 't1')
    one.stacked = true

    const written = frameDraft(one, () => ({ tabs: [draft('/Notes/a.md', '')], active: 0 }))
    expect(written.kind === 'pane' && written.pane.stacked).toBe(true)
    expect(frameOf(written, () => 't1')).toMatchObject({ stacked: true })
  })
})
