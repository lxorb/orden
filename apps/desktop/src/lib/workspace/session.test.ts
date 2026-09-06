import { describe, expect, test, vi } from 'vitest'
import { readDraft, readPosition, readSession, type Session, writeSession } from './session'

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
})

describe('reading one tab', () => {
  test('needs a name and some text to be a tab at all', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ name: 'a' })
    expect(readDraft({ path: null, doc: '' })).toBeNull()
    expect(readDraft({ path: 7, name: 'a', doc: '' })).toBeNull()
  })

  test('fills in a caret and a scroll that were never written', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ cursor: 0, scroll: 0 })
    // Absent, not undefined: the anchor is what tells an older session apart
    // from one that simply sat at the top.
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('anchor')
  })
})

describe('reading one place', () => {
  test('needs both a caret and a scroll', () => {
    expect(readPosition({ cursor: 1, scroll: 2 })).toEqual({ cursor: 1, scroll: 2, at: 0 })
    expect(readPosition({ cursor: 1 })).toBeNull()
    expect(readPosition({ cursor: Number.NaN, scroll: 2 })).toBeNull()
  })
})

describe('writing the session down', () => {
  const draft = (path: string | null, doc: string) => ({
    path,
    name: 'a.md',
    doc,
    dirty: true,
    cursor: 0,
    scroll: 0,
  })

  const session = (): Session => ({
    spaces: [],
    activeSpace: null,
    panel: null,
    tabs: [draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')],
  })

  test('gives up the copies of notes that live somewhere else when storage is full', () => {
    let full = true
    const written: string[] = []
    vi.stubGlobal('localStorage', {
      setItem: (_key: string, value: string) => {
        if (full) {
          full = false
          throw new Error('quota exceeded')
        }
        written.push(value)
      },
    })

    try {
      expect(writeSession('nib:workspace', session())).toBe(true)

      const saved = JSON.parse(written[0] ?? '{}') as Session
      // The note that has a file keeps its path and gives up its text; the one
      // that exists nowhere but here keeps every word.
      expect(saved.tabs?.[0]).toMatchObject({ path: '/Notes/a.md', doc: '', dirty: false })
      expect(saved.tabs?.[1]).toMatchObject({ path: null, doc: '# nowhere else', dirty: true })
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
      expect(writeSession('nib:workspace', session())).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
