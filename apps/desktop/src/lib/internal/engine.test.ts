import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { hash32, seedUpdate, frame, unframe } from '@orden/sync-core'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
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
import { mountRoot } from './roots'
import { internalRows } from './rows'

const watch = vi.hoisted(() => ({ roots: [] as string[][], scans: [] as string[] }))
vi.mock('../space-watch', () => ({
  watchSpaces: (roots: string[]) => {
    watch.roots.push(roots)
    return Promise.resolve()
  },
  unwatchSpaces: () => Promise.resolve(),
  scanSpace: (root: string) => {
    watch.scans.push(root)
    return Promise.resolve([])
  },
}))
vi.mock('../notify', () => ({ notify: () => undefined }))

const SPACE = 'sim'
const undo: (() => void)[] = []

afterEach(() => {
  for (const one of undo.splice(0)) one()
  watch.roots.length = 0
  watch.scans.length = 0
})

const settled = () => new Promise((resolve) => setTimeout(resolve, 30))

async function kept(root: string) {
  const bytes = new MemoryBytes()
  let keys = 0
  const folder = await InternalFolder.open(root, bytes, {
    now: () => 2000,
    key: () => `k${String((keys += 1))}`,
    foldsCase: true,
  })
  undo.push(mountRows(root, internalRows(folder, root, readsAsText)))
  undo.push(mountRoot({ root, web: root, folder }))
  return { bytes, folder }
}

function commandsDisk(): Disk {
  const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'))
  return {
    read: (path) => webInvoke<string>('read_note', { path }).catch(() => null),
    async write(path, text) {
      await webInvoke('create_folder', { path: folderOf(path) })
      await webInvoke('write_note', { path, content: text })
    },
    keep: () => Promise.resolve(),
    evicted: () => Promise.resolve(false),
    move: (from, to) => webInvoke('rename_note', { from, to, alone: true }),
    remove: (path, kind) =>
      kind === 'file'
        ? webInvoke('delete_note', { path })
        : webInvoke('trash_item', { path, kind: 'folder', alone: true }),
    mkdir: (path) => webInvoke('create_folder', { path }),
    exists: (path) => webInvoke<boolean>('path_exists', { path }),
  }
}

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
    const root = '/internal-e'
    const { bytes, folder } = await kept(root)
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

  test('hears its folder in place of the crate: a file made, words written, a folder renamed', async () => {
    const { watchFolders } = await import('../sync2/watching')
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const root = '/internal-w'
    await kept(root)
    const here = await device(account, 'd0', root, commandsDisk())
    const moves: string[] = []
    const watched = watchFolders({
      engine: here,
      ready: () => true,
      changed: () => undefined,
      moved: (from, to, kind) => {
        moves.push(`${kind} ${from} -> ${to}`)
        return Promise.resolve()
      },
    })
    await settled()
    expect(watch.roots.flat()).not.toContain(root)
    expect(watch.scans).toEqual([])

    await webInvoke('write_note', { path: `${root}/Work/Ideas.md`, content: 'eggs' })
    await settled()
    const ideas = here.entryAt(`${root}/Work/Ideas.md`)
    expect(ideas?.kind).toBe('note')
    expect((await here.core.doc(ideas?.id ?? ''))?.text()).toBe('eggs')

    await webInvoke('write_note', { path: `${root}/Work/Ideas.md`, content: 'eggs and ham' })
    await settled()
    expect((await here.core.doc(ideas?.id ?? ''))?.text()).toBe('eggs and ham')

    await webInvoke('rename_note', { from: `${root}/Work`, to: `${root}/Done` })
    await settled()
    expect(here.entryAt(`${root}/Done/Ideas.md`)?.id).toBe(ideas?.id)
    expect(moves).toEqual([`folder ${root}/Work -> ${root}/Done`])
    watched.stop()
  })

  test('is searched over its rows, and the held words follow every change', async () => {
    const { searchInternal } = await import('./search')
    const { parseQuery } = await import('@orden/scan/search/query')
    const root = 'C:\\Orden\\Plans'
    const { folder } = await kept('/internal-s')
    undo.push(mountRoot({ root, web: '/internal-s', folder }))
    await webInvoke('write_note', { path: '/internal-s/Work/Plan.md', content: 'ship the eggs' })

    const hits = async (words: string) => {
      const found: string[] = []
      const query = parseQuery(words)
      await searchInternal(
        root,
        query,
        [],
        50,
        ({ hits }) => found.push(...hits.map((hit) => hit.path)),
        [],
      )
      return found
    }
    expect(await hits('eggs')).toEqual([`${root}\\Work\\Plan.md`])

    await webInvoke('write_note', { path: '/internal-s/Work/Plan.md', content: 'ship the ham' })
    await settled()
    expect(await hits('eggs')).toEqual([])
    await webInvoke('rename_note', { from: '/internal-s/Work/Plan.md', to: '/internal-s/Ham.md' })
    await settled()
    expect(await hits('ham')).toEqual([`${root}\\Ham.md`])
    expect(
      await searchInternal('C:\\Elsewhere', parseQuery('ham'), [], 5, () => undefined, []),
    ).toBe(false)
  })

  test("keeps the space's inbox as a document only its store holds: carried, never listed or walked", async () => {
    const { watchFolders } = await import('../sync2/watching')
    const { listInternal } = await import('./watch')
    const { searchInternal } = await import('./search')
    const { parseQuery } = await import('@orden/scan/search/query')
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const root = '/internal-i'
    const { folder, bytes } = await kept(root)
    const here = await device(account, 'd0', root, commandsDisk())
    const watched = watchFolders({ engine: here, ready: () => true, changed: () => undefined })
    await settled()

    await webInvoke('write_note', { path: `${root}/.Inbox.md`, content: '- [ ] buy kumquats' })
    await settled()

    const inbox = await folder.at('.Inbox.md')
    expect(bytes.texts.get(inbox?.key ?? '')).toBe('- [ ] buy kumquats')
    expect(here.entryAt(`${root}/.Inbox.md`)?.kind).toBe('note')
    expect((await listInternal(root))?.map((one) => one.path)).toContain(`${root}/.Inbox.md`)
    const tree = await webInvoke<{ children: { name: string }[] }>('read_tree', { root })
    expect(tree.children.map((one) => one.name)).not.toContain('.Inbox.md')
    const links = await webInvoke<{ notes: { path: string }[] }>('scan_links', { root })
    expect(links.notes.map((one) => one.path)).not.toContain('.Inbox.md')
    const walked: string[] = []
    await searchInternal(
      root,
      parseQuery('kumquats'),
      [],
      9,
      ({ hits }) => walked.push(...hits.map((one) => one.path)),
      [],
    )
    expect(walked).toEqual([])
    watched.stop()
  })

  test("hands a kept space the launch has not mounted yet to neither the crate's watch nor its scan", async () => {
    const { watchFolders } = await import('../sync2/watching')
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const root = '/spaces/.orden/Later/Later'
    const here = await device(account, 'd0', root, new MemoryDisk())
    const watched = watchFolders({ engine: here, ready: () => true, changed: () => undefined })
    await settled()

    expect(watch.roots.flat()).not.toContain(root)
    expect(watch.scans).toEqual([])
    watched.stop()
  })
})
