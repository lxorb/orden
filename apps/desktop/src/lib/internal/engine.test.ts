import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test } from 'vitest'
import { hash32, seedUpdate } from '@orden/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
import { frame, unframe } from '@orden/sync-core/wire'
import * as Y from 'yjs'
import { Engine } from '../sync2/engine'
import { MemoryDisk } from '../sync2/memory-disk'
import { MemoryStore } from '../sync2/memory-store'
import { numbersRow, wantedRow } from '../sync2/records'
import { put, type Change } from '../sync2/store'
import type { Disk, World } from '../sync2/world'
import { readsAsText, webInvoke } from '../web/commands'
import { mountRows } from '../web/store'
import { InternalFolder } from './folder'
import { MemoryBytes } from './memory'
import { internalRows } from './rows'

/** The sync engine over a space Orden keeps itself (#1068, step 4c): its disk is the
 *  space's folder, reached through the same file commands every other caller uses, so a
 *  rename another device made is one line of the index here, and nothing the engine
 *  moves is written again or changes its identity. */

const SPACE = 'sim'
const undo: (() => void)[] = []

afterEach(() => {
  for (const one of undo.splice(0)) one()
})

/** The engine's disk as the app's world makes it (`diskOf` in sync2/app-world.ts): the
 *  file commands, which for a kept space are its folder's. */
function commandsDisk(): Disk {
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  return {
    read: (path) => webInvoke<string>('read_note', { path }).catch(() => null),
    async write(path, text) {
      await webInvoke('create_folder', { path: folderOf(path) })
      await webInvoke('write_note', { path, content: text })
    },
    keep: () => Promise.resolve(),
    move: (from, to) => webInvoke('rename_note', { from, to, alone: true }),
    remove: (path, kind) =>
      kind === 'file'
        ? webInvoke('delete_note', { path })
        : webInvoke('trash_item', { path, kind: 'folder', alone: true }),
    mkdir: (path) => webInvoke('create_folder', { path }),
    exists: (path) => webInvoke<boolean>('path_exists', { path }),
  }
}

/** One device holding the simulator's seeded notes in `disk`, at `root`. */
async function device(account: ReferenceAccount, id: string, root: string, disk: Disk) {
  const store = new MemoryStore(id)
  const seeding = store.open()
  const changes: Change[] = [
    put('spaces', { space_id: SPACE, root, cursor: SEEDED.length, role: 'owner', store: null }),
    put('meta', wantedRow(SPACE, new Map())),
  ]
  for (const [index, note] of SEEDED.entries()) {
    const confirmed = seedUpdate(note.id, 1, note.text)
    changes.push(
      put('entries', {
        id: note.id,
        space_id: SPACE,
        kind: 'note',
        parent: null,
        name: note.name,
        local_path: note.name,
        file_key: null,
        written_hash: null,
        mtime: null,
        size: null,
        seq: index + 1,
        deleted: false,
      }),
      put('docs', {
        id: note.id,
        epoch: 1,
        client_id: hash32(id, note.id, index),
        confirmed,
        confirmed_sv: Y.encodeStateVectorFromUpdateV2(confirmed),
        pending: null,
        pending_at: null,
      }),
      put('meta', numbersRow(note.id, { seq: 1, pulled: index + 1, pending: false, flight: null })),
      put('written', { id: note.id, text: note.text }),
    )
    await disk.write(`${root}/${note.name}`, note.text)
  }
  await seeding.write(changes)
  await seeding.cleanExit(true)
  const world: World = {
    disk,
    account: {
      ask: async (route, body) =>
        route === 'prepare' ? null : unframe(await account.handle(id, route, frame(body))),
    },
    name: id,
    now: () => 1000,
    random: Math.random,
    digest: (text) => Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
    join: (at, path) => `${at}/${path}`,
    foldsCase: true,
    platform: 'other',
  }
  return Engine.start(world, store.open(), { freshens: false })
}

describe('the engine over a space Orden keeps', () => {
  test('moves nothing for a rename another device made: the index alone, the same key', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const bytes = new MemoryBytes()
    let keys = 0
    const folder = await InternalFolder.open('one', bytes, {
      now: () => 2000,
      key: () => `k${String((keys += 1))}`,
      foldsCase: true,
    })
    const root = '/internal-e'
    undo.push(mountRows(root, internalRows(folder, root, readsAsText)))
    const here = await device(account, 'd0', root, commandsDisk())
    const plan = SEEDED[0]
    if (!plan) throw new Error('no seed')
    const key = (await folder.at(plan.name))?.key
    const written = bytes.writes

    const there = new MemoryDisk()
    const other = await device(account, 'd1', '/device/space', there)
    await other.moving(`/device/space/${plan.name}`, '/device/space/Done/Goals.md', () =>
      there.move(`/device/space/${plan.name}`, '/device/space/Done/Goals.md'),
    )
    await other.pass(SPACE)

    await here.pass(SPACE)
    await here.pass(SPACE)

    expect((await folder.at('Done/Goals.md'))?.key).toBe(key)
    expect(await folder.at(plan.name)).toBeNull()
    expect(bytes.writes).toBe(written)
    expect(here.entryAt(`${root}/Done/Goals.md`)?.id).toBe(plan.id)
    expect(await webInvoke('read_note', { path: `${root}/Done/Goals.md` })).toBe(plan.text)
  })
})
