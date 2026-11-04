import { describe, expect, test, vi } from 'vitest'
import type { Engine } from './engine'
import { scanned, kept, type Watching } from './watching'

vi.mock('../surfaces.svelte', () => ({ syncMark: { ask: () => undefined } }))

const listing = vi.hoisted(() => ({ answer: (): Promise<unknown[]> => Promise.resolve([]) }))
vi.mock('../space-watch', async (original) => ({
  ...(await original<typeof import('../space-watch')>()),
  scanSpace: () => listing.answer(),
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
