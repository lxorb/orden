import { describe, expect, test } from 'vitest'
import { hash32, seedUpdate } from '@orden/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
import { frame, unframe } from '@orden/sync-core/wire'
import * as Y from 'yjs'
import { Engine } from './engine'
import { placesOf } from './placing'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { numbersRow, wantedRow } from './records'
import { put, type Change } from './store'
import { Refused } from './transport'
import type { World } from './world'

const ROOT = '/device/space'
const SPACE = 'sim'

interface Device {
  account: ReferenceAccount
  disk: MemoryDisk
  store: MemoryStore
  sent: { t: string; pos?: string }[]
  keeps: boolean
  old: boolean
  describes: boolean
  oldMeta: boolean
  engine: Engine
  launch(): Promise<Engine>
}

async function device(foldsCase = true): Promise<Device> {
  const account = new ReferenceAccount(new Clock(), SEEDED)
  const store = new MemoryStore('d0')
  const disk = new MemoryDisk()
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
  const seeding = store.open()
  await seeding.write(changes)
  await seeding.cleanExit(true)

  const made: Device = {
    account,
    disk,
    store,
    sent: [],
    keeps: true,
    old: false,
    describes: true,
    oldMeta: false,
    engine: null as unknown as Engine,
    async launch() {
      const world: World = {
        disk,
        account: {
          ask: async (route, body) => {
            if (route === 'prepare') return null
            if (route === 'ops') {
              const { ops } = body as { ops: { t: string; pos?: string }[] }
              if (made.old && ops.some((op) => op.t === 'place' || op.pos !== undefined)) {
                throw new Refused(400, 'not a request')
              }
              if (made.oldMeta && ops.some((op) => op.t === 'meta')) {
                throw new Refused(400, 'not a request')
              }
              made.sent.push(...ops)
            }
            const answer = unframe(await account.handle('d0', route, frame(body)))
            if (route === 'feed' && !made.keeps) delete (answer as { order?: true }).order
            if (route === 'feed' && !made.describes) delete (answer as { meta?: true }).meta
            return answer
          },
        },
        name: 'd0',
        now: () => 1000,
        random: Math.random,
        digest: (text) =>
          Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
        join: (root, path) => `${root}/${path}`,
        foldsCase,
        platform: 'other',
      }
      made.engine = await Engine.start(world, store.open(), { freshens: false })
      return made.engine
    },
  }
  await made.launch()
  return made
}

const positions = async (account: ReferenceAccount) =>
  Object.fromEntries((await account.view()).entries.map((entry) => [entry.name, entry.pos]))

describe('places', () => {
  test('a drag is drawn at once, goes up, and is kept across a relaunch', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    expect(one.engine.keepsPlaces(ROOT)).toBe(true)
    expect(one.engine.placedIn(ROOT)).toBeNull()

    expect(await one.engine.arrange(ROOT, ['Ideas.md', 'Plan.md'], 2)).toBe(true)
    expect(one.engine.placedIn(ROOT)).toEqual(['Ideas.md', 'Plan.md'])
    await one.engine.pass(SPACE)
    const kept = await positions(one.account)
    expect(kept['Ideas.md'] !== undefined && kept['Plan.md'] !== undefined).toBe(true)
    expect((kept['Ideas.md'] ?? '') < (kept['Plan.md'] ?? '')).toBe(true)

    one.engine.stop()
    const again = await one.launch()
    expect(again.placedIn(ROOT)).toEqual(['Ideas.md', 'Plan.md'])
    expect(again.placedFolders(ROOT)).toEqual(new Map([['', ['Ideas.md', 'Plan.md']]]))
  })

  test('a drag the file list makes asks for a pass at once, and one that places nothing does not', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    let asked = 0
    const list = placesOf(
      one.engine,
      () => null,
      () => (asked += 1),
    )

    expect(await list.arrange(ROOT, '', ['Ideas.md', 'Plan.md'])?.done).toBe(true)
    expect(asked).toBe(1)

    one.keeps = false
    await one.engine.pass(SPACE)
    expect(list.arrange(ROOT, '', ['Plan.md', 'Ideas.md'])).toBeNull()
    expect(asked).toBe(1)
  })

  test('another spelling of the space is the space only on a disk where it is one folder', async () => {
    const folding = await device()
    await folding.engine.pass(SPACE)
    expect(folding.engine.keepsPlaces(ROOT.toUpperCase())).toBe(true)

    const apart = await device(false)
    await apart.engine.pass(SPACE)
    expect(apart.engine.keepsPlaces(ROOT)).toBe(true)
    expect(apart.engine.keepsPlaces(ROOT.toUpperCase())).toBe(false)
  })

  test('one row dragged sends one place', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    await one.engine.arrange(ROOT, ['Ideas.md', 'Plan.md'], 2)
    await one.engine.pass(SPACE)
    one.sent.length = 0

    await one.engine.arrange(ROOT, ['Plan.md', 'Ideas.md'], 2)
    await one.engine.pass(SPACE)
    expect(one.sent.filter((op) => op.t === 'place')).toHaveLength(1)
    expect(one.engine.placedIn(ROOT)).toEqual(['Plan.md', 'Ideas.md'])
  })

  test('an account that does not say it keeps places is sent none', async () => {
    const one = await device()
    one.keeps = false
    await one.engine.pass(SPACE)
    expect(one.engine.keepsPlaces(ROOT)).toBe(false)
    expect(await one.engine.arrange(ROOT, ['Ideas.md', 'Plan.md'], 2)).toBe(false)
    expect(one.engine.placedIn(ROOT)).toBeNull()
  })

  test('places waiting when the account is put back to a build before them are dropped, and the pass goes on', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    await one.engine.arrange(ROOT, ['Ideas.md', 'Plan.md'], 2)
    await one.engine.created(`${ROOT}/New.md`, false, 'new')
    one.keeps = false
    one.old = true
    const passed = await one.engine.pass(SPACE)
    expect(passed?.finished).toBe(true)
    expect(one.engine.keepsPlaces(ROOT)).toBe(false)
    expect(one.engine.placedIn(ROOT)).toBeNull()
    expect((await one.account.view()).entries.map((entry) => entry.name)).toContain('New.md')

    one.sent.length = 0
    expect(await one.engine.arrange(ROOT, ['Plan.md', 'Ideas.md'], 2)).toBe(false)
    await one.engine.created(`${ROOT}/Other.md`, false, 'other')
    await one.engine.pass(SPACE)
    expect(one.sent.some((op) => op.t === 'place' || op.pos !== undefined)).toBe(false)
  })
})

const described = async (account: ReferenceAccount) =>
  Object.fromEntries((await account.view()).entries.map((entry) => [entry.name, entry.meta]))

describe("an item's metadata", () => {
  test('goes up by id, comes back by path, and is kept across a relaunch', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    expect(one.engine.describedIn(ROOT)).toEqual({})

    const left = await one.engine.describe(ROOT, {
      'Plan.md': { icon: 'rocket', 'icon-color': 'red' },
      'Nowhere.md': { icon: 'star' },
    })
    expect(left).toEqual(['Nowhere.md'])
    expect(one.engine.describedIn(ROOT)?.['Plan.md']).toEqual({
      icon: 'rocket',
      'icon-color': 'red',
    })
    await one.engine.pass(SPACE)
    expect((await described(one.account))['Plan.md']).toEqual({
      icon: 'rocket',
      'icon-color': 'red',
    })

    await one.engine.describe(ROOT, { 'Plan.md': { 'icon-color': null } })
    await one.engine.pass(SPACE)
    expect((await described(one.account))['Plan.md']).toEqual({ icon: 'rocket' })

    one.engine.stop()
    const again = await one.launch()
    expect(again.describedIn(ROOT)?.['Plan.md']).toEqual({ icon: 'rocket' })
  })

  test("another device's metadata arrives with the feed, and follows a rename", async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    const id = (await one.account.view()).entries.find((entry) => entry.name === 'Plan.md')?.id
    const seen = (await one.account.view()).entries.length
    const ops = (list: object[]) =>
      one.account.handle('d9', 'ops', frame({ ops: list })).then((bytes) => unframe(bytes))
    await ops([
      { op: 'x1', t: 'meta', id, meta: { cover: 'sea.png' }, seen },
      { op: 'x2', t: 'rename', id, name: 'Renamed.md', seen },
    ])
    await one.engine.pass(SPACE)
    expect(one.engine.describedIn(ROOT)).toEqual({ 'Renamed.md': { cover: 'sea.png' } })
  })

  test('an account that does not say it keeps metadata is sent none, and the place is null', async () => {
    const one = await device()
    one.describes = false
    await one.engine.pass(SPACE)
    expect(one.engine.describedIn(ROOT)).toBeNull()
    expect(await one.engine.describe(ROOT, { 'Plan.md': { icon: 'x' } })).toBeNull()
    await one.engine.pass(SPACE)
    expect(one.sent.some((op) => op.t === 'meta')).toBe(false)
  })

  test('metadata waiting when the account is put back to a build before it is dropped, and the pass goes on', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    await one.engine.describe(ROOT, { 'Plan.md': { icon: 'x' } })
    await one.engine.created(`${ROOT}/New.md`, false, 'new')
    one.describes = false
    one.oldMeta = true
    const passed = await one.engine.pass(SPACE)
    expect(passed?.finished).toBe(true)
    expect(one.engine.describedIn(ROOT)).toBeNull()
    expect(one.engine.keepsPlaces(ROOT)).toBe(true)
    expect((await one.account.view()).entries.map((entry) => entry.name)).toContain('New.md')
  })
})

describe('a name that grew a run of " 2" (#1630)', () => {
  test('is given back the name it grew from, on the account and on the disk', async () => {
    const one = await device()
    await one.engine.pass(SPACE)
    const from = `${ROOT}/Plan.md`
    const to = `${ROOT}/Plan 2 2 2.md`
    await one.disk.move(from, to)
    await one.engine.moved(from, to)

    await one.engine.pass(SPACE)
    await one.engine.pass(SPACE)

    const names = (await one.account.view()).entries.map((entry) => entry.name).sort()
    expect(names).toEqual(['Ideas.md', 'Plan.md'])
    expect(one.disk.files.has(from)).toBe(true)
    expect(one.disk.files.has(to)).toBe(false)
  })
})
