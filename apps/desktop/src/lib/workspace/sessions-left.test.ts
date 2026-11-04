import { describe, expect, test, vi } from 'vitest'
import { asDrafts, takeSessionsLeft } from './sessions-left'
import type { Draft } from './session'
import { LEAVING_GRACE } from './slot'

function memoryStorage(entries: Record<string, string> = {}): Storage {
  const store = new Map(Object.entries(entries))
  return {
    get length() {
      return store.size
    },
    key: (at) => [...store.keys()][at] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

const locks = {
  request: (_name: string, _options: unknown, run: (lock: unknown) => unknown) =>
    Promise.resolve(run({})),
} as unknown as LockManager

const tab = (fields: object) => ({ name: 'n.md', doc: '', dirty: false, ...fields })
const session = (tabs: object[]) =>
  JSON.stringify({
    spaces: [],
    activeSpace: null,
    panel: null,
    positions: {},
    closed: [],
    layout: {
      panel: null,
      focused: 'p',
      frame: { kind: 'pane', pane: { id: 'p', linked: false, active: 0, tabs } },
    },
  })

const draftWords = 'DRAFT WORDS'

describe('what a window that went left', () => {
  test('moves: a reload taking it again finds nothing, and the first entry keeps its tabs', async () => {
    const storage = memoryStorage({
      'nib:workspace': session([
        tab({ path: '/s/a.md', name: 'a.md' }),
        tab({ path: null, doc: draftWords }),
      ]),
    })
    const taken: Draft[][] = []
    const take = (drafts: Draft[]) => {
      taken.push(drafts)
      return Promise.resolve()
    }
    for (let reload = 0; reload < 3; reload += 1) {
      await takeSessionsLeft(1, take, storage, locks)
    }

    expect(taken).toHaveLength(1)
    expect(taken[0]?.map((one) => one.doc)).toEqual([draftWords])
    expect(storage.getItem('nib:workspace')).toContain('/s/a.md')
    expect(storage.getItem('nib:workspace')).not.toContain(draftWords)
  })

  test('stays where it is if it could not be taken', async () => {
    const storage = memoryStorage({
      'nib:workspace:2': session([tab({ path: null, doc: draftWords })]),
    })
    const take = vi.fn(() => Promise.reject(new Error('no')))
    await takeSessionsLeft(0, take, storage, locks).catch(() => undefined)

    expect(storage.getItem('nib:workspace:2')).toContain(draftWords)
  })

  test('a session left this moment may be a reload coming back: it is left for its grace', async () => {
    const now = 1_000_000
    const storage = memoryStorage({
      'nib:workspace:1': session([tab({ path: null, doc: draftWords })]),
      'nib:window-left:1': String(now - 100),
    })
    const take = vi.fn(() => Promise.resolve())

    expect(await takeSessionsLeft(0, take, storage, locks, now)).toBe(true)
    expect(take).not.toHaveBeenCalled()
    expect(storage.getItem('nib:workspace:1')).not.toBeNull()

    expect(await takeSessionsLeft(0, take, storage, locks, now + LEAVING_GRACE)).toBe(false)
    expect(take).toHaveBeenCalledTimes(1)
    expect(storage.getItem('nib:workspace:1')).toBeNull()
  })
})

describe('wherever the session held them', () => {
  const frame = (tabs: object[], active = 0, recent?: number[]) => ({
    kind: 'pane',
    pane: { id: 'q', linked: false, active, ...(recent ? { recent } : {}), tabs },
  })
  const whole = (fields: object) =>
    JSON.stringify({
      spaces: [],
      activeSpace: null,
      panel: null,
      positions: {},
      closed: [],
      layout: { panel: null, focused: 'p', frame: frame([]) },
      ...fields,
    })
  const taking = () => {
    const taken: Draft[] = []
    return {
      taken,
      take: (drafts: Draft[]) => {
        taken.push(...drafts)
        return Promise.resolve()
      },
    }
  }
  const aside = (tabs: object[], active = 0, recent?: number[]) => ({
    on: 's1',
    aside: {
      s2: {
        layout: { panel: null, focused: 'q', frame: frame(tabs, active, recent) },
        right: null,
      },
    },
  })

  test('in a set out of sight, of a slot past the first', async () => {
    const storage = memoryStorage({
      'nib:workspace:1': whole({
        sets: aside([
          tab({ path: null, doc: draftWords, space: 's2' }),
          tab({ path: '/s/a.md', doc: 'typed', dirty: true }),
          tab({ path: '/s/b.md' }),
        ]),
      }),
    })
    const { taken, take } = taking()
    await takeSessionsLeft(0, take, storage, locks)

    expect(taken.map((one) => one.doc)).toEqual([draftWords, 'typed'])
    expect(storage.getItem('nib:workspace:1')).toBeNull()
  })

  test('in a set out of sight, of the first slot: they move, and the rest stays', async () => {
    const storage = memoryStorage({
      'nib:workspace': whole({
        sets: aside([tab({ path: null, doc: draftWords }), tab({ path: '/s/b.md' })]),
      }),
    })
    const { taken, take } = taking()
    for (let reload = 0; reload < 2; reload += 1) {
      await takeSessionsLeft(1, take, storage, locks)
    }

    expect(taken.map((one) => one.doc)).toEqual([draftWords])
    expect(storage.getItem('nib:workspace')).not.toContain(draftWords)
    expect(storage.getItem('nib:workspace')).toContain('/s/b.md')
  })

  test('in a split, on both sides of it', async () => {
    const split = {
      kind: 'split',
      id: 'x',
      along: 'row',
      fraction: 0.5,
      sides: [frame([tab({ path: null, doc: 'LEFT' })]), frame([tab({ path: null, doc: 'RIGHT' })])],
    }
    const storage = memoryStorage({
      'nib:workspace': whole({ layout: { panel: null, focused: 'q', frame: split } }),
    })
    const { taken, take } = taking()
    await takeSessionsLeft(1, take, storage, locks)

    expect(taken.map((one) => one.doc)).toEqual(['LEFT', 'RIGHT'])
    expect(storage.getItem('nib:workspace')).not.toContain('LEFT')
    expect(storage.getItem('nib:workspace')).not.toContain('RIGHT')
  })

  test('in a strip of an older build', async () => {
    const raw = JSON.parse(whole({ tabs: [tab({ path: null, doc: draftWords })] })) as {
      layout?: unknown
    }
    delete raw.layout
    const storage = memoryStorage({ 'nib:workspace:3': JSON.stringify(raw) })
    const { taken, take } = taking()
    await takeSessionsLeft(0, take, storage, locks)
    expect(taken.map((one) => one.doc)).toEqual([draftWords])
  })

  test('on the closed stack, where no Recently deleted has them', async () => {
    const storage = memoryStorage({
      'nib:workspace:1': whole({
        closed: [
          { draft: tab({ path: null, doc: 'CLOSED, IN NO TRASH' }), paneId: 'p', at: 0 },
          { draft: tab({ path: null, doc: 'IN THE TRASH' }), paneId: 'p', at: 0, trashed: 't1' },
          { draft: tab({ path: '/s/a.md', doc: 'owed', dirty: true }), paneId: 'p', at: 0 },
          { draft: tab({ path: '/s/b.md' }), paneId: 'p', at: 0 },
        ],
      }),
    })
    const { taken, take } = taking()
    await takeSessionsLeft(0, take, storage, locks)
    expect(taken.map((one) => one.doc)).toEqual(['CLOSED, IN NO TRASH', 'owed'])
  })

  test('off the first slot, the closed stack keeps what it can still bring back', async () => {
    const storage = memoryStorage({
      'nib:workspace': whole({
        closed: [
          { draft: tab({ path: null, doc: 'CLOSED, IN NO TRASH' }), paneId: 'p', at: 0 },
          { draft: tab({ path: '/s/b.md' }), paneId: 'p', at: 0 },
        ],
      }),
    })
    const { take } = taking()
    await takeSessionsLeft(1, take, storage, locks)
    const left = storage.getItem('nib:workspace') ?? ''
    expect(left).not.toContain('CLOSED, IN NO TRASH')
    expect(left).toContain('/s/b.md')
  })

  test('a tab that holds no words of a file is not words: a terminal stays behind', async () => {
    const storage = memoryStorage({
      'nib:workspace:1': whole({
        layout: {
          panel: null,
          focused: 'q',
          frame: frame([tab({ kind: 'terminal', path: null, doc: '{"shell":"bash"}' })]),
        },
      }),
    })
    const { taken, take } = taking()
    await takeSessionsLeft(0, take, storage, locks)
    expect(taken).toEqual([])
  })

  test('a strip that loses tabs keeps which one was in front, and the order of use', async () => {
    const tabs = [
      tab({ path: null, doc: 'FIRST' }),
      tab({ path: '/s/a.md' }),
      tab({ path: null, doc: 'SECOND' }),
      tab({ path: '/s/b.md' }),
      tab({ path: '/s/c.md' }),
    ]
    const storage = memoryStorage({
      'nib:workspace': whole({
        layout: { panel: null, focused: 'q', frame: frame(tabs, 3, [3, 0, 4, 2, 1]) },
      }),
    })
    const { take } = taking()
    await takeSessionsLeft(1, take, storage, locks)
    const left = JSON.parse(storage.getItem('nib:workspace') ?? '{}') as {
      layout: { frame: { pane: { tabs: { path: string }[]; active: number; recent: number[] } } }
    }
    const { pane } = left.layout.frame
    expect(pane.tabs.map((one) => one.path)).toEqual(['/s/a.md', '/s/b.md', '/s/c.md'])
    expect(pane.tabs[pane.active]?.path).toBe('/s/b.md')
    expect(pane.recent.map((at) => pane.tabs[at]?.path)).toEqual(['/s/b.md', '/s/c.md', '/s/a.md'])
  })

  test('where the tab in front was the one taken, what is left shows the next', async () => {
    const tabs = [tab({ path: '/s/a.md' }), tab({ path: null, doc: 'WORDS' }), tab({ path: '/s/b.md' })]
    const storage = memoryStorage({
      'nib:workspace': whole({
        layout: { panel: null, focused: 'q', frame: frame(tabs, 1) },
      }),
    })
    const { take } = taking()
    await takeSessionsLeft(1, take, storage, locks)
    const left = JSON.parse(storage.getItem('nib:workspace') ?? '{}') as {
      layout: { frame: { pane: { tabs: { path: string }[]; active: number } } }
    }
    const { pane } = left.layout.frame
    expect(pane.tabs[pane.active]?.path).toBe('/s/b.md')
  })
})

describe('words on a file that went on without them', () => {
  const note = (fields: object) => tab(fields) as unknown as Draft

  test('stay, as a draft of their own, where the file says something else', async () => {
    const out = await asDrafts(
      [note({ path: '/s/a.md', doc: 'unwritten', dirty: true, share: 'k' })],
      () => Promise.resolve('what the file says'),
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ path: null, doc: 'unwritten', dirty: true })
    expect(out[0]).not.toHaveProperty('share')
  })

  test('stay where the file has gone', async () => {
    const out = await asDrafts([note({ path: '/s/a.md', doc: 'unwritten', dirty: true })], () =>
      Promise.resolve(null),
    )
    expect(out[0]).toMatchObject({ path: null, doc: 'unwritten' })
  })

  test('are not kept twice where the file says them', async () => {
    const out = await asDrafts([note({ path: '/s/a.md', doc: 'same', dirty: true })], () =>
      Promise.resolve('same'),
    )
    expect(out).toEqual([])
  })

  test('come once, for a note open in two panes', async () => {
    const out = await asDrafts(
      [
        note({ path: '/s/a.md', doc: 'unwritten', dirty: true, share: 'k' }),
        note({ path: '/s/a.md', doc: 'unwritten', dirty: true, share: 'k' }),
        note({ path: '/s/b.md', doc: 'other', dirty: true, share: 'j' }),
      ],
      () => Promise.resolve('what the file says'),
    )
    expect(out.map((one) => one.doc)).toEqual(['unwritten', 'other'])
  })

  test('are the file words of a CRLF file, line endings aside', async () => {
    const out = await asDrafts([note({ path: '/s/a.md', doc: 'a\nb\n', dirty: true })], () =>
      Promise.resolve('a\r\nb\r\n'),
    )
    expect(out).toEqual([])
  })

  test('belong to the space that holds their file', async () => {
    const out = await asDrafts(
      [note({ path: '/s/a.md', doc: 'unwritten', dirty: true })],
      () => Promise.resolve('what the file says'),
      () => 'space-1',
    )
    expect(out[0]).toMatchObject({ path: null, space: 'space-1' })
  })

  test('do not come where the file has gone on with them in it', async () => {
    const out = await asDrafts(
      [note({ path: '/s/a.md', doc: 'base\nmine\n', base: 'base\n', dirty: true })],
      () => Promise.resolve('base\nmine\nand a newer line\n'),
    )
    expect(out).toEqual([])
  })

  test('forget the version they were typed on', async () => {
    const out = await asDrafts(
      [note({ path: '/s/a.md', doc: 'mine', base: 'old', dirty: true })],
      () => Promise.resolve('other'),
    )
    expect(out[0]).not.toHaveProperty('base')
  })
})
