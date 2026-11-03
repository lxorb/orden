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
    const storage = memoryStorage({ 'nib:workspace:2': session([tab({ path: null, doc: draftWords })]) })
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
})
