import { describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'
import { asDrafts, takeSessionsLeft } from './sessions-left'
import type { Draft } from './session'
import { LEAVING_GRACE } from './slot'

function stored(entries: Record<string, string>): Storage {
  const storage = memoryStorage()
  for (const [key, value] of Object.entries(entries)) storage.setItem(key, value)
  return storage
}

const locks = {
  request: (_name: string, _options: unknown, run: (lock: unknown) => unknown) =>
    Promise.resolve(run({})),
} as unknown as LockManager

const tab = (fields: object) => ({ name: 'n.md', doc: '', dirty: false, ...fields })
const frame = (tabs: object[], active = 0, recent?: number[]) => ({
  kind: 'pane',
  pane: { id: 'q', linked: false, active, ...(recent ? { recent } : {}), tabs },
})
const laid = (shown: object) => ({ panel: null, focused: 'q', frame: shown })
const whole = (fields: object) =>
  JSON.stringify({
    spaces: [],
    activeSpace: null,
    panel: null,
    positions: {},
    closed: [],
    layout: laid(frame([])),
    ...fields,
  })
const session = (tabs: object[], active?: number, recent?: number[]) =>
  whole({ layout: laid(frame(tabs, active, recent)) })

async function leave(key: string, value: string, mine: number, reloads = 1) {
  const storage = stored({ [key]: value })
  const calls: Draft[][] = []
  for (let reload = 0; reload < reloads; reload += 1) {
    await takeSessionsLeft(
      mine,
      (drafts) => {
        calls.push(drafts)
        return Promise.resolve()
      },
      storage,
      locks,
    )
  }
  const left = storage.getItem(key)
  return { calls, taken: calls.flat().map((one) => one.doc), left, kept: left ?? '' }
}

interface Left {
  tabs: { path: string }[]
  active: number
  recent: number[]
}
const paneLeft = (kept: string) =>
  (JSON.parse(kept) as { layout: { frame: { pane: Left } } }).layout.frame.pane

const draftWords = 'DRAFT WORDS'
const unsaved = tab({ path: null, doc: draftWords })

describe('what a window that went left', () => {
  test('moves: a reload taking it again finds nothing, and the first entry keeps its tabs', async () => {
    const { calls, taken, kept } = await leave(
      'orden:workspace',
      session([tab({ path: '/s/a.md', name: 'a.md' }), unsaved]),
      1,
      3,
    )

    expect(calls).toHaveLength(1)
    expect(taken).toEqual([draftWords])
    expect(kept).toContain('/s/a.md')
    expect(kept).not.toContain(draftWords)
  })

  test('stays where it is if it could not be taken', async () => {
    const storage = stored({ 'orden:workspace:2': session([unsaved]) })
    const take = vi.fn(() => Promise.reject(new Error('no')))
    await takeSessionsLeft(0, take, storage, locks).catch(() => undefined)

    expect(storage.getItem('orden:workspace:2')).toContain(draftWords)
  })

  test('a session left this moment may be a reload coming back: it is left for its grace', async () => {
    const now = 1_000_000
    const storage = stored({
      'orden:workspace:1': session([unsaved]),
      'orden:window-left:1': String(now - 100),
    })
    const take = vi.fn(() => Promise.resolve())

    expect(await takeSessionsLeft(0, take, storage, locks, now)).toBe(true)
    expect(take).not.toHaveBeenCalled()
    expect(storage.getItem('orden:workspace:1')).not.toBeNull()

    expect(await takeSessionsLeft(0, take, storage, locks, now + LEAVING_GRACE)).toBe(false)
    expect(take).toHaveBeenCalledTimes(1)
    expect(storage.getItem('orden:workspace:1')).toBeNull()
  })
})

describe('wherever the session held them', () => {
  const aside = (tabs: object[]) => ({
    on: 's1',
    aside: { s2: { layout: { panel: null, focused: 'q', frame: frame(tabs) }, right: null } },
  })

  test('in a set out of sight, of a slot past the first', async () => {
    const sets = aside([
      tab({ path: null, doc: draftWords, space: 's2' }),
      tab({ path: '/s/a.md', doc: 'typed', dirty: true }),
      tab({ path: '/s/b.md' }),
    ])
    const { taken, left } = await leave('orden:workspace:1', whole({ sets }), 0)

    expect(taken).toEqual([draftWords, 'typed'])
    expect(left).toBeNull()
  })

  test('in a set out of sight, of the first slot: they move, and the rest stays', async () => {
    const sets = aside([unsaved, tab({ path: '/s/b.md' })])
    const { taken, kept } = await leave('orden:workspace', whole({ sets }), 1, 2)

    expect(taken).toEqual([draftWords])
    expect(kept).not.toContain(draftWords)
    expect(kept).toContain('/s/b.md')
  })

  test('in a split, on both sides of it', async () => {
    const split = {
      kind: 'split',
      id: 'x',
      along: 'row',
      fraction: 0.5,
      sides: [
        frame([tab({ path: null, doc: 'LEFT' })]),
        frame([tab({ path: null, doc: 'RIGHT' })]),
      ],
    }
    const { taken, kept } = await leave('orden:workspace', whole({ layout: laid(split) }), 1)

    expect(taken).toEqual(['LEFT', 'RIGHT'])
    expect(kept).not.toMatch(/LEFT|RIGHT/)
  })

  test('in a strip of an older build', async () => {
    const raw = JSON.parse(whole({ tabs: [unsaved] })) as { layout?: unknown }
    delete raw.layout
    expect((await leave('orden:workspace:3', JSON.stringify(raw), 0)).taken).toEqual([draftWords])
  })

  const closed = (fields: object, more = {}) => ({
    draft: tab(fields),
    paneId: 'p',
    at: 0,
    ...more,
  })

  test('on the closed stack, where no Recently deleted has them', async () => {
    const stack = [
      closed({ path: null, doc: 'CLOSED, IN NO TRASH' }),
      closed({ path: null, doc: 'IN THE TRASH' }, { trashed: 't1' }),
      closed({ path: '/s/a.md', doc: 'owed', dirty: true }),
      closed({ path: '/s/b.md' }),
    ]
    const { taken } = await leave('orden:workspace:1', whole({ closed: stack }), 0)
    expect(taken).toEqual(['CLOSED, IN NO TRASH', 'owed'])
  })

  test('off the first slot, the closed stack keeps what it can still bring back', async () => {
    const stack = [closed({ path: null, doc: 'CLOSED, IN NO TRASH' }), closed({ path: '/s/b.md' })]
    const { kept } = await leave('orden:workspace', whole({ closed: stack }), 1)
    expect(kept).not.toContain('CLOSED, IN NO TRASH')
    expect(kept).toContain('/s/b.md')
  })

  test('a tab that holds no words of a file is not words: a terminal stays behind', async () => {
    const terminal = tab({ kind: 'terminal', path: null, doc: '{"shell":"bash"}' })
    expect((await leave('orden:workspace:1', session([terminal]), 0)).taken).toEqual([])
  })

  test('a strip that loses tabs keeps which one was in front, and the order of use', async () => {
    const tabs = [
      tab({ path: null, doc: 'FIRST' }),
      tab({ path: '/s/a.md' }),
      tab({ path: null, doc: 'SECOND' }),
      tab({ path: '/s/b.md' }),
      tab({ path: '/s/c.md' }),
    ]
    const pane = paneLeft(
      (await leave('orden:workspace', session(tabs, 3, [3, 0, 4, 2, 1]), 1)).kept,
    )
    expect(pane.tabs.map((one) => one.path)).toEqual(['/s/a.md', '/s/b.md', '/s/c.md'])
    expect(pane.tabs[pane.active]?.path).toBe('/s/b.md')
    expect(pane.recent.map((at) => pane.tabs[at]?.path)).toEqual(['/s/b.md', '/s/c.md', '/s/a.md'])
  })

  test('where the tab in front was the one taken, what is left shows the next', async () => {
    const tabs = [
      tab({ path: '/s/a.md' }),
      tab({ path: null, doc: 'WORDS' }),
      tab({ path: '/s/b.md' }),
    ]
    const pane = paneLeft((await leave('orden:workspace', session(tabs, 1), 1)).kept)
    expect(pane.tabs[pane.active]?.path).toBe('/s/b.md')
  })
})

describe('words on a file that went on without them', () => {
  const note = (fields: object) =>
    ({ ...tab({ path: '/s/a.md', doc: 'unwritten', dirty: true }), ...fields }) as unknown as Draft
  const drafted = (notes: Draft[], says: string | null, spaceOf?: () => string) =>
    asDrafts(notes, () => Promise.resolve(says), spaceOf)

  test('stay, as a draft of their own, where the file says something else', async () => {
    const out = await drafted([note({ share: 'k' })], 'what the file says')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ path: null, doc: 'unwritten', dirty: true })
    expect(out[0]).not.toHaveProperty('share')
  })

  test('stay where the file has gone', async () => {
    expect((await drafted([note({})], null))[0]).toMatchObject({ path: null, doc: 'unwritten' })
  })

  test.each([
    ['the file says them', { doc: 'same' }, 'same'],
    ['the file says them in CRLF', { doc: 'a\nb\n' }, 'a\r\nb\r\n'],
    [
      'the file has gone on with them in it',
      { kind: 'note', doc: 'base\nmine\n', base: 'base\n' },
      'base\nmine\nand a newer line\n',
    ],
  ])('are not kept where %s', async (_, fields, says) => {
    expect(await drafted([note(fields)], says)).toEqual([])
  })

  test('come once, for a note open in two panes', async () => {
    const out = await drafted(
      [
        note({ share: 'k' }),
        note({ share: 'k' }),
        note({ path: '/s/b.md', doc: 'other', share: 'j' }),
      ],
      'what the file says',
    )
    expect(out.map((one) => one.doc)).toEqual(['unwritten', 'other'])
  })

  test('belong to the space that holds their file', async () => {
    const out = await drafted([note({})], 'what the file says', () => 'space-1')
    expect(out[0]).toMatchObject({ path: null, space: 'space-1' })
  })

  test('forget the version they were typed on', async () => {
    const out = await drafted([note({ doc: 'mine', base: 'old' })], 'other')
    expect(out[0]).not.toHaveProperty('base')
  })
})

describe('one document in two places of a left session', () => {
  const held = {
    kind: 'note' as const,
    path: '/spaces/One/a.md',
    name: 'a.md',
    dirty: true,
    cursor: 0,
    scroll: 0,
    share: 'k1',
    base: 'base\n',
  }
  const kept = async (...docs: string[]) =>
    (
      await asDrafts(
        docs.map((doc) => ({ ...held, doc })),
        () => Promise.resolve('base\n'),
      )
    ).map((one) => one.doc)

  test('the newer words are the ones kept, whichever is found first', async () => {
    const older = 'base\nolder\n'
    const newer = 'base\nolder\nnewer\n'
    expect(await kept(older, newer)).toEqual([newer])
    expect(await kept(newer, older)).toEqual([newer])
  })

  test('words that went two ways are both kept', async () => {
    expect(await kept('base\none way\n', 'base\nanother\n')).toEqual([
      'base\none way\n',
      'base\nanother\n',
    ])
  })

  test('two panes on one note are one set of words', async () => {
    expect(await kept('base\nwords\n', 'base\nwords\n')).toHaveLength(1)
  })

  test('two drafts each saying the other: one of them stays', async () => {
    expect(await kept('base\nfoo ', 'base\n foo')).toHaveLength(1)
  })

  test('however many there are of them', async () => {
    expect((await kept('base\nfoo  ', 'base\n foo ', 'base\n  foo')).length).toBeGreaterThan(0)
  })

  test('the one holding the other is kept, even where the other came later', async () => {
    expect(await kept('base\nkeep this\n', 'base\nkeep\n')).toEqual(['base\nkeep this\n'])
  })
})
