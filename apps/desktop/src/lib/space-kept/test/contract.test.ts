import { providePort, type SyncStorePort } from '@orden/contracts'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  Archive,
  ArchivedSpaces,
  Bookmarks,
  DEEPEST,
  Excluded,
  FolderIcons,
  isTile,
  ItemMetaStore,
  sameBookmark,
  SHALLOWEST,
  SpaceGraphSettings,
} from '../src/api'

function storage(): Storage {
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
const server = vi.hoisted(() => ({
  token: null as string | null,
  sent: 0,
  keeps: (icon: string) => !icon.startsWith('data:'),
}))
vi.mock('../../accounts/src/api', () => ({
  account: {
    get token() {
      return server.token
    },
    spaces: [],
    loadSpaces: () => Promise.resolve(),
  },
  api: {
    saveFolderIcons: (_token: string, _id: string, icons: Record<string, string>, tints: Record<string, string>) => {
      server.sent++
      return Promise.resolve({
        icons: Object.fromEntries(Object.entries(icons).filter(([, one]) => server.keeps(one))),
        tints,
      })
    },
  },
}))
vi.stubGlobal('localStorage', storage())
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})
describe('what a space keeps beside its files', () => {
  test('an archived folder hides what is under it, and its mark moves with it', async () => {
    const archive = new Archive(() => '/s')
    await archive.change('/s', ['Work'], [])
    expect(archive.has('/s/Work/Plan.md')).toBe(true)
    expect(archive.has('/s/Workshop.md')).toBe(false)
    archive.moved('/s/Work', '/s/Old/Work')
    await vi.waitFor(() => expect([...archive.keysOf('/s')]).toEqual(['Old/Work']))
    archive.forget('/s')
    expect(archive.of('/s')).toEqual({})
  })
  test('a space put away is remembered until it comes back', () => {
    const spaces = new ArchivedSpaces()
    expect(spaces.set('/s', true)).toBe(true)
    expect(spaces.set('/s', true)).toBe(false)
    expect(spaces.has('/s')).toBe(true)
    spaces.set('/s', false)
    expect(spaces.has('/s')).toBe(false)
  })
  test('a bookmark is the same by kind, place and words, and a tile is a note in no group', () => {
    const plan = { kind: 'note', path: 'Plan.md', text: 'Plan' } as const
    expect(sameBookmark(plan, { ...plan })).toBe(true)
    expect(sameBookmark(plan, { ...plan, kind: 'folder' })).toBe(false)
    expect(isTile(plan)).toBe(true)
    expect(isTile({ ...plan, parent: 'g1' })).toBe(false)
  })
})
describe('a folder icon', () => {
  test('may be a small picture kept whole, and a longer one is not kept', () => {
    const picture = (length: number) => `data:image/png;base64,${'A'.repeat(length - 22)}`
    const icons = new FolderIcons(() => '/s')
    icons.set('/s/Work', picture(2048))
    icons.set('/s/Notes', picture(2049))
    expect(icons.iconOf('/s/Work')).toBe(picture(2048))
    expect(icons.iconOf('/s/Notes')).toBeNull()
    const again = new FolderIcons(() => '/s')
    expect(again.iconOf('/s/Work')).toBe(picture(2048))
    expect(again.iconOf('/s/Notes')).toBeNull()
  })
})
describe("a space's graph settings", () => {
  test('with no space open there is nothing to change', () => {
    const settings = new SpaceGraphSettings(() => null)
    const before = settings.here
    settings.set({ depth: DEEPEST })
    expect(settings.here).toEqual(before)
  })
  test('a depth is held between the shallowest and the deepest', () => {
    const settings = new SpaceGraphSettings(() => '/space')
    settings.set({ depth: DEEPEST + 10 })
    expect(settings.here.depth).toBe(DEEPEST)
    settings.set({ depth: 0 })
    expect(settings.here.depth).toBe(SHALLOWEST)
  })
})
describe('what another window keeps', () => {
  const MINE = '/mine'
  const THEIRS = '/theirs'
  const inMine = (path: string | null) => (path?.startsWith(MINE) ? MINE : THEIRS)
  const saved = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null')
  const inTheirs = (one: Record<string, unknown>) => (held: unknown) => ({
    ...(held && typeof held === 'object' ? held : {}),
    [THEIRS]: { account: null, sent: false, ...one },
  })
  function elsewhere(key: string, value: unknown) {
    localStorage.setItem(key, JSON.stringify(value))
    window.dispatchEvent(Object.assign(new Event('storage'), { key }))
  }
  interface Store {
    key: string
    theirs: (held: unknown) => unknown
    open: () => { act: () => unknown; seen: () => boolean }
  }
  const stores: Record<string, Store> = {
    archive: {
      key: 'orden:archived',
      theirs: inTheirs({ map: { Work: 1 } }),
      open: () => {
        const store = new Archive(() => MINE)
        return { act: () => store.change(MINE, ['Plan.md'], []), seen: () => store.of(THEIRS).Work === 1 }
      },
    },
    'archived spaces': {
      key: 'orden:archived-spaces',
      theirs: (held) => [...(Array.isArray(held) ? (held as unknown[]) : []), THEIRS],
      open: () => {
        const store = new ArchivedSpaces()
        return { act: () => store.set(MINE, true), seen: () => store.has(THEIRS) }
      },
    },
    bookmarks: {
      key: 'orden:bookmarks',
      theirs: inTheirs({ list: [{ kind: 'search', path: '', text: 'theirs' }] }),
      open: () => {
        const store = new Bookmarks(() => MINE)
        return { act: () => store.toggle(store.forSearch('mine')), seen: () => store.of(THEIRS).length === 1 }
      },
    },
    'item meta': {
      key: 'orden:item-meta',
      theirs: inTheirs({ items: { 'Plan.md': { icon: 'star' } }, unsent: {}, adopted: false, moved: false }),
      open: () => {
        const store = new ItemMetaStore(inMine)
        return {
          act: () => store.set(`${MINE}/Plan.md`, { icon: 'rocket' }),
          seen: () => store.itemsOf(THEIRS)['Plan.md']?.icon === 'star',
        }
      },
    },
    'buried item meta': {
      key: 'orden:item-meta-buried',
      theirs: (held) => ({ ...(held && typeof held === 'object' ? held : {}), theirs: { '': { icon: 'star' } } }),
      open: () => {
        const store = new ItemMetaStore(inMine)
        return {
          act: () => {
            store.set(`${MINE}/Plan.md`, { icon: 'rocket' })
            store.gone(`${MINE}/Plan.md`, MINE, 'mine')
          },
          seen: () => {
            store.cameBack(`${MINE}/Back.md`, MINE, 'theirs')
            return store.of(`${MINE}/Back.md`)?.icon === 'star'
          },
        }
      },
    },
    excluded: {
      key: 'orden:excluded',
      theirs: inTheirs({ paths: ['Drafts'] }),
      open: () => {
        const store = new Excluded(() => MINE)
        return { act: () => store.toggle(`${MINE}/Drafts`), seen: () => store.of(THEIRS).includes('Drafts') }
      },
    },
    'folder icons': {
      key: 'orden:folder-icons',
      theirs: inTheirs({ icons: { Work: 'star' }, colors: {} }),
      open: () => {
        const store = new FolderIcons(() => MINE)
        return { act: () => store.set(`${MINE}/Work`, 'rocket'), seen: () => store.of(THEIRS).Work === 'star' }
      },
    },
    graph: {
      key: 'orden:graph',
      theirs: inTheirs({ settings: { filter: 'theirs' } }),
      open: () => {
        const store = new SpaceGraphSettings(() => MINE)
        return {
          act: () => {
            store.set({ filter: 'mine' })
            store.flush()
          },
          seen: () => store.of(THEIRS).filter === 'theirs',
        }
      },
    },
  }
  beforeEach(() => vi.stubGlobal('window', new EventTarget()))
  afterEach(() => vi.stubGlobal('window', undefined))
  test.each(Object.entries(stores))('%s shows what another window wrote as soon as it is heard', (_, store) => {
    const here = store.open()
    elsewhere(store.key, store.theirs(saved(store.key)))
    expect(here.seen()).toBe(true)
  })
  test.each(Object.entries(stores))('%s writing here keeps what another window wrote', async (_, store) => {
    const here = store.open()
    localStorage.setItem(store.key, JSON.stringify(store.theirs(saved(store.key))))
    await here.act()
    expect(saved(store.key)).not.toBeNull()
    expect(store.open().seen()).toBe(true)
  })
  test('a space put away in another window is told here', () => {
    const heard = vi.fn()
    const spaces = new ArchivedSpaces(heard)
    elsewhere('orden:archived-spaces', ['/away'])
    expect(spaces.has('/away')).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
    elsewhere('orden:archived-spaces', ['/away'])
    expect(heard).toHaveBeenCalledTimes(1)
  })
})
describe('a map the account is still to be told', () => {
  test('is not taken for sent, so a second pairing before the push lands keeps it, and writes nothing', () => {
    const icons = new FolderIcons(() => '/s')
    icons.adopt('/s', {}, {}, 'me')
    icons.set('/s/Work', 'rocket')
    const excluded = new Excluded(() => '/s')
    excluded.adopt('/s', [], 'me')
    excluded.toggle('/s/Drafts')
    const graph = new SpaceGraphSettings(() => '/s')
    graph.adopt('/s', {}, 'me')
    graph.set({ filter: 'mine' })
    const writes = vi.spyOn(localStorage, 'setItem')
    for (let again = 0; again < 2; again++) {
      icons.adopt('/s', {}, {}, 'me')
      excluded.adopt('/s', [], 'me')
      graph.adopt('/s', { filter: 'theirs' }, 'me')
    }
    expect(writes).not.toHaveBeenCalled()
    writes.mockRestore()
    expect(icons.iconOf('/s/Work')).toBe('rocket')
    expect(excluded.of('/s')).toEqual(['Drafts'])
    expect(graph.here.filter).toBe('mine')
  })
})
describe('a push to the account', () => {
  const picture = 'data:image/png;base64,AAAA'
  async function pushed(icons: FolderIcons, path: string, icon: string) {
    const before = server.sent
    icons.set(path, icon)
    await vi.waitFor(() => expect(server.sent).toBe(before + 1))
    await vi.advanceTimersByTimeAsync(1)
  }
  beforeEach(() => {
    server.token = 'token'
    server.keeps = (icon) => !icon.startsWith('data:')
  })
  afterEach(() => {
    server.token = null
  })
  test('lands only when the answer keeps what was sent, so what the account dropped is offered again', async () => {
    const gone = providePort('sync.store', { remoteIdFor: () => 'remote' } as unknown as SyncStorePort)
    const icons = new FolderIcons(() => '/s')
    icons.adopt('/s', {}, {}, 'me')
    await pushed(icons, '/s/Work', picture)
    const offered = server.sent
    icons.adopt('/s', {}, {}, 'me')
    expect(icons.iconOf('/s/Work')).toBe(picture)
    await vi.waitFor(() => expect(server.sent).toBe(offered + 1))
    await vi.advanceTimersByTimeAsync(1)
    const before = server.sent
    icons.adopt('/s', {}, {}, 'me')
    icons.adopt('/s', {}, {}, 'me')
    await vi.waitFor(() => expect(server.sent).toBe(before + 1))
    await vi.advanceTimersByTimeAsync(1)
    expect(server.sent).toBe(before + 1)
    server.keeps = () => true
    await pushed(icons, '/s/Plan', 'rocket')
    icons.adopt('/s', { Plan: 'rocket' }, {}, 'me')
    expect(icons.iconOf('/s/Work')).toBeNull()
    gone()
  })
})
