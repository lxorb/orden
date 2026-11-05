import { describe, expect, test } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'
import { Engine } from './engine'
import { carriedIds, carriedRows, isLocal, localFirst, localSpaceId } from './local'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import type { World } from './world'

/** A space used signed out (#1068, step 4b): the engine runs with no account behind it,
 *  so every folder, note and file has an id from the start, and the tree is the same
 *  operations on ids, applied here. */

const ROOT = '/device/space'

interface Here {
  disk: MemoryDisk
  store: MemoryStore
  engine: Engine
  space: string
  asked: string[]
  launch(): Promise<Engine>
}

async function signedOut(
  files: Record<string, string> = {},
  carried: ReadonlyMap<string, string> = new Map(),
): Promise<Here> {
  const disk = new MemoryDisk()
  disk.folders.add(ROOT)
  for (const [path, text] of Object.entries(files)) await disk.write(`${ROOT}/${path}`, text)
  const store = new MemoryStore('here')
  const asked: string[] = []
  const world: World = {
    disk,
    account: {
      ask: (route) => {
        asked.push(route)
        return Promise.resolve(null)
      },
    },
    name: 'here',
    now: () => 1000,
    random: Math.random,
    digest: (text) => Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
    join: (root, path) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
    list: (at) => {
      const listed: { path: string; dir: boolean }[] = []
      for (const folder of disk.folders) {
        if (folder.startsWith(`${at}/`))
          listed.push({ path: folder.slice(at.length + 1), dir: true })
      }
      for (const file of disk.files.keys()) {
        if (file.startsWith(`${at}/`)) listed.push({ path: file.slice(at.length + 1), dir: false })
      }
      return Promise.resolve(listed)
    },
  }
  const here: Here = {
    disk,
    store,
    asked,
    space: localSpaceId(Math.random),
    engine: null as unknown as Engine,
    async launch() {
      here.engine = await Engine.start(world, store.open(), { freshens: false })
      return here.engine
    },
  }
  const engine = await here.launch()
  await engine.core.commit(engine.core.addSpace(here.space, ROOT, 'owner'))
  const space = engine.core.spaces.get(here.space)
  if (!space) throw new Error('no space')
  expect(await localFirst(engine.core, space, carried)).toBe(true)
  return here
}

function spaceOf(here: Here) {
  const space = here.engine.core.spaces.get(here.space)
  if (!space) throw new Error('no space')
  return space
}

describe('a space used signed out', () => {
  test('is named as no account names one', () => {
    expect(isLocal(localSpaceId(Math.random))).toBe(true)
    expect(isLocal('5f0c1d7e-2b8a-4c1e-9d3f-0a1b2c3d4e5f')).toBe(false)
  })

  test('gives every folder, note and file an id at its first pass, and asks nothing of the network', async () => {
    const here = await signedOut({ 'Plan.md': 'ship it', 'Work/Notes.md': 'eggs' })
    const passed = await here.engine.pass(here.space)

    expect(passed?.finished).toBe(true)
    const space = spaceOf(here)
    const plan = space.at('Plan.md')
    const work = space.at('Work')
    const notes = space.at('Work/Notes.md')
    expect(plan?.seq).not.toBeNull()
    expect(work?.kind).toBe('folder')
    expect(notes?.parent).toBe(work?.id)
    expect(space.outbox).toEqual([])
    expect(here.engine.core.hasPending(plan?.id ?? '')).toBe(false)
    expect((await here.engine.core.doc(notes?.id ?? ''))?.text()).toBe('eggs')
    expect(here.asked).toEqual([])
    expect(here.engine.waiting(here.space)).toBe(false)
    expect(here.disk.files.get(`${ROOT}/Plan.md`)).toBe('ship it')
  })

  test('keeps an entry its id through a rename and a move, and the disk where they put it', async () => {
    const here = await signedOut({ 'Plan.md': 'ship it', 'Work/Notes.md': 'eggs' })
    await here.engine.pass(here.space)
    const id = spaceOf(here).at('Plan.md')?.id

    await here.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Work/Plan.md`, () =>
      here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Work/Plan.md`),
    )
    await here.engine.moving(`${ROOT}/Work/Plan.md`, `${ROOT}/Work/Ship.md`, () =>
      here.disk.move(`${ROOT}/Work/Plan.md`, `${ROOT}/Work/Ship.md`),
    )
    await here.engine.pass(here.space)

    const space = spaceOf(here)
    expect(space.at('Work/Ship.md')?.id).toBe(id)
    expect(space.entries.get(id ?? '')?.name).toBe('Ship.md')
    expect(space.outbox).toEqual([])
    expect([...here.disk.files.keys()].sort()).toEqual([
      `${ROOT}/Work/Notes.md`,
      `${ROOT}/Work/Ship.md`,
    ])
  })

  test('confirms what was typed, and keeps it and the ids through a relaunch', async () => {
    const here = await signedOut({ 'Plan.md': 'ship it' })
    await here.engine.pass(here.space)
    const id = spaceOf(here).at('Plan.md')?.id ?? ''

    await here.disk.write(`${ROOT}/Plan.md`, 'ship it today')
    await here.engine.saved(`${ROOT}/Plan.md`, 'ship it today')
    expect(here.engine.waiting(here.space)).toBe(true)
    await here.engine.pass(here.space)
    expect(here.engine.core.hasPending(id)).toBe(false)

    await here.engine.quit()
    here.engine.stop()
    const again = await here.launch()
    expect(again.core.spaces.get(here.space)?.at('Plan.md')?.id).toBe(id)
    expect((await again.core.doc(id))?.text()).toBe('ship it today')
    await again.pass(here.space)
    expect(here.disk.files.get(`${ROOT}/Plan.md`)).toBe('ship it today')
  })

  test('brings a delete put back under its ids, and deletes nothing else', async () => {
    const here = await signedOut({ 'Work/Notes.md': 'eggs', 'Plan.md': 'ship it' })
    await here.engine.pass(here.space)
    const folder = spaceOf(here).at('Work')?.id
    const note = spaceOf(here).at('Work/Notes.md')?.id

    await here.engine.removing(`${ROOT}/Work`, async () => {
      await here.disk.remove(`${ROOT}/Work`)
      return 'trash-1'
    })
    await here.engine.pass(here.space)
    expect(spaceOf(here).entries.get(note ?? '')?.deleted).toBe(true)

    await here.disk.write(`${ROOT}/Work/Notes.md`, 'eggs')
    expect(await here.engine.restored(`${ROOT}/Work`, 'trash-1')).toBe(true)
    await here.engine.pass(here.space)

    const space = spaceOf(here)
    expect(space.at('Work')?.id).toBe(folder)
    expect(space.at('Work/Notes.md')?.id).toBe(note)
    expect(space.isLive(note ?? '')).toBe(true)
    expect(here.disk.files.get(`${ROOT}/Work/Notes.md`)).toBe('eggs')
    expect(here.disk.files.get(`${ROOT}/Plan.md`)).toBe('ship it')
    expect(here.asked).toEqual([])
  })

  test('makes a note again where its file is when the rules refuse its making', async () => {
    const here = await signedOut({ 'Work/Notes.md': 'eggs' })
    await here.engine.pass(here.space)
    const work = spaceOf(here).at('Work')?.id ?? ''

    // A note whose folder the tree does not hold: its making is refused as `gone`.
    await here.disk.write(`${ROOT}/Work/Idea.md`, 'words')
    const made = (await here.engine.created(`${ROOT}/Work/Idea.md`, false, 'words')) ?? ''
    const space = spaceOf(here)
    for (const one of space.outbox) {
      if (one.record.t === 'op' && one.record.op.t === 'create' && one.record.op.id === made) {
        one.record = { t: 'op', op: { ...one.record.op, parent: 'nowhere' } }
      }
    }
    const entry = space.entries.get(made)
    if (entry) entry.parent = 'nowhere'
    space.changed()

    await here.engine.pass(here.space)

    const idea = spaceOf(here).at('Work/Idea.md')
    expect(idea?.id).not.toBe(made)
    expect(idea?.parent).toBe(work)
    expect(spaceOf(here).isLive(idea?.id ?? '')).toBe(true)
    expect((await here.engine.core.doc(idea?.id ?? ''))?.text()).toBe('words')
    expect(here.disk.files.get(`${ROOT}/Work/Idea.md`)).toBe('words')
    expect(spaceOf(here).outbox).toEqual([])
  })

  test('keeps the ids an account gave, signing out, and leaves them behind signing in to another', async () => {
    const plan = '5f0c1d7e-2b8a-4c1e-9d3f-0a1b2c3d4e5f'
    const work = '6a1d2e8f-3c9b-4d2f-8e4a-1b2c3d4e5f60'
    const here = await signedOut(
      { 'Plan.md': 'ship it', 'Work/Notes.md': 'eggs' },
      new Map([
        ['plan.md', plan],
        ['work', work],
      ]),
    )
    await here.engine.core.commit(
      carriedRows(new Map([[ROOT, JSON.stringify({ 'Plan.md': plan, Work: work })]]), 'u1'),
    )
    await here.engine.pass(here.space)
    const space = spaceOf(here)
    expect(space.at('Plan.md')?.id).toBe(plan)
    expect(space.at('Work')?.id).toBe(work)
    const notes = space.at('Work/Notes.md')?.id ?? ''
    expect(space.at('Work/Notes.md')?.parent).toBe(work)

    // Back to the account they came from, every id goes; to another, only what was made
    // here, since a space there may not make anything under an id another space made.
    const same = JSON.parse(
      (await carriedIds(here.engine.core.store, isLocal, 'u1')).get(ROOT) ?? '{}',
    )
    expect(same).toEqual({ 'Plan.md': plan, Work: work, 'Work/Notes.md': notes })
    const other = JSON.parse(
      (await carriedIds(here.engine.core.store, isLocal, 'u2')).get(ROOT) ?? '{}',
    )
    expect(other).toEqual({ 'Work/Notes.md': notes })
  })
})
