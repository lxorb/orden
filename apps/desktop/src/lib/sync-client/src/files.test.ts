import { describe, expect, test } from 'vitest'
import { settleFiles } from './files'
import { MemoryDisk } from './memory-disk'
import { SpaceState } from './places'
import type { Change, EntryRow } from './store'

const ROOT = '/r'

function row(id: string, name: string, local: string, key: string): EntryRow {
  return {
    id,
    space_id: 's',
    kind: 'file',
    parent: null,
    name,
    local_path: local,
    file_key: key,
    written_hash: local ? key : null,
    mtime: null,
    size: null,
    seq: 1,
    deleted: false,
  }
}

function fixture(bytes: string) {
  const disk = new MemoryDisk()
  disk.folders.add(ROOT)
  const encoded = new TextEncoder().encode(bytes)
  void disk.writeBytes(`${ROOT}/App.application`, encoded)
  const entry = row('a', 'App.application', '', `hash:${bytes}`)
  const space = new SpaceState(
    { space_id: 's', root: ROOT, cursor: 9, role: 'owner', store: null },
    [entry],
    [],
    'd',
    { platform: 'linux', foldsCase: false } as never,
  )
  const committed: Change[] = []
  const downs: string[] = []
  const held = new Set<string>()
  const core = {
    touched: new Set<string>(),
    stampWaiting: new Map(),
    unreadFor: new Map(),
    unsyncedTold: new Set(),
    by: new Map(),
    events: {},
    isHeld: (id: string) => held.has(id),
    holdChanges: (holding: { row: { id: string } }) => {
      held.add(holding.row.id)
      return []
    },
    commit: (changes: Change[]) => {
      committed.push(...changes)
      return Promise.resolve()
    },
    world: {
      disk,
      now: () => 1000,
      join: (root: string, path: string) => `${root}/${path}`,
      blobs: {
        read: (path: string) => disk.readBytes(path),
        write: (path: string, one: Uint8Array) => disk.writeBytes(path, one),
        hash: (one: Uint8Array) => Promise.resolve(`hash:${new TextDecoder().decode(one)}`),
        down: (_space: string, id: string) => {
          downs.push(id)
          return Promise.resolve(new TextEncoder().encode('from the account'))
        },
      },
    },
  }
  return { disk, entry, space, core, downs, held }
}

describe('a file at the place its own entry wants, with no entry holding it', () => {
  test('is that entry’s file, not a stranger the next scan names " 2" (#1630)', async () => {
    const { entry, space, core, downs, held } = fixture('{"v":1}')
    entry.file_key = 'hash:{"v":1}'

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    expect(entry.local_path).toBe('App.application')
    expect(entry.written_hash).toBe('hash:{"v":1}')
    expect(space.at('App.application')).toBe(entry)
    expect(space.awaitedAt('App.application')).toBeNull()
    expect(downs).toEqual([])
    expect(held.size).toBe(0)
  })

  test('with other bytes is left alone, to be kept beside it as a file of its own', async () => {
    const { entry, space, core, downs, held } = fixture('{"v":1, "host":"other"}')
    entry.file_key = 'hash:{"v":1}'

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    expect(entry.local_path).toBe('')
    expect(held.size).toBe(0)
    expect(downs).toEqual([])
  })

  test('is awaited by its entry until then, so a scan makes no second one', () => {
    const { space } = fixture('{"v":1}')

    expect(space.awaitedAt('App.application')?.id).toBe('a')
    expect(space.awaitedAt('Other.application')).toBeNull()
  })
})
