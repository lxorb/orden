import { describe, expect, test, vi } from 'vitest'
import { pane } from './pane-tree'
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
    expect(readSession(null)).toBeNull()
    expect(readSession('{}')).toBeNull()
    expect(readSession([])).toBeNull()
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

    expect(session?.spaces.map((space) => space.id)).toEqual(['s'])
    expect(session?.activeSpace).toBeNull()
    expect(session?.panel).toBeNull()
    expect(session?.tabs?.map((tab) => tab.name)).toEqual(['a.md'])
    expect(session?.positions).toEqual({})
  })

  test('still reads the open paths an older version wrote', () => {
    const session = readSession({
      spaces: [],
      activeSpace: null,
      panel: null,
      openPaths: ['/Notes/a.md', '/Notes/b.md'],
      activePath: '/Notes/b.md',
    })

    expect(session?.openPaths).toEqual(['/Notes/a.md', '/Notes/b.md'])
    expect(session?.activePath).toBe('/Notes/b.md')
    expect(session?.tabs).toBeUndefined()
  })

  test('brings back both sides: what is on the right, what it showed last, what it knew', () => {
    const session = readSession({
      spaces: [],
      activeSpace: null,
      panel: 'tree',
      right: ['ask', 'nowhere', 'ask', 'outline'],
      rightPanel: 'outline',
      lastRight: 'ask',
      known: ['tree', 'ask', 'somewhere'],
    })

    expect(session?.right).toEqual(['ask', 'outline'])
    expect(session?.rightPanel).toBe('outline')
    expect(session?.lastRight).toBe('ask')
    expect(session?.known).toEqual(['tree', 'ask'])
  })
})

describe('reading one tab', () => {
  test('needs a name and some text to be a tab at all', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ name: 'a' })
    expect(readDraft({ path: null, doc: '' })).toBeNull()
    expect(readDraft({ path: 7, name: 'a', doc: '' })).toBeNull()
  })

  test('fills in a caret and a scroll that were never written', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ cursor: 0, scroll: 0 })
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('anchor')
  })

  test('brings back which face of the note was up', () => {
    expect(readDraft({ path: null, name: 'a', doc: '', reading: true })).toMatchObject({
      reading: true,
    })
  })

  test('brings back whether it showed the markdown as written, either way', () => {
    expect(readDraft({ path: null, name: 'a', doc: '', source: true })).toMatchObject({
      source: true,
    })
    expect(readDraft({ path: null, name: 'a', doc: '', source: false })).toMatchObject({
      source: false,
    })
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('source')
    expect(readDraft({ path: null, name: 'a', doc: '', source: 'yes' })).not.toHaveProperty(
      'source',
    )
  })

  test('keeps the web data a tab with no file took along', () => {
    const apart = '3f9a0c17e2b4d685'
    expect(readDraft({ kind: 'web', path: null, name: 'a', doc: '', apart })).toMatchObject({
      apart,
    })
    expect(
      readDraft({ kind: 'web', path: '/s/a.url', name: 'a', doc: '', apart }),
    ).not.toHaveProperty('apart')
  })

  test('is being written in unless it says otherwise', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('reading')
    expect(readDraft({ path: null, name: 'a', doc: '', reading: 'yes' })).not.toHaveProperty(
      'reading',
    )
  })

  test('reads the kind off the file’s name, whatever the entry claims', () => {
    for (const claimed of [undefined, 'note', 'pdf', 'graph', 'nonsense', 7]) {
      expect(
        readDraft({ kind: claimed, path: '/Notes/Board.canvas', name: 'Board.canvas', doc: '' }),
        JSON.stringify(claimed ?? null),
      ).toMatchObject({ kind: 'canvas' })
    }
  })

  test('and does not leave a canvas over a file whose name says words', () => {
    expect(
      readDraft({ kind: 'canvas', path: '/Notes/plan.md', name: 'plan.md', doc: '' }),
    ).toMatchObject({ kind: 'note' })
  })

  test('a website comes back as one, whatever the entry claims', () => {
    for (const claimed of [undefined, 'note', 'canvas', 'nonsense']) {
      expect(
        readDraft({
          kind: claimed,
          path: '/Notes/Svelte docs.url',
          name: 'Svelte docs.url',
          doc: '',
        }),
        JSON.stringify(claimed ?? null),
      ).toMatchObject({ kind: 'web' })
    }

    expect(
      readDraft({
        kind: 'note',
        path: '/Notes/Safari page.webloc',
        name: 'Safari page.webloc',
        doc: '',
      }),
    ).toMatchObject({ kind: 'web' })
  })

  test('leaves a tab no file names alone, which is the graph', () => {
    expect(readDraft({ kind: 'graph', path: null, name: 'Graph', doc: '' })).toMatchObject({
      kind: 'graph',
    })
    expect(
      readDraft({ kind: 'pdf', path: '/Notes/paper.pdf', name: 'paper.pdf', doc: '' }),
    ).toMatchObject({ kind: 'pdf' })
  })

  test('brings a terminal back as a terminal, with its shell and its folder', () => {
    const doc = '{"shell":"pwsh","folder":"/home/me/code","key":"k1"}'
    const back = readDraft({ kind: 'terminal', path: null, name: 'PowerShell', doc })

    expect(back).toMatchObject({ kind: 'terminal', path: null, name: 'PowerShell', doc })
  })

  test('brings a tab with no file back in the space it was opened in', () => {
    const web = { kind: 'web', path: null, name: 'Site', doc: '', space: 'w' }
    const kept = { ...web, path: '/Notes/Site.url' }

    expect(readDraft(web)).toMatchObject({ space: 'w' })
    expect(readDraft(kept)).not.toHaveProperty('space')
    expect(readDraft({ ...web, space: 7 })).not.toHaveProperty('space')
  })
})

describe('reading a closed tab', () => {
  test('brings back the tab, its pane and its place', () => {
    const back = readClosed({
      draft: { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false },
      paneId: 'left',
      at: 3,
    })

    expect(back?.draft.name).toBe('a.md')
    expect(back?.paneId).toBe('left')
    expect(back?.at).toBe(3)
  })

  test('fills in a pane and a place that were never written', () => {
    const back = readClosed({ draft: { path: null, name: 'Untitled', doc: '# draft' } })

    expect(back?.paneId).toBe('')
    expect(back?.at).toBe(0)
  })

  test('brings back where its words were put in Recently deleted', () => {
    const draft = { path: null, name: 'Untitled', doc: '# draft' }

    expect(readClosed({ draft, trashed: 't1' })?.trashed).toBe('t1')
    expect(readClosed({ draft, trashed: 1 })).not.toHaveProperty('trashed')
  })

  test('is nothing at all without a tab in it', () => {
    expect(readClosed({ paneId: 'left', at: 0 })).toBeNull()
    expect(readClosed({ draft: { name: 42 } })).toBeNull()
    expect(readClosed(null)).toBeNull()
    expect(readClosed({ draft: { path: null, name: 'a', doc: '' }, at: -2 })?.at).toBe(0)
  })
})

describe('reading one place', () => {
  test('needs both a caret and a scroll', () => {
    expect(readPosition({ cursor: 1, scroll: 2 })).toEqual({ cursor: 1, scroll: 2, at: 0 })
    expect(readPosition({ cursor: 1 })).toBeNull()
    expect(readPosition({ cursor: Number.NaN, scroll: 2 })).toBeNull()
  })

  test('keeps the folds it was written with', () => {
    const place = readPosition({ cursor: 1, scroll: 2, folds: [[1, 9]] })
    expect(place?.folds).toEqual([[1, 9]])
  })

  test('drops a fold that names nothing a note could have', () => {
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[0, 4]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[4, 4]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[9, 3]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[1, 2, 3]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[1, '4']] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: 'all' })?.folds).toBeUndefined()
  })

  test('keeps the good folds and drops only the bad ones', () => {
    const place = readPosition({
      cursor: 1,
      scroll: 2,
      folds: [
        [1, 9],
        [7, 2],
      ],
    })

    expect(place?.folds).toEqual([[1, 9]])
  })
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

const onePane = (tabs: Draft[], id = 'p1'): FrameDraft => ({
  kind: 'pane',
  pane: { id, tabs, active: 0, linked: false },
})

describe('reading an arrangement of panes', () => {
  test('brings back the panes, their strips and which one had the focus', () => {
    const layout = readLayout({
      focused: 'p2',
      panel: 'tree',
      frame: {
        kind: 'split',
        id: 's1',
        along: 'row',
        fraction: 0.4,
        sides: [
          onePane([draft('/Notes/a.md', '')]),
          {
            kind: 'pane',
            pane: { id: 'p2', tabs: [draft('/Notes/b.md', '')], active: 0, linked: true },
          },
        ],
      },
    })

    expect(layout?.focused).toBe('p2')
    expect(layout?.panel).toBe('tree')
    expect(layout?.frame.kind).toBe('split')
    expect(panesOf(layout?.frame ?? onePane([])).map((one) => one.id)).toEqual(['p1', 'p2'])
    expect(panesOf(layout?.frame ?? onePane([]))[1]?.linked).toBe(true)
  })

  test('fills in a direction and a share of the room that were never written', () => {
    const layout = readLayout({
      frame: { kind: 'split', sides: [onePane([]), onePane([], 'p2')] },
    })

    const frame = layout?.frame
    expect(frame?.kind === 'split' && frame.along).toBe('row')
    expect(frame?.kind === 'split' && frame.fraction).toBe(0.5)
    expect(frame?.kind === 'split' && frame.id.length).toBeGreaterThan(0)
  })

  test('reads a split that lost a side as the side it still has', () => {
    const layout = readLayout({
      frame: { kind: 'split', id: 's1', along: 'row', fraction: 0.5, sides: [onePane([]), null] },
    })

    expect(layout?.frame.kind).toBe('pane')
  })

  test('answers nothing for an arrangement with no panes in it', () => {
    expect(readLayout({ focused: 'p1' })).toBeNull()
    expect(readLayout(null)).toBeNull()
  })

  test('takes the sidebar from the arrangement rather than from beside it', () => {
    const session = readSession({
      spaces: [],
      activeSpace: null,
      panel: 'search',
      layout: { focused: 'p1', panel: 'outline', frame: onePane([]) },
    })

    expect(session?.panel).toBe('outline')
  })
})

describe('an arrangement, there and back', () => {
  test('keeps the tree, the tabs and the share of the room', () => {
    const first = pane('p1', 't1')
    const second = pane('p2', 't2')
    second.linked = true

    const written = frameDraft(
      { kind: 'split', id: 's1', along: 'column', fraction: 0.3, sides: [first, second] },
      (one) => ({ tabs: [draft(`/Notes/${one.id}.md`, '')], active: 0 }),
    )

    const back = frameOf(written, (one) => (one.id === 'p2' ? 't2' : 't1'))

    expect(back.kind === 'split' && back.along).toBe('column')
    expect(back.kind === 'split' && back.fraction).toBe(0.3)
    expect(back.kind === 'split' && back.sides[1].kind === 'pane' && back.sides[1].linked).toBe(
      true,
    )
    expect(
      back.kind === 'split' && back.sides[1].kind === 'pane' && back.sides[1].activeTabId,
    ).toBe('t2')
  })
})

describe('an arrangement kept under a name', () => {
  test('holds no words for a note that lives on disk', () => {
    const layout: Layout = {
      focused: 'p1',
      panel: null,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    }

    const bare = withoutText(layout)
    const tabs = panesOf(bare.frame)[0]?.tabs ?? []

    expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '', dirty: false })
    expect(tabs[1]).toMatchObject({ path: null, doc: '# nowhere else', dirty: true })
  })

  test('says which tabs were views of one note', () => {
    const shared = panesOf(
      readLayout({
        focused: 'p1',
        frame: {
          kind: 'split',
          id: 's1',
          along: 'row',
          fraction: 0.5,
          sides: [
            onePane([draft('/Notes/a.md', '', 'd1')]),
            onePane([draft('/Notes/a.md', '', 'd1')], 'p2'),
          ],
        },
      })?.frame ?? onePane([]),
    )

    expect(shared.map((one) => one.tabs[0]?.share)).toEqual(['d1', 'd1'])
  })
})

describe('writing the session down', () => {
  const session = (): Session => ({
    spaces: [],
    activeSpace: null,
    panel: null,
    closed: [{ draft: draft('/Notes/gone.md', '# closed'), paneId: 'p1', at: 0 }],
    layout: {
      focused: 'p1',
      panel: null,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    },
  })

  function tightStorage(refusals: number): string[] {
    const written: string[] = []
    let left = refusals

    vi.stubGlobal('localStorage', {
      setItem: (_key: string, value: string) => {
        if (left-- > 0) throw new Error('quota exceeded')
        written.push(value)
      },
    })

    return written
  }

  test('gives up what was closed before what is open when storage is full', () => {
    const written = tightStorage(1)

    try {
      expect(writeSession('orden:workspace', session())).toBe(true)

      const saved = JSON.parse(written[0] ?? '{}') as Session
      const tabs = saved.layout ? (panesOf(saved.layout.frame)[0]?.tabs ?? []) : []
      expect(saved.closed).toEqual([])
      expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '# on disk too' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('gives up the copies of notes that live somewhere else next', () => {
    const written = tightStorage(2)

    try {
      expect(writeSession('orden:workspace', session())).toBe(true)

      const saved = JSON.parse(written[0] ?? '{}') as Session
      const tabs = saved.layout ? (panesOf(saved.layout.frame)[0]?.tabs ?? []) : []
      expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '', dirty: false })
      expect(tabs[1]).toMatchObject({ path: null, doc: '# nowhere else', dirty: true })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('brings the closed tabs back through a restart', () => {
    const written = tightStorage(0)

    try {
      writeSession('orden:workspace', session())
      const back = readSession(JSON.parse(written[0] ?? '{}'))

      expect(back?.closed).toHaveLength(1)
      expect(back?.closed?.[0]).toMatchObject({ paneId: 'p1', at: 0 })
      expect(back?.closed?.[0]?.draft).toMatchObject({ path: '/Notes/gone.md', doc: '# closed' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('says which shape it wrote', () => {
    const written = tightStorage(0)

    try {
      writeSession('orden:workspace', session())
      expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ version: 2 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('says so when there is nothing left to give up', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })

    try {
      expect(writeSession('orden:workspace', session())).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a pane that stacks its notes', () => {
  test('says so when it is read back', () => {
    const layout = readLayout({
      focused: 'p1',
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          tabs: [draft('/Notes/a.md', '')],
          active: 0,
          linked: false,
          stacked: true,
        },
      },
    })

    expect(panesOf(layout?.frame ?? onePane([]))[0]?.stacked).toBe(true)
  })

  test('and a session that never said reads back as one that does not', () => {
    const layout = readLayout({ focused: 'p1', frame: onePane([draft('/Notes/a.md', '')]) })

    expect(panesOf(layout?.frame ?? onePane([]))[0]?.stacked).toBe(false)
  })

  test('and it survives the round trip out and back', () => {
    const one = pane('p1', 't1')
    one.stacked = true

    const written = frameDraft(one, () => ({ tabs: [draft('/Notes/a.md', '')], active: 0 }))
    expect(written.kind === 'pane' && written.pane.stacked).toBe(true)

    const back = frameOf(written, () => 't1')
    expect(back.kind === 'pane' && back.stacked).toBe(true)
  })
})

describe('what the words were typed on', () => {
  test('goes before the words do, when storage is short', () => {
    const written: string[] = []
    const storage = {
      setItem: (_key: string, value: string) => {
        if (value.includes('THE VERSION')) throw new DOMException('full', 'QuotaExceededError')
        written.push(value)
      },
    }
    vi.stubGlobal('localStorage', storage)
    try {
      const layout = {
        panel: null,
        focused: 'p',
        frame: {
          kind: 'pane' as const,
          pane: {
            id: 'p',
            active: 0,
            linked: false,
            tabs: [
              {
                kind: 'note' as const,
                path: '/s/a.md',
                name: 'a.md',
                doc: 'UNWRITTEN',
                base: 'THE VERSION',
                dirty: true,
                cursor: 0,
                scroll: 0,
              },
            ],
          },
        },
      }
      expect(
        writeSession('k', { spaces: [], activeSpace: null, panel: null, closed: [], layout }),
      ).toBe(true)
      expect(written.at(-1)).toContain('UNWRITTEN')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
