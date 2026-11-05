import { describe, expect, test, vi } from 'vitest'
import type { Engine } from './engine'
import { scanned, kept, watchFolders, type Watching } from './watching'

vi.mock('../surfaces.svelte', () => ({ syncMark: { ask: () => undefined } }))

const watch = vi.hoisted(() => ({ heard: (_news: unknown): void => undefined }))
const listing = vi.hoisted(() => ({ answer: (): Promise<unknown[]> => Promise.resolve([]) }))
vi.mock('../space-watch', async (original) => ({
  ...(await original<typeof import('../space-watch')>()),
  scanSpace: () => listing.answer(),
  watchSpaces: (_roots: string[], heard: (news: unknown) => void) => {
    watch.heard = heard
    return Promise.resolve()
  },
}))

const ROOT = '/home/me/.local/share/ch.emilvinu.nib/Spaces/Two'
const engine = {
  core: {
    world: { foldsCase: false, blobs: {} },
    spaces: new Map([['s', { row: { root: ROOT } }]]),
  },
} as unknown as Engine

describe('what the watch keeps', () => {
  test('a note in a space under a dotted folder: Linux’s own place for them', () => {
    expect(kept(engine, `${ROOT}/both.md`, false)).toBe(true)
  })

  test('what is dotted inside the space stays the app’s', () => {
    expect(kept(engine, `${ROOT}/.trash/both.md`, false)).toBe(false)
    expect(kept(engine, `${ROOT}/.hidden.md`, false)).toBe(false)
  })
})

describe('a launch scan', () => {
  const inside = 'shut/inside.md'
  const held = {
    id: 'n',
    deleted: false,
    kind: 'note',
    local_path: inside,
    mtime: 1,
    size: 1,
  }
  const gone = { ...held, id: 'g', local_path: 'gone.md' }
  const scanIt = async (there: boolean) => {
    const removed = vi.fn(() => Promise.resolve())
    const space = {
      id: 's',
      row: { root: ROOT },
      entries: new Map([
        ['n', held],
        ['g', gone],
      ]),
      key: (path: string) => path,
      at: () => null,
      paths: () => new Map(),
    }
    const how = {
      engine: {
        removed,
        created: () => Promise.resolve(null),
        placed: (path: string) => ({ space, path: path.slice(ROOT.length + 1) }),
        ownWork: () => false,
        core: {
          spaces: new Map([['s', space]]),
          world: {
            foldsCase: false,
            blobs: {},
            join: (root: string, path: string) => `${root}/${path}`,
            disk: { exists: () => Promise.resolve(there) },
          },
        },
      },
      ready: () => true,
    } as unknown as Watching
    await scanned(how, ROOT)
    return removed
  }

  test('nothing under a folder that would not list is a delete', async () => {
    listing.answer = () =>
      Promise.resolve([
        { path: `${ROOT}/shut`, dir: true, size: 0, mtime: 0, id: null, unlisted: true },
      ])
    const removed = await scanIt(false)
    expect(removed.mock.calls).toEqual([[`${ROOT}/gone.md`]])
  })

  test('a folder that listed empty, and an answer that a file is gone, still are', async () => {
    listing.answer = () =>
      Promise.resolve([{ path: `${ROOT}/shut`, dir: true, size: 0, mtime: 0, id: null }])
    const removed = await scanIt(false)
    expect(removed.mock.calls).toEqual([[`${ROOT}/shut/inside.md`], [`${ROOT}/gone.md`]])
  })

  test('nobody could look at the file: not a delete', async () => {
    listing.answer = () => Promise.resolve([])
    expect((await scanIt(true)).mock.calls).toEqual([])
  })

  test('a space that will not list deletes nothing', async () => {
    listing.answer = () => Promise.reject(new Error('would not list'))
    const removed = vi.fn()
    await expect(scanItRefused(removed)).rejects.toThrow('would not list')
    expect(removed).not.toHaveBeenCalled()
  })

  const scanItRefused = async (removed: () => void) => {
    const space = { id: 's', row: { root: ROOT }, entries: new Map(), key: (one: string) => one }
    const how = {
      engine: { removed, core: { spaces: new Map([['s', space]]), world: {} } },
      ready: () => true,
    } as unknown as Watching
    await scanned(how, ROOT)
  }
})

describe('what is heard while a first pass runs', () => {
  const started = () => {
    const created = vi.fn(() => Promise.resolve())
    const entries = new Map()
    const space = {
      id: 's',
      row: { root: ROOT },
      entries,
      key: (path: string) => path,
      at: () => null,
      paths: () => new Map(),
    }
    let ready = false
    const watched = watchFolders({
      engine: {
        created,
        placed: (path: string) => ({ space, path: path.slice(ROOT.length + 1) }),
        entryAt: () => null,
        ownWork: () => false,
        core: {
          spaces: new Map([['s', space]]),
          world: {
            foldsCase: false,
            blobs: {},
            join: (root: string, path: string) => `${root}/${path}`,
            disk: { exists: () => Promise.resolve(true), read: () => Promise.resolve('words') },
          },
        },
      },
      ready: () => ready,
      changed: () => undefined,
    } as unknown as Watching)
    const hear = async (news: object) => {
      watch.heard({ root: ROOT, changes: [], scan: false, gone: false, ...news })
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { created, watched, hear, passed: () => (ready = true) }
  }
  const file = { path: `${ROOT}/late.md`, dir: false, size: 5, mtime: 1, id: null }

  test('is read once it is over, not at the next launch', async () => {
    const { created, watched, hear, passed } = started()
    await hear({ scan: true })
    await hear({ changes: [{ kind: 'created', ...file }] })
    expect(created).not.toHaveBeenCalled()

    listing.answer = () => Promise.resolve([file])
    passed()
    watched.caughtUp('s')
    await vi.waitFor(() => expect(created).toHaveBeenCalledWith(file.path, false, 'words'))
    watched.stop()
  })

  test('a watch lost in the middle of it counts as well', async () => {
    const { created, watched, hear, passed } = started()
    await hear({ scan: true })
    await hear({ scan: true })

    listing.answer = () => Promise.resolve([file])
    passed()
    watched.caughtUp('s')
    await vi.waitFor(() => expect(created).toHaveBeenCalledTimes(1))
    watched.stop()
  })

  test('nothing heard but the start of the watch: the pass read all of that', async () => {
    const { created, watched, hear, passed } = started()
    await hear({ scan: true })

    const asked = vi.fn(() => Promise.resolve([file]))
    listing.answer = asked
    passed()
    watched.caughtUp('s')
    await hear({ changes: [] })
    expect(asked).not.toHaveBeenCalled()
    expect(created).not.toHaveBeenCalled()
    watched.stop()
  })
})
