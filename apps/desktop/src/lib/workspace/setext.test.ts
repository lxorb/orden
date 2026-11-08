import { beforeEach, describe, expect, test, vi } from 'vitest'

const disk = new Map<string, string>()
const read: string[] = []
const kept = new Map<string, unknown>()

vi.mock('../tauri', () => ({
  isNative: false,
  platform: () => 'linux',
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    if (command === 'read_note') {
      read.push(path)
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'write_note' && typeof args?.content === 'string') disk.set(path, args.content)
    return Promise.resolve('')
  },
}))

vi.mock('../link-index.svelte', () => ({ links: { noteSaved: () => undefined } }))
vi.mock('../sync.svelte', () => ({ sync: { nudge: () => undefined } }))
vi.mock('../sharing.svelte', () => ({ canWriteAt: () => true }))
vi.mock('../protect/protection.svelte', () => ({ protection: { locked: () => true } }))
vi.mock('../stored', () => ({
  stored: (key: string) => kept.get(key) ?? null,
  keepJson: (key: string, value: unknown) => {
    kept.set(key, value)
    return true
  },
}))

const { dropSetext, keepSetextMarked, SETEXT_GONE, SETEXT_KEY } = await import('./setext')
const { FileActions } = await import('./undo.svelte')
const { keptAway } = await import('../web/away.svelte')
type HoldsNotes = import('./note-text').HoldsNotes & import('./setext').MarksNotes
type ItemMeta = import('@orden/sync-core/meta').ItemMeta
type MetaPatch = import('@orden/sync-core/meta').MetaPatch

const SPACE = '/space'

const signedOut = () => false
const signedIn = () => true

let marked: Record<string, MetaPatch>[] = []

function space(
  notes: Record<string, string>,
  items: Record<string, ItemMeta> = {},
  describes = true,
): HoldsNotes {
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)
  return {
    itemMeta: {
      describes: () => describes,
      fromEngine: () => Promise.resolve(),
      itemsOf: () => items,
      setMany: (_: string, patches: Record<string, MetaPatch>) => {
        marked.push(patches)
      },
    },
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    notes: Object.keys(notes).map((path) => ({ path })),
    documents: [],
    documentAt: () => null,
    undone: new FileActions(),
    tags: [],
    flush: () => undefined,
    loadTree: () => Promise.resolve(),
    persist: () => undefined,
  } as unknown as HoldsNotes
}

beforeEach(() => {
  read.length = 0
  keptAway.clear()
  disk.clear()
  kept.clear()
  marked = []
})

describe('a space written with underlined headings', () => {
  test('has them written with hashes once, and nothing else touched', async () => {
    const ws = space({
      [`${SPACE}/a.md`]: 'Title\n=====\n\nwords\n\nPart\n----\n',
      [`${SPACE}/b.md`]: '# Already\n\ntext\n\n---\n',
      [`${SPACE}/c.md`]: '```\nnot\n---\n```\n',
    })

    expect(await dropSetext(ws, SPACE, signedOut, 0)).toBe(1)
    expect(disk.get(`${SPACE}/a.md`)).toBe('# Title\n\nwords\n\n## Part\n')
    expect(disk.get(`${SPACE}/b.md`)).toBe('# Already\n\ntext\n\n---\n')
    expect(disk.get(`${SPACE}/c.md`)).toBe('```\nnot\n---\n```\n')
    expect(kept.get(SETEXT_GONE)).toEqual([SPACE])
    expect(marked).toEqual([{ 'a.md': { [SETEXT_KEY]: 'gone' } }])
    expect(ws.undone.stack).toEqual([])
  })

  test('leaves a note alone that is being written in, or open in a room shared with others', async () => {
    const ws = space({
      [`${SPACE}/a.md`]: 'Title\n=====\n',
      [`${SPACE}/b.md`]: 'Other\n=====\n',
      [`${SPACE}/c.md`]: 'Third\n=====\n',
      [`${SPACE}/d.md`]: 'Fourth\n=====\n',
    })
    const typed = { path: `${SPACE}/a.md`, dirty: false, revision: 2, shared: null }
    const unsaved = { path: `${SPACE}/c.md`, dirty: true, revision: 0, shared: null }
    const live = { path: `${SPACE}/d.md`, dirty: false, revision: 0, shared: 'room' }
    const open = [typed, unsaved, live]
    const writing = {
      ...ws,
      documentAt: (path: string) => open.find((one) => one.path === path) ?? null,
    } as unknown as HoldsNotes

    expect(await dropSetext(writing, SPACE, signedOut, 0)).toBe(1)
    expect(disk.get(`${SPACE}/a.md`)).toBe('Title\n=====\n')
    expect(disk.get(`${SPACE}/b.md`)).toBe('# Other\n')
    expect(disk.get(`${SPACE}/c.md`)).toBe('Third\n=====\n')
    expect(disk.get(`${SPACE}/d.md`)).toBe('Fourth\n=====\n')
  })

  test('is not walked again once it has been', async () => {
    const ws = space({ [`${SPACE}/a.md`]: 'Title\n=====\n' })
    kept.set(SETEXT_GONE, [SPACE])

    expect(await dropSetext(ws, SPACE, signedOut, 0)).toBe(0)
    expect(disk.get(`${SPACE}/a.md`)).toBe('Title\n=====\n')
  })

  test('is left alone on a device that comes to it after another device rewrote it', async () => {
    const ws = space(
      { [`${SPACE}/a.md`]: 'A rule since\n\n---\n', [`${SPACE}/b.md`]: 'Words\n---\n' },
      { 'old.md': { [SETEXT_KEY]: 'gone' } },
    )

    expect(await dropSetext(ws, SPACE, signedIn, 0)).toBe(0)
    expect(disk.get(`${SPACE}/b.md`)).toBe('Words\n---\n')
    expect(kept.get(SETEXT_GONE)).toEqual([SPACE])
    expect(marked).toEqual([])
  })

  test('marks a note for the other devices even when nothing needed rewriting', async () => {
    const ws = space({ [`${SPACE}/a.md`]: '# Fine\n', [`${SPACE}/b.md`]: 'also fine\n' })

    expect(await dropSetext(ws, SPACE, signedIn, 0)).toBe(0)
    expect(marked).toEqual([{ 'a.md': { [SETEXT_KEY]: 'gone' } }])
    expect(kept.get(SETEXT_GONE)).toEqual([SPACE])
  })

  test('waits, signed in, until the account says what its notes are marked with', async () => {
    const ws = space({ [`${SPACE}/a.md`]: 'Title\n=====\n' }, {}, false)

    expect(await dropSetext(ws, SPACE, signedIn, 0)).toBe(0)
    expect(disk.get(`${SPACE}/a.md`)).toBe('Title\n=====\n')
    expect(kept.get(SETEXT_GONE)).toBeUndefined()
    expect(marked).toEqual([])
  })
})

describe('the mark a rewritten space carries', () => {
  test('is put back on a note when every note that held it has been deleted', () => {
    kept.set(SETEXT_GONE, [SPACE])
    const ws = space({ [`${SPACE}/new.md`]: 'A rule since\n---\n' })

    keepSetextMarked(ws, SPACE)

    expect(marked).toEqual([{ 'new.md': { [SETEXT_KEY]: 'gone' } }])
  })

  test('so a device that comes late after the deletion leaves the rules written since alone', async () => {
    kept.set(SETEXT_GONE, [SPACE])
    const items: Record<string, ItemMeta> = {}
    const ws = space({ [`${SPACE}/new.md`]: 'A rule since\n---\n' }, items)
    ;(ws.itemMeta as { setMany: unknown }).setMany = (
      _: string,
      patches: Record<string, MetaPatch>,
    ) => {
      for (const [at, patch] of Object.entries(patches)) items[at] = patch as ItemMeta
    }
    keepSetextMarked(ws, SPACE)

    kept.clear()
    expect(await dropSetext(ws, SPACE, signedIn, 0)).toBe(0)
    expect(disk.get(`${SPACE}/new.md`)).toBe('A rule since\n---\n')
  })

  test('is left as it is where a note still holds it', () => {
    kept.set(SETEXT_GONE, [SPACE])
    keepSetextMarked(
      space({ [`${SPACE}/a.md`]: 'x\n' }, { 'b.md': { [SETEXT_KEY]: 'gone' } }),
      SPACE,
    )

    expect(marked).toEqual([])
  })

  test('is not put on a space this device never rewrote, or one the account keeps no marks for', () => {
    keepSetextMarked(space({ [`${SPACE}/a.md`]: 'x\n' }), SPACE)
    kept.set(SETEXT_GONE, [SPACE])
    keepSetextMarked(space({ [`${SPACE}/a.md`]: 'x\n' }, {}, false), SPACE)

    expect(marked).toEqual([])
  })
})

describe('a space whose notes the browser keeps away', () => {
  function away(texts: Record<string, string>, answers = true) {
    keptAway.keep(
      Object.keys(texts).map((path, at) => ({ id: `x${String(at)}`, path, size: 1, modified: 1 })),
      () => Promise.resolve(true),
    )
    keptAway.answeredBy(new Map(), (_root, query, _terms, _limit, onFound) => {
      if (!answers) return Promise.resolve(false)
      const pattern = new RegExp((query as { source: string }).source)
      const hits = Object.entries(texts)
        .filter(([, text]) => pattern.test(text))
        .map(([path]) => ({ path }))
      if (hits.length) onFound({ hits, loose: [] } as never)
      return Promise.resolve(true)
    })
  }

  test('brings back only those the account finds a line under words in', async () => {
    const texts = {
      [`${SPACE}/u.md`]: 'Away\n====\n',
      [`${SPACE}/p.md`]: '# Plain\n\nwords\n',
    }
    const ws = space({ [`${SPACE}/a.md`]: 'Here\n----\n', ...texts })
    away(texts)

    expect(await dropSetext(ws, SPACE, signedOut, 0)).toBe(2)
    expect([...new Set(read)].sort()).toEqual([`${SPACE}/a.md`, `${SPACE}/u.md`])
    expect(disk.get(`${SPACE}/u.md`)).toBe('# Away\n')
    expect(disk.get(`${SPACE}/p.md`)).toBe('# Plain\n\nwords\n')
  })

  test('waits for another launch when the account cannot be asked', async () => {
    const texts = { [`${SPACE}/u.md`]: 'Away\n====\n' }
    const ws = space({ [`${SPACE}/a.md`]: 'Here\n----\n', ...texts })
    away(texts, false)

    expect(await dropSetext(ws, SPACE, signedOut, 0)).toBe(0)
    expect(read).toEqual([])
    expect(kept.get(SETEXT_GONE)).toBeUndefined()
    expect(marked).toEqual([])
  })
})
