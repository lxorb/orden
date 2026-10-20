import { describe, expect, test, vi } from 'vitest'
import { SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import { hash32 } from '@nib/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED, type Seeded } from '@nib/sync-core/sim'
import { type DocRefusal, frame, type PushRequest, unframe } from '@nib/sync-core/wire'
import { attach } from './binding'
import { inline } from './classify'
import { HERE } from './docs'
import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { put, scan, StoreError, type Change } from './store'
import { numbersRow, wantedRow } from './records'
import { seedUpdate } from '@nib/sync-core/seed'
import type { World } from './world'
import type { SpaceNews } from '../space-watch'
import * as Y from 'yjs'

const watch = vi.hoisted(() => vi.fn())
vi.mock('../space-watch', () => ({
  watchSpaces: watch,
  unwatchSpaces: () => Promise.resolve(),
  scanSpace: () => Promise.resolve([]),
}))
const { watchFolders } = await import('./watching')

/** The engine's own promises, held to one device with an account in memory (the
 *  simulator kit's reference one): what a keystroke costs, what a crash loses, when a
 *  client id turns over, what an open note hears from another device, and that a held
 *  note neither goes up nor takes anything in (docs/sync-v2.md sections 5.2 to 5.4 and
 *  9.3), that a full store loses nothing (road 7), that a refused push waits rather than
 *  asking every pass, and that the folder watcher never hears the engine's own folder as
 *  a new one. The simulator's walks are sim.test.ts and walks/walk.ts. */

const ROOT = '/device/space'
const SPACE = 'sim'

interface Device {
  store: MemoryStore
  disk: MemoryDisk
  account: ReferenceAccount
  routes: string[]
  online: boolean
  /** Routes this device's requests go unanswered on, as if each were lost. */
  unanswered: Set<string>
  engine: Engine
  launch(): Promise<Engine>
}

/** One device holding the simulator's two seeded notes, the way a migrated one does, or
 *  the notes it is handed; none is a device that has never synced the space. */
async function device(
  account = new ReferenceAccount(new Clock(), SEEDED),
  id = 'd0',
  seeded: readonly Seeded[] = SEEDED,
): Promise<Device> {
  const store = new MemoryStore(id)
  const disk = new MemoryDisk()
  const seeding = store.open()
  const changes: Change[] = [
    put('spaces', {
      space_id: SPACE,
      root: ROOT,
      cursor: seeded.length,
      role: 'owner',
      store: null,
    }),
    put('meta', wantedRow(SPACE, new Map())),
  ]
  seeded.forEach((note, index) => {
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
        // One client id per device per note: two devices sharing one would be two
        // different operations under one name.
        client_id: hash32(id, note.id, index),
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

  const made: Device = {
    store,
    disk,
    account,
    routes: [],
    online: true,
    unanswered: new Set(),
    engine: null as unknown as Engine,
    async launch() {
      const world: World = {
        disk,
        account: {
          ask: async (route, body) => {
            if (!made.online || route === 'prepare' || made.unanswered.has(route)) return null
            made.routes.push(route)
            return unframe(await account.handle(id, route, frame(body)))
          },
        },
        name: id,
        now: () => 1000,
        random: Math.random,
        digest: (text) =>
          Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
        join: (root, path) => `${root}/${path}`,
        foldsCase: true,
        platform: 'other',
      }
      made.engine = await Engine.start(world, store.open(), { freshens: false })
      return made.engine
    },
  }
  await made.launch()
  return made
}

const PLAN = 'n1'

/** Long enough for what an answer sets going to have landed. */
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20))
}

async function textOn(account: ReferenceAccount, id: string): Promise<string> {
  return (await account.view()).texts[id] ?? ''
}

describe('a keystroke', () => {
  test('writes nothing: no store write, no file, no request', async () => {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const writes = one.store.writes
    const files = new Map(one.disk.files)

    for (let at = 0; at < 50; at++)
      doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'x'), HERE)

    expect(one.store.writes).toBe(writes)
    expect(one.disk.files).toEqual(files)
    expect(one.routes).toEqual([])
    // The pause writes it, once.
    await one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    expect(one.store.writes).toBe(writes + 1)
  })
})

describe('a crash', () => {
  test('loses only what was typed since the last pause, and the next launch turns the client over', async () => {
    const one = await device()
    let doc = await one.engine.hold(PLAN)
    const before = doc?.client
    doc?.live?.transact(() => doc?.live?.getText(TEXT).insert(0, 'saved '), HERE)
    await one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    doc?.live?.transact(() => doc?.live?.getText(TEXT).insert(0, 'lost '), HERE)

    // Gone at once: nothing flushed, the session never said it ended cleanly.
    one.engine.stop()
    const again = await one.launch()
    doc = await again.hold(PLAN)

    expect(doc?.text().startsWith('saved We ship')).toBe(true)
    expect(doc?.text()).not.toContain('lost')
    expect(doc?.client).not.toBe(before)
  })

  test('after a clean quit the client id stays, so a state vector stays one entry a device', async () => {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const before = doc?.client
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'kept '), HERE)
    await one.engine.quit()
    one.engine.stop()

    const again = await one.launch()
    const reopened = await again.hold(PLAN)
    expect(reopened?.client).toBe(before)
    expect(reopened?.text().startsWith('kept We ship')).toBe(true)
  })
})

describe('a full store (road 7)', () => {
  test('loses no word: what it refused is written with the next write, even the quit’s', async () => {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const store = one.engine.core.store
    const write = store.write.bind(store)
    let full = true
    store.write = (changes) => (full ? Promise.reject(new StoreError('disk full')) : write(changes))

    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'kept '), HERE)
    await expect(one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')).rejects.toThrow(
      'disk full',
    )
    full = false
    await one.engine.quit()
    one.engine.stop()

    const again = await one.launch()
    expect((await again.hold(PLAN))?.text().startsWith('kept We ship')).toBe(true)
  })
})

describe('an open note', () => {
  test('opens with its file’s words, and the document joins without changing them', async () => {
    const one = await device()
    const note = new SharedDoc(one.disk.files.get(`${ROOT}/Plan.md`) ?? '')
    let changed = 0
    note.onChange = () => (changed += 1)

    const part = await attach(
      one.engine,
      PLAN,
      { live: note, latest: note.text.toString() },
      () => true,
    )
    expect(part).not.toBeNull()
    expect(changed).toBe(0)
    expect(note.text.toString()).toBe(SEEDED[0]?.text)
    part?.()
  })

  test('words typed before the document arrived go into it as this device’s', async () => {
    const one = await device()
    const note = new SharedDoc(`Typed first. ${SEEDED[0]?.text ?? ''}`)
    await attach(one.engine, PLAN, { live: note, latest: note.text.toString() }, () => true)
    expect((await one.engine.core.doc(PLAN))?.text()).toBe(note.text.toString())
  })

  test('another device’s words arrive as the edit they are, and nothing typed here moves', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const there = await device(account, 'd1')

    const note = new SharedDoc(SEEDED[0]?.text ?? '')
    const arrived: unknown[] = []
    const arrive = note.arrived.bind(note)
    note.arrived = (changes) => {
      arrived.push(changes)
      arrive(changes)
    }
    await attach(here.engine, PLAN, { live: note, latest: note.text.toString() }, () => true)

    const doc = await there.engine.hold(PLAN)
    const live = doc?.live
    live?.transact(() => live.getText(TEXT).insert(live.getText(TEXT).length, 'From there.'), HERE)
    await there.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    await there.engine.pass(SPACE)
    await here.engine.pass(SPACE)

    expect(note.text.toString()).toBe(`${SEEDED[0]?.text ?? ''}From there.`)
    // One small edit at the end, not the whole note replaced.
    expect(arrived).toEqual([
      [{ from: SEEDED[0]?.text.length, to: SEEDED[0]?.text.length, insert: 'From there.' }],
    ])
  })
})

describe('an open note held apart from its document (#543)', () => {
  /** The document and the note each written over, differently, while the note was
   *  closed: the rule asks, the note is held, and it is not joined to the document until
   *  the question is answered. Joined, a keystroke at the end of the note went into the
   *  document at the note's place, inside a word of the document's (`wr!itten`). */
  async function heldApart() {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const live = doc?.live
    const theirs = 'Everything here was written again on this device.\n'
    live?.transact(() => {
      const text = live.getText(TEXT)
      text.delete(0, text.length)
      text.insert(0, theirs)
    }, HERE)
    await one.engine.letGo(PLAN)

    const mine = 'A note rewritten in another program, start to end.\n'
    const note = new SharedDoc(mine)
    const held = {
      live: note,
      get latest() {
        return note.text.toString()
      },
    }
    const part = await attach(one.engine, PLAN, held, () => true)
    return { one, note, part, theirs, mine }
  }

  test('is not joined while it is held, so typing goes into the note alone', async () => {
    const { one, note, part, theirs, mine } = await heldApart()
    expect(one.engine.core.isHeld(PLAN)).toBe(true)

    note.edit([{ from: mine.length, to: mine.length, insert: '!' }])
    expect((await one.engine.core.doc(PLAN))?.text()).toBe(theirs)
    expect(note.text.toString()).toBe(`${mine}!`)
    part?.()
  })

  test('answered Keep mine, the document takes the note, typing since and all, and they are one', async () => {
    const { one, note, part, mine } = await heldApart()
    note.edit([{ from: mine.length, to: mine.length, insert: 'Typed while asked.' }])

    await one.engine.held.answer(PLAN, 'mine')
    await settled()

    const doc = await one.engine.core.doc(PLAN)
    expect(doc?.text()).toBe(`${mine}Typed while asked.`)
    note.edit([{ from: 0, to: 0, insert: '> ' }])
    expect(doc?.text()).toBe(`> ${mine}Typed while asked.`)
    part?.()
  })

  test('answered Keep theirs, the note takes the document, and they are one', async () => {
    const { one, note, part, theirs } = await heldApart()

    await one.engine.held.answer(PLAN, 'theirs')
    await settled()

    expect(note.text.toString()).toBe(theirs)
    note.edit([{ from: theirs.length, to: theirs.length, insert: 'After.' }])
    expect((await one.engine.core.doc(PLAN))?.text()).toBe(`${theirs}After.`)
    part?.()
  })
})

describe('a meeting classified off this thread', () => {
  test('words typed while it was out are classified again, and nothing is said twice', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const there = await device(account, 'd1')
    const type = async (one: Device, words: string, at: 'start' | 'end') => {
      const live = (await one.engine.hold(PLAN))?.live
      live?.transact(() => {
        const text = live.getText(TEXT)
        text.insert(at === 'start' ? 0 : text.length, words)
      }, HERE)
      await one.engine.saved(`${ROOT}/Plan.md`, live?.getText(TEXT).toJSON() ?? '')
    }

    await type(there, ' From there.', 'end')
    await there.engine.pass(SPACE)
    await type(here, 'From here. ', 'start')

    // The worker's answer arrives after another word was typed.
    let asked = 0
    here.engine.core.world.classify = async (one) => {
      asked += 1
      const live = here.engine.core.docs.get(PLAN)?.live
      live?.transact(() => live.getText(TEXT).insert(0, 'Meanwhile. '), HERE)
      return await inline(one)
    }
    await here.engine.pass(SPACE)
    await here.engine.pass(SPACE)

    expect(asked).toBeGreaterThan(0)
    const text = (await here.engine.core.doc(PLAN))?.text() ?? ''
    expect(text).toBe(`Meanwhile. From here. ${SEEDED[0]?.text ?? ''} From there.`)
    expect(await textOn(account, PLAN)).toBe(text)
  })
})

describe('a held note', () => {
  test('is never pushed and never takes the account’s words in, until it is answered', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const there = await device(account, 'd1')
    const rewrite = async (one: Device, words: string) => {
      const doc = await one.engine.hold(PLAN)
      doc?.live?.transact(() => {
        doc.live?.getText(TEXT).delete(0, 36)
        doc.live?.getText(TEXT).insert(0, words)
      }, HERE)
      await one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    }

    await rewrite(there, 'The release goes out on Friday morning whatever the review says ')
    await there.engine.pass(SPACE)
    await rewrite(here, 'Let us hold the whole release until every reviewer has signed off ')
    await here.engine.pass(SPACE)
    expect(here.engine.core.isHeld(PLAN)).toBe(true)

    const mine = (await here.engine.core.doc(PLAN))?.text()
    here.routes.length = 0
    await there.engine.saved(`${ROOT}/Plan.md`, 'ignored')
    await here.engine.pass(SPACE)
    expect(here.routes).not.toContain('push')
    expect((await here.engine.core.doc(PLAN))?.text()).toBe(mine)
    expect(await textOn(account, PLAN)).toContain('Friday')

    await here.engine.held.answer(PLAN, 'mine')
    await here.engine.pass(SPACE)
    expect(await textOn(account, PLAN)).toContain('Let us hold the whole release')
  })
})

describe('a push the account refuses', () => {
  /** A device whose pushes are answered `refused` while `why` is set, and whose clock
   *  the test moves. */
  async function refusing(why: DocRefusal) {
    const one = await device()
    const world = one.engine.core.world
    const ask = world.account.ask.bind(world.account)
    let clock = 1000
    const said = { why: why as DocRefusal | null }
    world.now = () => clock
    world.account.ask = async (route, body, space) => {
      if (route !== 'push' || !said.why || !one.online) return await ask(route, body, space)
      one.routes.push(route)
      const docs = (body as PushRequest).docs.map((doc) => ({ id: doc.id, refused: said.why }))
      return { docs }
    }
    const doc = await one.engine.hold(PLAN)
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'kept '), HERE)
    await one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    const pushes = () => one.routes.filter((route) => route === 'push').length
    const logged = async () =>
      (await one.engine.core.store.read([scan('log')]))[0].flatMap((row) => row.failed ?? [])
    return {
      one,
      said,
      pushes,
      logged,
      later: (ms: number) => (clock += ms),
    }
  }

  test('waits longer each time instead of asking every pass, and says so once', async () => {
    const { one, pushes, logged, later } = await refusing('role')
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(1)
    expect(one.engine.waiting(SPACE)).toBe(false)
    expect(await logged()).toEqual(['you can only read this space'])

    await one.engine.pass(SPACE)
    expect(pushes()).toBe(1)

    later(2_001)
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(2)
    later(2_001)
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(2)
    later(6_000)
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(3)
    expect(await logged()).toHaveLength(1)
    // The words never left.
    expect((await one.engine.core.doc(PLAN))?.text().startsWith('kept ')).toBe(true)
  })

  test('goes up once the account takes it, and the wait is over', async () => {
    const { one, said, pushes, later } = await refusing('large')
    await one.engine.pass(SPACE)
    said.why = null
    later(2_001)
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(2)
    expect(await textOn(one.account, PLAN)).toContain('kept We ship')
    expect(one.engine.waiting(SPACE)).toBe(false)
  })

  test('says `gone` only once it has come back three times', async () => {
    const { one, logged, later } = await refusing('gone')
    for (const wait of [0, 2_001, 8_001]) {
      later(wait)
      expect(await logged()).toEqual([])
      await one.engine.pass(SPACE)
    }
    expect(await logged()).toEqual(['no such note'])
  })
})

describe('an outbox folded while offline', () => {
  test('a note moved into a folder made and deleted here is deleted on the account too', async () => {
    // The folder and its delete cancel before the account hears of either, and what was
    // only moved into it is deleted instead - a delete the fold makes, under an op id of
    // its own that no row of the outbox had yet. Left unwritten, it never went, and the
    // account kept a note this device had thrown away.
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account)
    here.online = false

    await here.disk.mkdir(`${ROOT}/Tmp`)
    await here.engine.created(`${ROOT}/Tmp`, true)
    await here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Tmp/Plan.md`)
    await here.engine.moved(`${ROOT}/Plan.md`, `${ROOT}/Tmp/Plan.md`)
    await here.disk.remove(`${ROOT}/Tmp`)
    await here.engine.removed(`${ROOT}/Tmp`)

    here.online = true
    await here.engine.pass(SPACE)

    const names = (await account.view()).entries.map((entry) => entry.name)
    expect(names).toEqual(['Ideas.md'])
    expect(here.engine.waiting(SPACE)).toBe(false)
    expect(here.store.rows('outbox')).toEqual([])
  })
})

describe('a folder deleted here', () => {
  test('leaves a note in it whose words this device never pulled, and the folder with it (#435)', async () => {
    // Another device made a folder and a note in it. This one read the list and has not
    // pulled the note's words, so the note has no file here yet; deleting the folder took
    // the note, words and all, with nothing kept. Seed 207340730 of the long walks.
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const there = await device(account, 'd0')
    const here = await device(account, 'd1')

    await there.disk.mkdir(`${ROOT}/Work`)
    await there.engine.created(`${ROOT}/Work`, true)
    await there.disk.write(`${ROOT}/Work/Notes.md`, 'eggs mk7z')
    const note = await there.engine.created(`${ROOT}/Work/Notes.md`, false, 'eggs mk7z')
    await there.engine.pass(SPACE)
    expect(note).not.toBeNull()
    expect(await textOn(account, note ?? '')).toBe('eggs mk7z')

    here.unanswered.add('pull')
    await here.engine.pass(SPACE)
    expect(here.disk.files.has(`${ROOT}/Work/Notes.md`)).toBe(false)

    await here.disk.remove(`${ROOT}/Work`)
    await here.engine.removed(`${ROOT}/Work`)
    here.unanswered.clear()
    await here.engine.pass(SPACE)

    const live = (await account.view()).entries.map((entry) => entry.name)
    expect(live).toEqual(expect.arrayContaining(['Work', 'Notes.md']))
    expect(await textOn(account, note ?? '')).toBe('eggs mk7z')
  })

  test('takes a note in it whose words this device had pulled', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const there = await device(account, 'd0')
    const here = await device(account, 'd1')

    await there.disk.mkdir(`${ROOT}/Work`)
    await there.engine.created(`${ROOT}/Work`, true)
    await there.disk.write(`${ROOT}/Work/Notes.md`, 'eggs mk8z')
    await there.engine.created(`${ROOT}/Work/Notes.md`, false, 'eggs mk8z')
    await there.engine.pass(SPACE)

    await here.engine.pass(SPACE)
    expect(here.disk.files.get(`${ROOT}/Work/Notes.md`)).toBe('eggs mk8z')

    await here.disk.remove(`${ROOT}/Work`)
    await here.engine.removed(`${ROOT}/Work`)
    await here.engine.pass(SPACE)

    const live = (await account.view()).entries.map((entry) => entry.name)
    expect(live).not.toContain('Work')
    expect(live).not.toContain('Notes.md')
  })
})

describe('a move to another space', () => {
  const WORK = 'work'
  const WORK_ROOT = '/device/work'

  /** A device holding the seeded space and an empty second one, offline. */
  async function twoSpaces(): Promise<Device> {
    const here = await device()
    here.engine.stop()
    const writing = here.store.open()
    await writing.write([
      put('spaces', { space_id: WORK, root: WORK_ROOT, cursor: 0, role: 'owner', store: null }),
      put('meta', wantedRow(WORK, new Map())),
    ])
    await writing.cleanExit(true)
    await here.launch()
    here.online = false
    return here
  }

  /** What a space holds, live, as path and kind. */
  function held(here: Device, space: string): string[] {
    const state = here.engine.core.spaces.get(space)
    if (!state) return []
    return [...state.entries.values()]
      .filter((entry) => state.isLive(entry.id))
      .map((entry) => `${entry.local_path} ${entry.kind}`)
      .sort()
  }

  test('takes a folder with everything in it, each as the kind it was (#413)', async () => {
    // The other space's tree had never heard of anything in the folder, and only the
    // folder was made there: the account, and every other device, had it empty.
    const here = await twoSpaces()
    await here.disk.mkdir(`${ROOT}/Trip`)
    await here.engine.created(`${ROOT}/Trip`, true)
    for (const [name, text] of [
      ['Trip/Trip.md', '# Trip\n'],
      ['Trip/Map.md', '# Map\n'],
      ['Trip/Board.canvas', '{"nodes":[],"edges":[]}'],
    ] as const) {
      await here.disk.write(`${ROOT}/${name}`, text)
      await here.engine.created(`${ROOT}/${name}`, false, text)
    }

    await here.disk.move(`${ROOT}/Trip`, `${WORK_ROOT}/Trip`)
    await here.engine.moved(`${ROOT}/Trip`, `${WORK_ROOT}/Trip`)

    expect(held(here, WORK)).toEqual([
      'Trip folder',
      'Trip/Board.canvas canvas',
      'Trip/Map.md note',
      'Trip/Trip.md note',
    ])
    expect(held(here, SPACE)).toEqual(['Ideas.md note', 'Plan.md note'])
    const map = here.engine.entryAt(`${WORK_ROOT}/Trip/Map.md`)
    expect((await here.engine.hold(map?.id ?? ''))?.text()).toBe('# Map\n')
  })

  test('takes a note the account knows, with its words, and leaves none behind', async () => {
    const here = await twoSpaces()
    await here.disk.move(`${ROOT}/Plan.md`, `${WORK_ROOT}/Plan.md`)
    await here.engine.moved(`${ROOT}/Plan.md`, `${WORK_ROOT}/Plan.md`)

    expect(held(here, WORK)).toEqual(['Plan.md note'])
    expect(held(here, SPACE)).toEqual(['Ideas.md note'])
    const plan = here.engine.entryAt(`${WORK_ROOT}/Plan.md`)
    expect(plan?.id).not.toBe(PLAN)
    expect((await here.engine.hold(plan?.id ?? ''))?.text()).toBe(SEEDED[0]?.text)
  })
})

describe('the folder watcher', () => {
  test('hears the engine’s own new folder as that folder, never a second one', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const there = await device(account, 'd1')
    await there.engine.created(`${ROOT}/Work`, true)
    await there.engine.moved(`${ROOT}/Plan.md`, `${ROOT}/Work/Plan.md`)
    await there.engine.pass(SPACE)

    const heard: ((news: SpaceNews) => void)[] = []
    watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
      heard.push(hear)
      return Promise.resolve()
    })
    const watched = watchFolders({
      engine: here.engine,
      own: () => false,
      ready: () => true,
      changed: () => undefined,
    })
    // The folder is made for the note moving into it, and the watcher says so while the
    // pass is still on its way to writing down where that folder is.
    const mkdir = here.disk.mkdir.bind(here.disk)
    let echoed: Promise<void> = Promise.resolve()
    here.disk.mkdir = async (path) => {
      await mkdir(path)
      if (path !== `${ROOT}/Work`) return
      const change = { kind: 'created', path, dir: true, size: 0, mtime: 0, id: null } as const
      for (const hear of heard) hear({ root: ROOT, changes: [change], scan: false, gone: false })
      echoed = new Promise((resolve) => setTimeout(resolve, 20))
      await echoed
    }
    await here.engine.pass(SPACE)
    await echoed
    await here.engine.pass(SPACE)
    watched.stop()

    const space = here.engine.core.spaces.get(SPACE)
    const folders = [...(space?.entries.values() ?? [])].filter(
      (entry) => entry.kind === 'folder' && !entry.deleted,
    )
    expect(folders.map((folder) => folder.local_path)).toEqual(['Work'])
    expect(await here.disk.exists(`${ROOT}/Work/Plan.md`)).toBe(true)
  })

  test('watches a space paired after it started, once', async () => {
    // A device's first v2 launch starts the engine with no space in its store; the
    // spaces are paired by the first pass, after the watch began. Watched by the roots it
    // had at the start, it heard nothing for the whole session, and every edit another
    // program made - or one made while offline - stayed off the account.
    const here = await device()
    watch.mockReset()
    watch.mockImplementation(() => Promise.resolve())
    const watched = watchFolders({
      engine: here.engine,
      own: () => false,
      ready: () => true,
      changed: () => undefined,
    })
    const watchedRoots = () => watch.mock.calls.map((call: unknown[]) => call[0])
    expect(watchedRoots()).toEqual([[ROOT]])

    await here.engine.core.commit(here.engine.core.addSpace('later', '/device/later', 'owner'))
    watched.follow()
    watched.follow()
    expect(watchedRoots()).toEqual([[ROOT], ['/device/later', ROOT].sort()])
    watched.stop()
  })
})

/** A copy another sync tool made beside a note: never made on the account, never
 *  written onto a disk that does not have it, never sent when it changes, and never
 *  taken off a disk when the account lets go of one - which happens only when somebody
 *  asks, from the Sync pane. See @nib/sync-core/foreign. */
describe('another sync tool’s copy', () => {
  const CLASH = 'Plan (# Name clash 2026-10-05 a1b2c3C #).md'
  const WITH_CLASH: readonly Seeded[] = [...SEEDED, { id: 'n9', name: CLASH, text: 'theirs\n' }]

  const names = async (account: ReferenceAccount) =>
    (await account.view()).entries.map((entry) => entry.name)

  test('made here never reaches the account, and is not an entry here', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account)
    here.disk.files.set(`${ROOT}/${CLASH}`, 'theirs\n')

    await here.engine.created(`${ROOT}/${CLASH}`, false, 'theirs\n')
    await here.engine.created(`${ROOT}/Old (# Name clash 2026-10-05 a1b2c3C #)`, true)
    await here.engine.pass(SPACE)

    expect(await names(account)).toEqual(['Plan.md', 'Ideas.md'])
    expect(here.engine.entryAt(`${ROOT}/${CLASH}`)).toBeNull()
    expect(here.engine.waiting(SPACE)).toBe(false)
  })

  test('one the account has from before is not written onto a disk without it', async () => {
    const account = new ReferenceAccount(new Clock(), WITH_CLASH)
    const fresh = await device(account, 'd1', [])

    await fresh.engine.pass(SPACE)

    expect(fresh.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
    expect(fresh.disk.files.has(`${ROOT}/${CLASH}`)).toBe(false)
  })

  test('and is not sent when it changes here', async () => {
    const account = new ReferenceAccount(new Clock(), WITH_CLASH)
    const here = await device(account, 'd0', WITH_CLASH)
    here.disk.files.set(`${ROOT}/${CLASH}`, 'theirs, edited\n')

    await here.engine.foreign(`${ROOT}/${CLASH}`)
    await here.engine.saved(`${ROOT}/${CLASH}`, 'theirs, edited\n')
    await here.engine.pass(SPACE)

    expect(await textOn(account, 'n9')).toBe('theirs\n')
  })

  test('is counted, and taken off the account on request with every file left', async () => {
    const account = new ReferenceAccount(new Clock(), WITH_CLASH)
    const here = await device(account, 'd0', WITH_CLASH)
    const there = await device(account, 'd1', WITH_CLASH)
    expect(here.engine.foreignCopies().map(({ entry }) => entry.name)).toEqual([CLASH])

    expect(await here.engine.unsync()).toBe(1)
    await here.engine.pass(SPACE)
    await there.engine.pass(SPACE)

    expect(await names(account)).toEqual(['Plan.md', 'Ideas.md'])
    expect(here.disk.files.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
    expect(there.disk.files.get(`${ROOT}/${CLASH}`)).toBe('theirs\n')
    expect(here.engine.foreignCopies()).toEqual([])
    expect(there.engine.foreignCopies()).toEqual([])
  })

  test('is not what a note becomes when the tool puts it aside under that name', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account)
    const words = here.disk.files.get(`${ROOT}/Plan.md`) ?? ''
    here.disk.files.delete(`${ROOT}/Plan.md`)
    here.disk.files.set(`${ROOT}/${CLASH}`, words)

    await here.engine.moved(`${ROOT}/Plan.md`, `${ROOT}/${CLASH}`)
    await here.engine.pass(SPACE)

    expect(await names(account)).toEqual(['Plan.md', 'Ideas.md'])
    expect(here.engine.core.spaces.get(SPACE)?.entries.get(PLAN)?.local_path).toBe('Plan.md')
  })
})
