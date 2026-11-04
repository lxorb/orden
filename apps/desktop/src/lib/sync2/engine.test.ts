import { describe, expect, test, vi } from 'vitest'
import { SharedDoc } from '@orden/editor'
import { TEXT } from '@orden/rooms'
import { hash32 } from '@orden/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED, type Seeded } from '@orden/sync-core/sim'
import { type DocRefusal, frame, type PushRequest, unframe } from '@orden/sync-core/wire'
import { Across } from '../workspace/across'
import { NoteDoc } from '../workspace/documents.svelte'
import { Windows } from '../windows'
import { attach } from './binding'
import { inline } from './classify'
import { HERE } from './docs'
import { Engine, relative } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { put, scan, StoreError, type Change } from './store'
import { numbersRow, wantedRow } from './records'
import { seedUpdate } from '@orden/sync-core/seed'
import type { Disk, World } from './world'
import type { SpaceChange, SpaceNews } from '../space-watch'
import * as Y from 'yjs'

const watch = vi.hoisted(() => vi.fn())
vi.mock('../space-watch', () => ({
  watchSpaces: watch,
  unwatchSpaces: () => Promise.resolve(),
  scanSpace: () => Promise.resolve([]),
}))
const told = vi.hoisted(() => vi.fn())
vi.mock('../notify', () => ({ notify: told }))
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

/** Every text the disk keeps as a version on this device, from now on. */
function keptOn(disk: Disk): string[] {
  const kept: string[] = []
  disk.keep = (_path, text) => {
    kept.push(text)
    return Promise.resolve()
  }
  return kept
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

/** A session that said it ended and then did not: the window hid, the close was called
 *  off, the page came back. Whatever it writes after that was not ended by that word,
 *  and a client id reused after a crash is two histories under one name, which a device
 *  and its room never reconcile. */
describe('a clean exit said too early', () => {
  async function typedAfter(say: (engine: Engine) => Promise<void>) {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const before = doc?.client
    await say(one.engine)
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'after '), HERE)
    await one.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')

    // Gone at once.
    one.engine.stop()
    const again = await one.launch()
    return { before, after: (await again.hold(PLAN))?.client }
  }

  test('is taken back by the next write: the client turns over after a crash', async () => {
    const { before, after } = await typedAfter((engine) => engine.quit())
    expect(after).not.toBe(before)
  })

  test('a save writes everything down and says no such thing', async () => {
    const one = await device()
    const doc = await one.engine.hold(PLAN)
    const before = doc?.client
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'kept '), HERE)
    await one.engine.flush()

    one.engine.stop()
    const again = await one.launch()
    const read = await again.hold(PLAN)
    expect(read?.text().startsWith('kept We ship')).toBe(true)
    expect(read?.client).not.toBe(before)
  })

  test('a save, then typing, then a crash turns the client over too', async () => {
    const { before, after } = await typedAfter((engine) => engine.flush())
    expect(after).not.toBe(before)
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
  test('another window\u2019s write is news it has yet to take in, not words it knows', async () => {
    const one = await device()
    const path = `${ROOT}/Plan.md`
    const before = one.disk.files.get(path) ?? ''
    const note = new NoteDoc(
      { kind: 'note', path, name: 'Plan.md', text: before, dirty: false },
      () => undefined,
    )
    const part = await attach(one.engine, PLAN, note, () => true)
    const theirs = `${before}\nFROM THE OTHER WINDOW\n`
    one.disk.files.set(path, theirs)
    await one.engine.saved(path, theirs)
    expect(note.onDisk).toBe(before)
    part?.()
  })

  test('a foreign edit it took in is not merged in again by the note\u2019s next write', async () => {
    const one = await device()
    const path = `${ROOT}/Plan.md`
    const before = one.disk.files.get(path) ?? ''
    const note = new NoteDoc(
      { kind: 'note', path, name: 'Plan.md', text: before, dirty: false },
      () => undefined,
    )
    const part = await attach(one.engine, PLAN, note, () => true)

    const appended = `${before}\nAPPENDED BY GIT\n`
    one.disk.files.set(path, appended)
    await one.engine.foreign(path)
    expect(note.latest).toBe(appended)

    const end = note.live.text.length
    note.live.edit([{ from: end, to: end, insert: 'typed on\n' }], { userEvent: 'input' })
    note.flush()

    const across = new Across(
      {
        documents: [note],
        tell: () => Promise.resolve(),
        follow: () => undefined,
        loadTree: () => Promise.resolve(),
        loadSpaces: () => Promise.resolve(),
        owed: () => undefined,
        draftOf: () => undefined,
        joined: () => null,
        noteSaved: () => undefined,
        read: (at) => Promise.resolve(one.disk.files.get(at) ?? null),
        exists: (at) => Promise.resolve(one.disk.files.has(at)),
        reachable: () => Promise.resolve(true),
        keepVersion: () => Promise.resolve(),
        pause: () => Promise.resolve(),
      },
      new Windows(() => null),
    )
    await across.writing(note, path, (words) => {
      one.disk.files.set(path, words)
      return Promise.resolve()
    })
    expect(one.disk.files.get(path)?.split('APPENDED BY GIT').length).toBe(2)
    part?.()
  })

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

  test('meeting a document that moved too, the side a small overlap loses is kept as a version', async () => {
    // The note and the document each changed the same word: the rule settles it without
    // asking, one side's word stands, and the other's was in no version at all.
    const one = await device()
    one.online = false
    const seeded = SEEDED[0]?.text ?? ''
    const theirs = seeded.replace('Monday', 'Friday')
    const doc = await one.engine.hold(PLAN)
    const live = doc?.live
    live?.transact(() => {
      const text = live.getText(TEXT)
      text.delete(0, text.length)
      text.insert(0, theirs)
    }, HERE)
    await one.engine.letGo(PLAN)

    const mine = seeded.replace('Monday', 'Tuesday')
    const note = new SharedDoc(mine)
    const part = await attach(one.engine, PLAN, { live: note, latest: mine }, () => true)
    expect(one.engine.core.isHeld(PLAN)).toBe(false)
    expect(note.text.toString()).toBe(mine)

    const kept = (one.engine.core.spaces.get(SPACE)?.outbox ?? []).flatMap(({ record }) =>
      record.t === 'keep' ? [record.keep.text] : [],
    )
    expect(kept).toEqual([theirs])
    part?.()
  })
})

describe('a key typed while a note and its document are brought together', () => {
  test('goes into the document, so what follows lands in the right place', async () => {
    const one = await device()
    one.online = false
    const seeded = SEEDED[0]?.text ?? ''
    const theirs = seeded.replace('Monday', 'Friday')
    const doc = await one.engine.hold(PLAN)
    const live = doc?.live
    live?.transact(() => {
      const text = live.getText(TEXT)
      text.delete(0, text.length)
      text.insert(0, theirs)
    }, HERE)
    await one.engine.letGo(PLAN)

    const mine = seeded.replace('Monday', 'Tuesday')
    const note = new SharedDoc(mine)
    const keepLost = one.engine.keepLost.bind(one.engine)
    one.engine.keepLost = async (...args) => {
      note.arrived([{ from: 0, to: 0, insert: 'X' }])
      await keepLost(...args)
    }
    const part = await attach(
      one.engine,
      PLAN,
      {
        live: note,
        get latest() {
          return note.text.toString()
        },
      },
      () => true,
    )

    const held = await one.engine.hold(PLAN)
    expect(one.engine.core.isHeld(PLAN)).toBe(false)
    expect(held?.text()).toBe(note.text.toString())
    expect(note.text.toString().startsWith('X')).toBe(true)
    await one.engine.letGo(PLAN)
    part?.()
  })
})

describe('words that reach the document while a note and its document are brought together', () => {
  async function meeting() {
    const one = await device()
    one.online = false
    const seeded = SEEDED[0]?.text ?? ''
    const theirs = seeded.replace('Monday', 'Friday')
    const doc = await one.engine.hold(PLAN)
    const live = doc?.live
    live?.transact(() => {
      const text = live.getText(TEXT)
      text.delete(0, text.length)
      text.insert(0, theirs)
    }, HERE)
    await one.engine.letGo(PLAN)
    const note = new SharedDoc(seeded.replace('Monday', 'Tuesday'))
    const keepLost = one.engine.keepLost.bind(one.engine)
    return { one, note, keepLost }
  }
  const held = (note: SharedDoc) => ({
    live: note,
    get latest() {
      return note.text.toString()
    },
  })

  test('a pull is kept, in the document and in the note', async () => {
    const { one, note, keepLost } = await meeting()
    let arriving = true
    one.engine.keepLost = async (...args) => {
      const doc = one.engine.core.docs.get(PLAN)
      if (arriving) doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'PULLED '))
      arriving = false
      await keepLost(...args)
    }

    const part = await attach(one.engine, PLAN, held(note), () => true)

    const doc = await one.engine.hold(PLAN)
    expect(doc?.text()).toContain('PULLED ')
    expect(note.text.toString()).toBe(doc?.text())
    await one.engine.letGo(PLAN)
    part?.()
  })

  test('a pull and a key both stay, or the two are held apart and nothing is lost', async () => {
    const { one, note, keepLost } = await meeting()
    let arriving = true
    one.engine.keepLost = async (...args) => {
      const doc = one.engine.core.docs.get(PLAN)
      if (arriving) {
        doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'PULLED '))
        note.arrived([{ from: note.text.length, to: note.text.length, insert: 'KEY' }])
      }
      arriving = false
      await keepLost(...args)
    }

    const part = await attach(one.engine, PLAN, held(note), () => true)

    const doc = await one.engine.hold(PLAN)
    const both = `${doc?.text() ?? ''}\n${note.text.toString()}`
    expect(both).toContain('PULLED ')
    expect(both).toContain('KEY')
    if (!one.engine.core.isHeld(PLAN)) expect(note.text.toString()).toBe(doc?.text())
    await one.engine.letGo(PLAN)
    part?.()
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
    const { one, pushes, logged, later } = await refusing('large')
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(1)
    expect(one.engine.waiting(SPACE)).toBe(false)
    expect(await logged()).toEqual(['that note is too large'])

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

  test('in a space this device may only read lets the edit go, kept as a version, and takes the owner’s words again', async () => {
    // Another program changed a reader's file. The account refuses it with `role` for as
    // long as the space is read only, and a pull never lands on pending edits, so kept
    // pending it would have stood between this device and every later word of the owner's.
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const reader = await device(account, 'd0')
    const owner = await device(account, 'd1')
    const world = reader.engine.core.world
    const ask = world.account.ask.bind(world.account)
    world.account.ask = async (route, body, space) => {
      if (route !== 'push') return await ask(route, body, space)
      return { docs: (body as PushRequest).docs.map((doc) => ({ id: doc.id, refused: 'role' })) }
    }
    const kept = keptOn(reader.disk)

    const file = `${ROOT}/Plan.md`
    reader.disk.files.set(file, 'Changed in another editor.\n')
    await reader.engine.foreign(file)
    await reader.engine.pass(SPACE)
    expect(kept).toContain('Changed in another editor.\n')
    expect(reader.engine.core.hasPending(PLAN)).toBe(false)

    const doc = await owner.engine.hold(PLAN)
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'From the owner. '), HERE)
    await owner.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    await owner.engine.pass(SPACE)

    await reader.engine.pass(SPACE)
    expect(reader.disk.files.get(file)).toBe(await textOn(account, PLAN))
    expect(reader.disk.files.get(file)?.startsWith('From the owner. ')).toBe(true)
  })

  test('lowered to reading while offline with an edit, keeps the edit as a version and the owner’s words', async () => {
    const { one, pushes, logged } = await refusing('role')
    const kept = keptOn(one.disk)
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(1)
    expect(kept.some((text) => text.startsWith('kept '))).toBe(true)
    expect(one.disk.files.get(`${ROOT}/Plan.md`)).toBe(await textOn(one.account, PLAN))
    expect(await logged()).toEqual(['you can only read this space'])

    // Nothing is left to push, so nothing waits.
    await one.engine.pass(SPACE)
    expect(pushes()).toBe(1)
    expect(one.engine.waiting(SPACE)).toBe(false)
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

test('a line said from beside the passes reaches the log and whoever has it open', async () => {
  const one = await device()
  const heard: (string | null)[] = []
  one.engine.on('pass', (row) => heard.push(row.failed))

  await one.engine.said(SPACE, 'the account would not take Lecture.pages.pdf')

  const [rows] = await one.engine.core.store.read([scan('log')])
  expect(rows.at(-1)).toMatchObject({
    space: SPACE,
    failed: 'the account would not take Lecture.pages.pdf',
  })
  expect(heard).toEqual(['the account would not take Lecture.pages.pdf'])
})

describe('an outbox folded while offline', () => {
  test('a note iCloud took off this Mac is no delete, by the watcher or a scan', async () => {
    // macOS 13: `Plan.md` becomes `.Plan.md.icloud`, which no list holds. Taken for gone,
    // the note left the account and every other device with it.
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account)
    await here.disk.remove(`${ROOT}/Plan.md`)
    await here.disk.write(`${ROOT}/.Plan.md.icloud`, 'bplist')

    await here.engine.removed(`${ROOT}/Plan.md`)
    await here.engine.pass(SPACE)

    const names = (await account.view()).entries.map((entry) => entry.name)
    expect(names).toContain('Plan.md')
    expect(here.store.rows('outbox')).toEqual([])

    // And the placeholder gone with no file back is a delete after all.
    await here.disk.remove(`${ROOT}/.Plan.md.icloud`)
    await here.engine.removed(`${ROOT}/Plan.md`)
    await here.engine.pass(SPACE)
    expect((await account.view()).entries.map((entry) => entry.name)).toEqual(['Ideas.md'])
  })

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

  test('a note made in a new folder in the same millisecond keeps its folder across a relaunch', async () => {
    // The folder's mkdir and the note's create are queued in one step, at one clock
    // reading. Read back after a relaunch they must still come in the order they were
    // made, whatever their ids: ids that sort the create first make it refused `gone`
    // and made again at the top of the space. The ids here are chosen to sort that way.
    let drawn = 0
    const random = vi.spyOn(Math, 'random').mockImplementation(() => (drawn += 1) * 1e-6)
    try {
      const account = new ReferenceAccount(new Clock(), SEEDED)
      const here = await device(account)
      here.online = false
      await here.disk.write(`${ROOT}/New/Idea.md`, 'hello')
      await here.engine.created(`${ROOT}/New/Idea.md`, false, 'hello')
      await here.engine.quit()
      here.engine.stop()
      await here.launch()

      here.online = true
      await here.engine.pass(SPACE)
      await here.engine.pass(SPACE)

      const entries = (await account.view()).entries
      const folder = entries.find((entry) => entry.name === 'New')
      const note = entries.find((entry) => entry.name === 'Idea.md')
      expect(folder).toBeDefined()
      expect(note?.parent).toBe(folder?.id)
      expect(here.disk.files.has(`${ROOT}/New/Idea.md`)).toBe(true)
      expect(here.disk.files.has(`${ROOT}/Idea.md`)).toBe(false)
    } finally {
      random.mockRestore()
    }
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

describe('a delete put back (#1068)', () => {
  test('brings a folder back as the entries it was, words and all, made nowhere again', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    await here.disk.mkdir(`${ROOT}/Work`)
    const folder = await here.engine.created(`${ROOT}/Work`, true)
    await here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Work/Plan.md`)
    await here.engine.moved(`${ROOT}/Plan.md`, `${ROOT}/Work/Plan.md`)
    await here.engine.pass(SPACE)

    // Into the trash, and the account hears of the delete.
    const words = here.disk.files.get(`${ROOT}/Work/Plan.md`) ?? ''
    await here.disk.remove(`${ROOT}/Work`)
    await here.engine.removed(`${ROOT}/Work`, 'trash-1')
    await here.engine.pass(SPACE)
    expect((await account.view()).entries.map((entry) => entry.id)).not.toContain(PLAN)

    // Out of the trash, where it was.
    await here.disk.mkdir(`${ROOT}/Work`)
    await here.disk.write(`${ROOT}/Work/Plan.md`, words)
    expect(await here.engine.restored(`${ROOT}/Work`, 'trash-1')).toBe(true)
    await here.engine.pass(SPACE)
    await here.engine.pass(SPACE)

    const live = (await account.view()).entries
    expect(live.map((entry) => entry.id).sort()).toEqual([PLAN, 'n2', folder].sort())
    expect(live.find((entry) => entry.id === PLAN)?.parent).toBe(folder)
    expect(await textOn(account, PLAN)).toBe(words)
    expect(here.disk.files.get(`${ROOT}/Work/Plan.md`)).toBe(words)
    expect(here.engine.core.spaces.get(SPACE)?.at('Work/Plan.md')?.id).toBe(PLAN)
  })

  test('takes back a delete the account never heard of, with the note made here', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    here.online = false
    await here.disk.write(`${ROOT}/Idea.md`, 'ship it mk5z')
    const note = await here.engine.created(`${ROOT}/Idea.md`, false, 'ship it mk5z')
    await here.disk.remove(`${ROOT}/Idea.md`)
    await here.engine.removed(`${ROOT}/Idea.md`, 'undo-1')
    await here.disk.write(`${ROOT}/Idea.md`, 'ship it mk5z')
    expect(await here.engine.restored(`${ROOT}/Idea.md`, 'undo-1')).toBe(true)
    here.online = true
    await here.engine.pass(SPACE)

    expect((await account.view()).entries.map((entry) => entry.id)).toContain(note)
    expect(await textOn(account, note ?? '')).toBe('ship it mk5z')
  })

  test('is a file made where nothing was deleted by that word', async () => {
    const here = await device()
    await here.disk.write(`${ROOT}/Other.md`, 'words')
    expect(await here.engine.restored(`${ROOT}/Other.md`, 'never')).toBe(false)
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

  test('a note that will not read is made in no other space as an empty note', async () => {
    const here = await twoSpaces()
    await here.disk.mkdir(`${ROOT}/Trip`)
    await here.engine.created(`${ROOT}/Trip`, true)
    await here.disk.write(`${ROOT}/Trip/Map.md`, '# Map\n')
    await here.engine.created(`${ROOT}/Trip/Map.md`, false, '# Map\n')

    await here.disk.move(`${ROOT}/Trip`, `${WORK_ROOT}/Trip`)
    const read = here.disk.read.bind(here.disk)
    here.disk.read = (path: string) =>
      path === `${WORK_ROOT}/Trip/Map.md` ? Promise.resolve(null) : read(path)
    await here.engine.moved(`${ROOT}/Trip`, `${WORK_ROOT}/Trip`)

    expect(held(here, WORK)).toEqual(['Trip folder'])
  })

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

  test('makes a file it was told changed and has no entry for', async () => {
    // A note that would not read at its `created`, as a Windows lock leaves one, is on
    // no entry, and its next change is the next time anything says it is there.
    const here = await device()
    const heard: ((news: SpaceNews) => void)[] = []
    watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
      heard.push(hear)
      return Promise.resolve()
    })
    const watched = watchFolders({
      engine: here.engine,
      ready: () => true,
      changed: () => undefined,
    })
    await here.disk.write(`${ROOT}/Late.md`, 'late\n')
    await here.disk.mkdir(`${ROOT}/Quiet`)
    const told = (path: string, dir: boolean) =>
      ({ kind: 'modified', path, dir, size: 1, mtime: 1, id: null }) as const
    for (const hear of heard) {
      hear({
        root: ROOT,
        changes: [told(`${ROOT}/Late.md`, false), told(`${ROOT}/Quiet`, true)],
        scan: false,
        gone: false,
      })
    }
    await vi.waitFor(() => {
      expect(here.engine.entryAt(`${ROOT}/Late.md`)).not.toBeNull()
    })
    watched.stop()

    expect(here.engine.entryAt(`${ROOT}/Quiet`)).toBeFalsy()
  })

  test.each(['modified', 'created'])(
    'leaves a space alone until its first pass is done: a %s event makes nothing',
    async (kind) => {
      // A note v1 tracks has no entry yet. The first pass matches it to its entry, and a
      // create queued here as well was `Plan.md` and `Plan 2.md`.
      const here = await device()
      const heard: ((news: SpaceNews) => void)[] = []
      watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
        heard.push(hear)
        return Promise.resolve()
      })
      const watched = watchFolders({
        engine: here.engine,
        ready: () => false,
        changed: () => undefined,
      })
      await here.disk.write(`${ROOT}/Late.md`, 'late\n')
      const change = {
        kind,
        path: `${ROOT}/Late.md`,
        dir: false,
        size: 1,
        mtime: 1,
        id: null,
      } as SpaceNews['changes'][number]
      for (const hear of heard) hear({ root: ROOT, changes: [change], scan: false, gone: false })
      await settled()
      watched.stop()

      expect(here.engine.entryAt(`${ROOT}/Late.md`)).toBeFalsy()
    },
  )

  /** A watch whose messages the test says, and a way to wait for them to be read. */
  function listening(engine: Engine) {
    const heard: ((news: SpaceNews) => void)[] = []
    watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
      heard.push(hear)
      return Promise.resolve()
    })
    const moves: string[] = []
    const watched = watchFolders({
      engine,
      ready: () => true,
      changed: () => undefined,
      moved: (from, to, kind) => {
        moves.push(`${kind} ${from} -> ${to}`)
        return Promise.resolve()
      },
    })
    const say = async (...changes: SpaceChange[]) => {
      for (const hear of heard) hear({ root: ROOT, changes, scan: false, gone: false })
      await settled()
    }
    return { say, moves, stop: () => watched.stop() }
  }
  const removed = (path: string): SpaceChange => ({ kind: 'removed', path, dir: false, id: null })
  const created = (path: string) => ({
    kind: 'created' as const,
    path,
    dir: false,
    size: 0,
    mtime: 0,
    id: null,
  })

  test('hears a rename the file list makes, halfway, as nothing: one rename, the note itself (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const { say, stop } = listening(here.engine)

    // The watcher's word on a rename can come as the old file gone and a new one made,
    // and it came before the file list had said what it did: a delete and a new note.
    await here.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`, async () => {
      await here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`)
      await say(removed(`${ROOT}/Plan.md`), created(`${ROOT}/Goals.md`))
    })
    await say(removed(`${ROOT}/Plan.md`), created(`${ROOT}/Goals.md`))
    await here.engine.pass(SPACE)
    stop()

    const live = (await account.view()).entries
    expect(live.map((entry) => [entry.id, entry.name]).sort()).toEqual([
      ['n1', 'Goals.md'],
      ['n2', 'Ideas.md'],
    ])
    expect(here.engine.entryAt(`${ROOT}/Goals.md`)?.id).toBe(PLAN)
  })

  test('reads a message that comes late against the disk as it is now (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const { say, stop } = listening(here.engine)

    await here.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`, () =>
      here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`),
    )
    // A new note at the old name, and only then the watcher's word on the rename.
    await here.disk.write(`${ROOT}/Plan.md`, 'fresh mk3z')
    const fresh = await here.engine.created(`${ROOT}/Plan.md`, false, 'fresh mk3z')
    await say(removed(`${ROOT}/Plan.md`), created(`${ROOT}/Goals.md`))
    await here.engine.pass(SPACE)
    stop()

    const live = (await account.view()).entries.map((entry) => entry.id)
    expect(live.sort()).toEqual([PLAN, 'n2', fresh].sort())
  })

  test('hears a rename the engine makes for another device, halfway, as nothing (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const there = await device(account, 'd1')
    await there.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`, () =>
      there.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`),
    )
    await there.engine.pass(SPACE)

    const { say, stop } = listening(here.engine)
    const move = here.disk.move.bind(here.disk)
    here.disk.move = async (from: string, to: string) => {
      await move(from, to)
      await say(removed(from), created(to))
    }
    await here.engine.pass(SPACE)
    await here.engine.pass(SPACE)
    stop()

    const live = (await account.view()).entries.map((entry) => [entry.id, entry.name])
    expect(live.sort()).toEqual([
      ['n1', 'Goals.md'],
      ['n2', 'Ideas.md'],
    ])
    expect(here.engine.entryAt(`${ROOT}/Goals.md`)?.id).toBe(PLAN)
  })

  test('says a rename another program made to everything kept by path (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const { say, moves, stop } = listening(here.engine)
    await here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`)
    await say({ ...created(`${ROOT}/Goals.md`), kind: 'renamed', from: `${ROOT}/Plan.md` })
    stop()

    expect(here.engine.entryAt(`${ROOT}/Goals.md`)?.id).toBe(PLAN)
    expect(moves).toEqual([`file ${ROOT}/Plan.md -> ${ROOT}/Goals.md`])
  })

  test('hears a day’s note the file list makes, first, as the day’s note still (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const there = await device(account, 'd1')
    await there.disk.write(`${ROOT}/2026-11-04.md`, 'there mk1z')
    await there.engine.created(`${ROOT}/2026-11-04.md`, false, 'there mk1z', '')
    await there.engine.pass(SPACE)

    const here = await device(account, 'd0')
    const { say, stop } = listening(here.engine)
    // The watcher's word comes before the file list has said it made the note.
    await here.disk.write(`${ROOT}/2026-11-04.md`, 'here mk2z')
    await say(created(`${ROOT}/2026-11-04.md`))
    await here.engine.created(`${ROOT}/2026-11-04.md`, false, 'here mk2z', '')
    stop()
    await here.engine.pass(SPACE)
    await here.engine.pass(SPACE)

    const days = (await account.view()).entries.filter((entry) => entry.name.startsWith('2026'))
    expect(days).toHaveLength(1)
    const words = await textOn(account, days[0]?.id ?? '')
    expect(words).toContain('mk1z')
    expect(words).toContain('mk2z')
  })

  test('a move said first keeps the name the account has where this disk spells it its own way', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    const space = here.engine.core.spaces.get(SPACE)
    const entry = here.engine.entryAt(`${ROOT}/Plan.md`)
    if (!space || !entry) throw new Error('no entry')
    await here.disk.move(`${ROOT}/Plan.md`, `${ROOT}/_Plan.md`)
    entry.local_path = '_Plan.md'
    space.changed()

    await here.engine.moving(`${ROOT}/_Plan.md`, `${ROOT}/Work/_Plan.md`, () =>
      here.disk.move(`${ROOT}/_Plan.md`, `${ROOT}/Work/_Plan.md`),
    )
    await here.engine.pass(SPACE)
    const names = (await account.view()).entries.map((one) => one.name)
    expect(names).toContain('Plan.md')
    expect(names).not.toContain('_Plan.md')

    // And back from a rename the disk would not make, under the account's name too.
    await expect(
      here.engine.moving(`${ROOT}/Work/_Plan.md`, `${ROOT}/Work/Goals.md`, () =>
        Promise.reject(new Error('in use')),
      ),
    ).rejects.toThrow('in use')
    await here.engine.pass(SPACE)
    const after = (await account.view()).entries.map((one) => one.name)
    expect(after).toContain('Plan.md')
    expect(after).not.toContain('Goals.md')
  })

  test('puts a rename back where the disk would not make it (#1068)', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const here = await device(account, 'd0')
    await expect(
      here.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Goals.md`, () =>
        Promise.reject(new Error('in use')),
      ),
    ).rejects.toThrow('in use')
    await here.engine.pass(SPACE)

    const live = (await account.view()).entries.map((entry) => entry.name)
    expect(live.sort()).toEqual(['Ideas.md', 'Plan.md'])
    expect(here.engine.entryAt(`${ROOT}/Plan.md`)?.id).toBe(PLAN)
  })

  test('hears the space’s own hidden inbox, and no other hidden file (#1044)', async () => {
    const here = await device()
    const heard: ((news: SpaceNews) => void)[] = []
    watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
      heard.push(hear)
      return Promise.resolve()
    })
    const watched = watchFolders({
      engine: here.engine,
      ready: () => true,
      changed: () => undefined,
    })
    await here.disk.write(`${ROOT}/.Inbox.md`, '- [ ] Call the bank\n')
    await here.disk.write(`${ROOT}/.secret.md`, 'not for anybody')
    const made = (path: string) =>
      ({ kind: 'created', path, dir: false, size: 1, mtime: 1, id: null }) as const
    for (const hear of heard) {
      hear({
        root: ROOT,
        changes: [made(`${ROOT}/.Inbox.md`), made(`${ROOT}/.secret.md`)],
        scan: false,
        gone: false,
      })
    }
    const space = here.engine.core.spaces.get(SPACE)
    await vi.waitFor(() => expect(space?.at('.Inbox.md')).toBeTruthy())
    await settled()
    expect(space?.at('.secret.md')).toBeFalsy()

    await here.engine.pass(SPACE)
    const account = await here.account.view()
    const inbox = account.entries.find((one) => one.name === '.Inbox.md')
    expect(inbox && account.texts[inbox.id]).toBe('- [ ] Call the bank\n')
    expect(account.entries.some((one) => one.name === '.secret.md')).toBe(false)
    watched.stop()
  })

  /** #481: past the system's limit of watched folders, the watch says so with its scan,
   *  and the reader is told once a run, however often it is said. */
  test('tells the reader once when the limit of watched folders is reached', async () => {
    const here = await device()
    const heard: ((news: SpaceNews) => void)[] = []
    watch.mockImplementation((_roots: readonly string[], hear: (news: SpaceNews) => void) => {
      heard.push(hear)
      return Promise.resolve()
    })
    told.mockReset()
    const watched = watchFolders({
      engine: here.engine,
      ready: () => true,
      changed: () => undefined,
    })
    for (const hear of heard) hear({ root: ROOT, changes: [], scan: true, gone: false })
    for (let once = 0; once < 2; once += 1) {
      for (const hear of heard) {
        hear({ root: ROOT, changes: [], scan: true, gone: false, unwatched: 'limit' })
      }
    }
    await vi.waitFor(() => expect(told).toHaveBeenCalledTimes(1))
    expect(told.mock.calls[0]?.[0]).toBe('Some changes may not be noticed')
    expect(String(told.mock.calls[0]?.[1])).toContain('fs.inotify.max_user_watches')
    watched.stop()
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

/** What a pairing says before the store has it. The roles the reader keeps for the next
 *  launch are written with the pairing (space-pairing.ts), ahead of the commit that
 *  stores it, so the folder a space is at has to be the core's word in the same moment
 *  it is paired or moved. */
describe('a pairing not committed yet', () => {
  test('is already the folder the space is at, joined and then renamed', async () => {
    const here = await device()
    const core = here.engine.core

    const joined = core.addSpace('team', '/device/Team', 'write')
    expect(core.spaces.get('team')?.row.root).toBe('/device/Team')

    const moved = core.rootMoved('team', '/device/Crew')
    expect(core.spaces.get('team')?.row).toMatchObject({ root: '/device/Crew', role: 'write' })

    await core.commit([...joined, ...moved])
    expect(core.spaces.get('team')?.row.root).toBe('/device/Crew')
  })
})

/** A copy another sync tool made beside a note: never made on the account, never
 *  written onto a disk that does not have it, never sent when it changes, and never
 *  taken off a disk when the account lets go of one - which happens only when somebody
 *  asks, from the Sync pane. See @orden/sync-core/foreign. */
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

/** Another program's copy of a plane that does not parse - cut short mid-write, or left
 *  with a merge's conflict markers - is not a plane with nothing on it: folded in, every
 *  node would go out as deleted, to every device. It is left for its program to finish,
 *  and the document keeps what it held (as v1's merge counts an unreadable side for
 *  nothing, and `openCanvas` refuses to open one). */
describe('another program’s unreadable canvas', () => {
  test('is not folded in as an empty plane', async () => {
    const one = await device()
    const path = `${ROOT}/Board.canvas`
    const good = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', text: 'keep me', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    })
    await one.disk.write(path, good)
    await one.engine.created(path, false, good)
    const id = one.engine.entryAt(path)?.id ?? ''
    expect((await one.engine.core.doc(id))?.text()).toContain('keep me')

    await one.disk.write(path, good.slice(0, -12))
    await one.engine.foreign(path)

    expect((await one.engine.core.doc(id))?.text()).toContain('keep me')
  })

  /** Words another program wrote into a canvas - or into a canvas entry renamed to
   *  `.md`, which is still one - cannot go into its plane. They are not dropped without
   *  a word: the file is kept as a version on this device, and the reader is told once
   *  that it is not syncing. */
  test('keeps words written into it, and says once that they do not sync', async () => {
    const one = await device()
    const path = `${ROOT}/Board.canvas`
    const good = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', text: 'keep me', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    })
    await one.disk.write(path, good)
    await one.engine.created(path, false, good)
    const id = one.engine.entryAt(path)?.id ?? ''
    const told: string[] = []
    one.engine.on('unsynced', (event) => told.push(event.name))

    for (const prose of ['# Board\n\nprose\n', '# Board\n\nprose\n', '{"title":"x"}']) {
      await one.disk.write(path, prose)
      await one.engine.foreign(path)
    }

    expect(one.disk.kept).toEqual([
      { path, text: '# Board\n\nprose\n' },
      { path, text: '{"title":"x"}' },
    ])
    expect(told).toEqual(['Board.canvas'])
    expect((await one.engine.core.doc(id))?.text()).toContain('keep me')
  })

  /** A program that saves by emptying the file before it writes it leaves it with
   *  nothing in it for a moment, and a watcher can hear that moment. */
  test('nor is one emptied for a moment by a save', async () => {
    const one = await device()
    const path = `${ROOT}/Board.canvas`
    const good = JSON.stringify({
      nodes: [{ id: 'a', type: 'text', text: 'keep me', x: 0, y: 0, width: 100, height: 50 }],
      edges: [],
    })
    await one.disk.write(path, good)
    await one.engine.created(path, false, good)
    const id = one.engine.entryAt(path)?.id ?? ''

    await one.disk.write(path, '')
    await one.engine.foreign(path)

    expect((await one.engine.core.doc(id))?.text()).toContain('keep me')
  })
})

describe('two spaces whose folders differ only in case', () => {
  test('a path belongs to the folder spelled like it where the disk tells case apart', () => {
    expect(relative('/s/Notes', '/s/notes/a.md', false)).toBeNull()
    expect(relative('/s/notes', '/s/notes/a.md', false)).toBe('a.md')
    expect(relative('/s/Notes', '/s/notes/a.md', true)).toBe('a.md')
    // A backslash is a separator on Windows and a character of a name anywhere else.
    expect(relative('/s/notes', '/s/notes/a\\b.md', false)).toBe('a\\b.md')
    expect(relative('C:\\s\\notes', 'C:\\s\\notes\\a\\b.md', true)).toBe('a/b.md')
  })

  // On Linux both can be there: a private note went up in the shared space, and a delete
  // in the private one took the shared one's entry away on every device.
  test.each([true, false])('and goes to its own, where foldsCase is %s', async (foldsCase) => {
    const one = await device()
    const core = one.engine.core
    ;(core.world as { foldsCase: boolean }).foldsCase = foldsCase
    await core.commit(core.addSpace('shared', '/s/Notes', 'write'))
    await core.commit(core.addSpace('private', '/s/notes', 'owner'))
    const [shared, kept] = [core.spaces.get('shared'), core.spaces.get('private')]

    await one.disk.write('/s/notes/secret.md', 'private words')
    await one.engine.created('/s/notes/secret.md', false, 'private words')
    expect(one.engine.placed('/s/notes/secret.md')?.space.id).toBe('private')
    expect([...(shared?.entries.values() ?? [])].map((entry) => entry.name)).toEqual([])
    expect(shared?.outbox).toHaveLength(0)
    expect(kept?.outbox).toHaveLength(1)

    await one.disk.write('/s/Notes/same.md', 'shared words')
    const id = await one.engine.created('/s/Notes/same.md', false, 'shared words')
    await one.engine.removed('/s/notes/same.md')
    expect(shared?.isLive(id ?? '')).toBe(true)
  })
})

describe('a note the disk will not read', () => {
  async function refusing() {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const one = await device(account, 'd0')
    const desk = await device(account, 'd1')
    const note = SEEDED[0]!
    const path = `${ROOT}/${note.name}`
    const told: string[] = []
    one.engine.on('unsynced', (event) => told.push(event.name))
    const read = one.disk.read.bind(one.disk)
    const state = { refused: true }
    one.disk.read = (at) => (state.refused && at === path ? Promise.resolve(null) : read(at))
    return { one, desk, note, path, told, state }
  }

  test('is not written over by the account, and is said to be not syncing if it lasts', async () => {
    const { one, desk, note, path, told, state } = await refusing()
    const theirs = `caf\u00e9, saved by another program\n${note.text}`
    one.disk.files.set(path, theirs)

    await desk.disk.write(path, `${note.text}and the desk wrote this\n`)
    await desk.engine.foreign(path)
    await desk.engine.pass(SPACE)
    await one.engine.pass(SPACE)

    expect(one.disk.files.get(path)).toBe(theirs)
    expect(one.disk.kept).toEqual([])
    expect(told).toEqual([])
    await one.engine.pass(SPACE)
    await one.engine.pass(SPACE)
    await one.engine.pass(SPACE)
    expect(told).toEqual([note.name])

    // Readable again, what the other program saved is folded in like any other edit, with
    // nothing to say so but the next pass.
    state.refused = false
    await one.engine.pass(SPACE)
    const words = (await one.engine.core.doc(note.id))?.text() ?? ''
    expect(words).toContain('saved by another program')
    expect(words).toContain('and the desk wrote this')
    expect(one.disk.files.get(path)).toContain('and the desk wrote this')

    // Recovered, a later spell of it is said again.
    state.refused = true
    for (let pass = 0; pass < 3; pass += 1) await one.engine.foreign(path)
    await one.engine.pass(SPACE)
    expect(told).toEqual([note.name, note.name])
  })

  test('for a moment, the next pass writes what it missed, and nothing is said', async () => {
    const { one, desk, note, path, told, state } = await refusing()
    await desk.disk.write(path, `${note.text}and the desk wrote this\n`)
    await desk.engine.foreign(path)
    await desk.engine.pass(SPACE)
    await one.engine.pass(SPACE)
    expect(one.disk.files.get(path)).toBe(note.text)

    state.refused = false
    await one.engine.pass(SPACE)
    expect(one.disk.files.get(path)).toContain('and the desk wrote this')
    expect(told).toEqual([])
  })

  test('changed by another program with nothing from the account, it is not "no change"', async () => {
    const { one, note, path, told, state } = await refusing()
    await one.disk.write(path, `caf\u00e9\n${note.text}`)
    await one.engine.foreign(path)
    for (let pass = 0; pass < 3; pass += 1) await one.engine.pass(SPACE)
    expect(told).toEqual([note.name])
    state.refused = false
    await one.engine.pass(SPACE)
    expect((await one.engine.core.doc(note.id))?.text()).toContain('caf\u00e9')
  })

  test('nor is one that is simply not there taken for one that will not read', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const one = await device(account, 'd0')
    const desk = await device(account, 'd1')
    const note = SEEDED[0]!
    const path = `${ROOT}/${note.name}`
    one.disk.files.delete(path)
    await desk.disk.write(path, `${note.text}and the desk wrote this\n`)
    await desk.engine.foreign(path)
    await desk.engine.pass(SPACE)
    await one.engine.pass(SPACE)
    expect(one.disk.files.get(path)).toContain('and the desk wrote this')
  })
})
