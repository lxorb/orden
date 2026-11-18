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

function fixture(bytes: string, role = 'owner') {
  const disk = new MemoryDisk()
  disk.folders.add(ROOT)
  const encoded = new TextEncoder().encode(bytes)
  void disk.writeBytes(`${ROOT}/App.application`, encoded)
  const entry = row('a', 'App.application', '', `hash:${bytes}`)
  const space = new SpaceState(
    { space_id: 's', root: ROOT, cursor: 9, role, store: null },
    [entry],
    [],
    'd',
    { platform: 'linux', foldsCase: false } as never,
  )
  const committed: Change[] = []
  const downs: string[] = []
  const sent: string[] = []
  const answers: { replaced: unknown } = { replaced: { ok: true, seq: 2 } }
  const held = new Set<string>()
  const core = {
    touched: new Set<string>(),
    refusedBytes: new Map(),
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
        up: (hash: string) => {
          sent.push(`up ${hash}`)
          return Promise.resolve(true)
        },
        replace: (_space: string, id: string, hash: string) => {
          sent.push(`replace ${id} ${hash}`)
          return Promise.resolve(answers.replaced)
        },
      },
    },
  }
  return { disk, entry, space, core, downs, held, sent, answers, committed }
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

describe('a file changed on another device', () => {
  test('is not written over a change made here while its bytes come down', async () => {
    const { disk, entry, space, core, held } = fixture('old')
    entry.local_path = 'App.application'
    entry.written_hash = 'hash:old'
    entry.file_key = 'hash:new'
    const down = core.world.blobs.down
    core.world.blobs.down = async (spaceId: string, id: string) => {
      await disk.writeBytes(`${ROOT}/App.application`, new TextEncoder().encode('edited here'))
      return down(spaceId, id)
    }

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    const kept = await disk.readBytes(`${ROOT}/App.application`)
    expect(new TextDecoder().decode(kept ?? new Uint8Array())).toBe('edited here')
    expect(held.has('a')).toBe(true)
  })

  test('nor over a file another program puts at its place while its bytes come down', async () => {
    const { disk, entry, space, core } = fixture('old')
    await disk.remove(`${ROOT}/App.application`)
    const down = core.world.blobs.down
    core.world.blobs.down = async (spaceId: string, id: string) => {
      await disk.writeBytes(`${ROOT}/App.application`, new TextEncoder().encode('made here'))
      return down(spaceId, id)
    }

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    const kept = await disk.readBytes(`${ROOT}/App.application`)
    expect(new TextDecoder().decode(kept ?? new Uint8Array())).toBe('made here')
    expect(entry.written_hash).not.toBe('hash:from the account')
  })
})

describe('a file changed here in a space this account can only read', () => {
  function changed(role: string) {
    const made = fixture('old', role)
    made.entry.local_path = 'App.application'
    made.entry.written_hash = 'hash:old'
    void made.disk.writeBytes(`${ROOT}/App.application`, new TextEncoder().encode('edited here'))
    made.core.touched.add('a')
    const trashed: string[] = []
    const remove = made.disk.remove.bind(made.disk)
    made.disk.remove = (path: string) => {
      trashed.push(path)
      return remove(path)
    }
    return { ...made, trashed }
  }
  const text = async (disk: MemoryDisk, path: string) =>
    new TextDecoder().decode((await disk.readBytes(path)) ?? new Uint8Array())
  const said = (committed: Change[]) =>
    committed.flatMap((one) =>
      one.t === 'put' && one.table === 'log' ? [one.row.failed ?? ''] : [],
    )

  test('sends nothing, goes to the trash, says so, and the account’s file comes back', async () => {
    const { disk, space, core, downs, sent, committed, trashed } = changed('read')

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    expect(sent).toEqual([])
    expect(trashed).toEqual([`${ROOT}/App.application`])
    expect(await text(disk, `${ROOT}/App.application`)).toBe('from the account')
    expect(downs).toEqual(['a'])
    expect(said(committed)).toEqual([
      'you can only read this space, so your change to App.application went to Recently deleted',
    ])
  })

  test('and when the account refuses it before this device knew, it is said all the same', async () => {
    const { disk, space, core, sent, answers, committed, trashed } = changed('write')
    answers.replaced = { refused: 'role' }

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    expect(sent).toEqual(['up hash:edited here', 'replace a hash:edited here'])
    expect(trashed).toEqual([`${ROOT}/App.application`])
    expect(await text(disk, `${ROOT}/App.application`)).toBe('from the account')
    expect(said(committed)).toHaveLength(1)
  })
})

describe('a file changed here whose bytes the account says it lacks', () => {
  test('is tried again, not dropped', async () => {
    const { disk, entry, space, core, answers } = fixture('old', 'write')
    entry.local_path = 'App.application'
    entry.written_hash = 'hash:old'
    await disk.writeBytes(`${ROOT}/App.application`, new TextEncoder().encode('edited here'))
    answers.replaced = { lost: true }
    core.touched.add('a')

    expect(await settleFiles(core as never, space, () => true, { full: false })).toBe(true)

    expect(core.touched.has('a')).toBe(true)
  })
})
