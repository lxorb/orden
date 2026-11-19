import { expect, test } from 'vitest'
import { hash32, frame, seedUpdate } from '@orden/sync-core'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { put, type Change } from './store'
import { numbersRow, wantedRow } from './records'
import type { World } from './world'
import * as Y from 'yjs'

const ROOT = '/device/space'
const SPACE = 'sim'

async function here(account: ReferenceAccount) {
  const store = new MemoryStore('d0')
  const disk = new MemoryDisk()
  disk.folders.add(ROOT)
  const seeding = store.open()
  const changes: Change[] = [
    put('spaces', {
      space_id: SPACE,
      root: ROOT,
      cursor: SEEDED.length,
      role: 'owner',
      store: null,
    }),
    put('meta', wantedRow(SPACE, new Map())),
  ]
  SEEDED.forEach((note, index) => {
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
        client_id: hash32('d0', note.id, index),
        confirmed,
        confirmed_sv: Y.encodeStateVectorFromUpdateV2(confirmed),
        pending: null,
        pending_at: null,
      }),
      put('meta', numbersRow(note.id, { seq: 1, pulled: index + 1, pending: false, flight: null })),
      put('written', { id: note.id, text: note.text }),
    )
    disk.files.set(`${ROOT}/${note.name}`, note.text)
  })
  await seeding.write(changes)
  await seeding.cleanExit(true)
  const world: World = {
    disk,
    account: {
      ask: async (route, body) =>
        route === 'prepare'
          ? null
          : (await import('@orden/sync-core')).unframe(await account.handle('d0', route, frame(body))),
    },
    name: 'd0',
    now: () => 1000,
    random: Math.random,
    digest: (text) => Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
    join: (root, path) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
  }
  return { disk, engine: await Engine.start(world, store.open(), { freshens: false }) }
}

test('a hidden name from another device is never made here, and never takes or removes a hidden folder of this one', async () => {
  const account = new ReferenceAccount(new Clock(), SEEDED)
  const { disk, engine } = await here(account)
  disk.folders.add(`${ROOT}/.localonly`)
  disk.files.set(`${ROOT}/.localonly/private.md`, 'never synced')

  await account.handle(
    'dX',
    'ops',
    frame({
      ops: [
        { op: 'o1', t: 'mkdir', id: 'evil1', parent: null, name: '.localonly', seen: 0 },
        { op: 'o2', t: 'mkdir', id: 'evil2', parent: null, name: '.planted', seen: 0 },
      ],
    }),
  )
  await engine.pass(SPACE)
  const space = engine.core.spaces.get(SPACE)
  expect(space?.entries.get('evil1')?.local_path ?? '').toBe('')
  expect(disk.folders.has(`${ROOT}/.planted`)).toBe(false)

  await account.handle(
    'dX',
    'ops',
    frame({ ops: [{ op: 'o3', t: 'delete', id: 'evil1', seen: Number.MAX_SAFE_INTEGER }] }),
  )
  await engine.pass(SPACE)
  expect(disk.files.has(`${ROOT}/.localonly/private.md`)).toBe(true)
})

test('a folder another device deletes keeps what this one holds in it that never synced', async () => {
  const account = new ReferenceAccount(new Clock(), SEEDED)
  const { disk, engine } = await here(account)
  await account.handle(
    'dX',
    'ops',
    frame({
      ops: [
        { op: 'o1', t: 'mkdir', id: 'code1', parent: null, name: 'Code', seen: 0 },
        { op: 'o2', t: 'mkdir', id: 'sub1', parent: 'code1', name: 'Sub', seen: 0 },
        { op: 'o3', t: 'mkdir', id: 'gone1', parent: null, name: 'Gone', seen: 0 },
      ],
    }),
  )
  await engine.pass(SPACE)
  expect(disk.folders.has(`${ROOT}/Code/Sub`)).toBe(true)
  disk.files.set(`${ROOT}/Code/.git/HEAD`, 'ref: refs/heads/main')

  await account.handle(
    'dX',
    'ops',
    frame({
      ops: [
        { op: 'o4', t: 'delete', id: 'code1', seen: Number.MAX_SAFE_INTEGER },
        { op: 'o5', t: 'delete', id: 'gone1', seen: Number.MAX_SAFE_INTEGER },
      ],
    }),
  )
  await engine.pass(SPACE)
  expect(disk.files.get(`${ROOT}/Code/.git/HEAD`)).toBe('ref: refs/heads/main')
  expect(disk.folders.has(`${ROOT}/Code/Sub`)).toBe(false)
  expect(disk.folders.has(`${ROOT}/Gone`)).toBe(false)
})

test('a note made, copied or put back under a hidden name here is never sent, as one placed there by hand is not', async () => {
  const account = new ReferenceAccount(new Clock(), SEEDED)
  const { disk, engine } = await here(account)
  disk.files.set(`${ROOT}/.private/Diary.md`, 'only mine')
  await engine.created(`${ROOT}/.private`, true)
  await engine.created(`${ROOT}/.private/Diary.md`, false, 'only mine')
  await engine.pass(SPACE)
  const view = await account.view()
  expect(view.entries.map((one) => one.name)).not.toContain('.private')
  expect(view.entries.map((one) => one.name)).not.toContain('Diary.md')
  expect(Object.values(view.texts)).not.toContain('only mine')
})
