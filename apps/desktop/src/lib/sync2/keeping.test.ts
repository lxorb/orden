import { describe, expect, test } from 'vitest'
import { TEXT } from '@orden/rooms'
import { hash32 } from '@orden/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
import { frame, unframe } from '@orden/sync-core/wire'
import { HERE } from './docs'
import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { put, scan } from './store'
import { wantedRow } from './records'
import { indexed } from '@orden/scan/indexed'
import { Matcher } from '@orden/scan/search/match'
import { parseQuery } from '@orden/scan/search/query'
import type { IndexItem, SearchAnswer, SearchRequest } from '@orden/scan/wire'
import type { IndexRow, IndexStore } from '../web/index-store'
import { Indexing } from './indexing'
import type { Leaving } from './keeping'
import type { Reading } from './transport'
import type { World } from './world'

/** A browser that keeps only the words it uses (keeping.ts, #1126), against the
 *  simulator's account in memory: the tree comes down and no words with it, a note's
 *  words come down when it is asked for, and the least recently used go again past the
 *  budget, never one with anything of this device's in it. An account that does not
 *  say it serves the rest is kept whole, as every device did before. */

const ROOT = '/browser/space'
const SPACE = 'sim'
const PLAN = 'n1'
const IDEAS = 'n2'

interface Device {
  disk: MemoryDisk
  store: MemoryStore
  routes: string[]
  pulled: string[]
  online: boolean
  engine: Engine
}

/** A device that has never held the space: its row and nothing in it. `lazy` is a
 *  browser's, and `index` is whether the account's feed says it serves the rest. */
async function fresh(
  account: ReferenceAccount,
  id: string,
  { lazy = true, index = true }: { lazy?: boolean; index?: { on: boolean } | boolean } = {},
): Promise<Device> {
  const store = new MemoryStore(id)
  const seeding = store.open()
  await seeding.write([
    put('spaces', { space_id: SPACE, root: ROOT, cursor: 0, role: 'owner', store: null }),
    put('meta', wantedRow(SPACE, new Map())),
  ])
  await seeding.cleanExit(true)
  const disk = new MemoryDisk()
  const saying = typeof index === 'boolean' ? { on: index } : index
  // A clock that moves on at every look, so which note was used last is never a tie.
  let tick = 1000
  const made: Device = {
    disk,
    store,
    routes: [],
    pulled: [],
    online: true,
    engine: null as unknown as Engine,
  }
  const world: World = {
    disk,
    account: {
      ask: async (route, body) => {
        if (!made.online || route === 'prepare') return null
        made.routes.push(route)
        if (route === 'pull') {
          const asked = (body as { docs: { id: string }[] }).docs
          made.pulled.push(...asked.map((one) => one.id))
        }
        const answer = unframe(await account.handle(id, route, frame(body))) as Record<
          string,
          unknown
        >
        return route === 'feed' && saying.on ? { ...answer, index: true } : answer
      },
    },
    name: id,
    now: () => (tick += 1),
    random: Math.random,
    digest: (text) => Promise.resolve(`${String(hash32('a', text))}.${String(hash32('b', text))}`),
    join: (root, path) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
    lazy,
  }
  made.engine = await Engine.start(world, store.open(), { freshens: false })
  return made
}

/** Rows dropped as the browser drops them, and the words told on their way out. */
function letting(disk: MemoryDisk) {
  const told: { path: string; text: string }[] = []
  return {
    told,
    how: {
      drop: (path: string) => {
        disk.files.delete(path)
        return Promise.resolve()
      },
      leaving: (one: Leaving) => {
        told.push({ path: one.path, text: one.text })
        return Promise.resolve()
      },
    },
  }
}

describe('a browser that keeps only the words it uses', () => {
  test('takes the tree down and no words, and lists every note it keeps none of', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)

    expect(browser.routes).toContain('feed')
    expect(browser.pulled).toEqual([])
    expect([...browser.disk.files.keys()]).toEqual([])
    expect(
      browser.engine
        .awayFiles()
        .map((one) => one.path)
        .sort(),
    ).toEqual([`${ROOT}/Ideas.md`, `${ROOT}/Plan.md`])
  })

  test('with a second window of the app open keeps every word, those it kept away too', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    expect(browser.engine.awayFiles()).toHaveLength(2)

    browser.engine.core.crowded = true
    await browser.engine.pass(SPACE)
    expect(browser.engine.awayFiles()).toEqual([])
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
    expect(browser.disk.files.has(`${ROOT}/Ideas.md`)).toBe(true)
  })

  test("fetches a note's words when it is asked for, and keeps them in step from then on", async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)

    expect(await browser.engine.fetch(`${ROOT}/Plan.md`)).toBe(true)
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
    expect(browser.pulled).toEqual([PLAN])
    expect(browser.engine.awayFiles().map((one) => one.path)).toEqual([`${ROOT}/Ideas.md`])

    // Another device writes in both: the one kept here is pulled, the other is not.
    const other = await fresh(account, 'o', { lazy: false })
    await other.engine.pass(SPACE)
    for (const id of [PLAN, IDEAS]) {
      const doc = await other.engine.hold(id)
      doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'Later. '), HERE)
      const name = id === PLAN ? 'Plan.md' : 'Ideas.md'
      await other.disk.write(`${ROOT}/${name}`, doc?.text() ?? '')
      await other.engine.saved(`${ROOT}/${name}`, doc?.text() ?? '')
      await other.engine.letGo(id)
    }
    await other.engine.pass(SPACE)

    browser.pulled.length = 0
    await browser.engine.pass(SPACE)
    expect(browser.pulled).toEqual([PLAN])
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)?.startsWith('Later. ')).toBe(true)
    expect(browser.disk.files.has(`${ROOT}/Ideas.md`)).toBe(false)

    // And the one kept away comes down with what the other device wrote.
    expect(await browser.engine.fetch(`${ROOT}/Ideas.md`)).toBe(true)
    expect(browser.disk.files.get(`${ROOT}/Ideas.md`)?.startsWith('Later. # Ideas')).toBe(true)
  })

  test('offline, a note kept away stays asked for, and the next pass brings it', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)

    browser.online = false
    expect(await browser.engine.fetch(`${ROOT}/Plan.md`)).toBe(false)
    expect(browser.disk.files.has(`${ROOT}/Plan.md`)).toBe(false)

    browser.online = true
    await browser.engine.pass(SPACE)
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
    expect(browser.disk.files.has(`${ROOT}/Ideas.md`)).toBe(false)
  })

  test('a note whose words came and whose file would not be written stays listed', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    const write = browser.disk.write.bind(browser.disk)
    browser.disk.write = () => Promise.reject(new Error('the storage is full'))
    const there = { exists: browser.disk.exists.bind(browser.disk) }
    browser.disk.exists = (path) =>
      path === `${ROOT}/Ideas.md` ? Promise.resolve(true) : there.exists(path)

    expect(await browser.engine.fetch(`${ROOT}/Plan.md`)).toBe(false)
    expect(await browser.engine.fetch(`${ROOT}/Ideas.md`)).toBe(false)
    expect(browser.pulled).toEqual([PLAN, IDEAS])
    expect(
      browser.engine
        .awayFiles()
        .map((one) => one.path)
        .sort(),
    ).toEqual([`${ROOT}/Ideas.md`, `${ROOT}/Plan.md`])

    browser.disk.write = write
    browser.disk.exists = there.exists
    expect(await browser.engine.fetch(`${ROOT}/Plan.md`)).toBe(true)
    expect(await browser.engine.fetch(`${ROOT}/Ideas.md`)).toBe(true)
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
    expect(browser.disk.files.has(`${ROOT}/Ideas.md`)).toBe(true)
    expect(browser.engine.awayFiles()).toEqual([])
  })

  test('lets go of the least recently used past the budget, and fetches it again whole', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    await browser.engine.fetch(`${ROOT}/Plan.md`)
    await browser.engine.fetch(`${ROOT}/Ideas.md`)
    // Plan used last.
    await browser.engine.hold(PLAN)
    await browser.engine.letGo(PLAN)

    const { told, how } = letting(browser.disk)
    const ideas = SEEDED[1]?.text.length ?? 0
    const plan = SEEDED[0]?.text.length ?? 0
    expect(await browser.engine.trim(plan + ideas - 1, how)).toBe(1)

    expect(told).toEqual([{ path: 'Ideas.md', text: SEEDED[1]?.text }])
    expect(browser.disk.files.has(`${ROOT}/Ideas.md`)).toBe(false)
    expect(browser.disk.files.has(`${ROOT}/Plan.md`)).toBe(true)
    expect(browser.engine.core.hasDoc(IDEAS)).toBe(false)
    const [written] = await browser.store.open().read([scan('written')])
    expect(written.map((one) => one.id)).toEqual([PLAN])
    expect(browser.engine.awayFiles().map((one) => one.path)).toEqual([`${ROOT}/Ideas.md`])

    // A let-go is no delete: the account still has it, and so does the tree.
    expect((await account.view()).texts[IDEAS]).toBe(SEEDED[1]?.text)
    expect(await browser.engine.fetch(`${ROOT}/Ideas.md`)).toBe(true)
    expect(browser.disk.files.get(`${ROOT}/Ideas.md`)).toBe(SEEDED[1]?.text)
  })

  test('never lets go of a note with anything of this device in it, nor an open one', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    await browser.engine.fetch(`${ROOT}/Plan.md`)
    await browser.engine.fetch(`${ROOT}/Ideas.md`)

    // Typed in and not sent: pending.
    const plan = await browser.engine.hold(PLAN)
    plan?.live?.transact(() => plan.live?.getText(TEXT).insert(0, 'Mine. '), HERE)
    // Autosave writes the file, and then says so.
    await browser.disk.write(`${ROOT}/Plan.md`, plan?.text() ?? '')
    await browser.engine.saved(`${ROOT}/Plan.md`, plan?.text() ?? '')
    await browser.engine.letGo(PLAN)
    // Open in a tab.
    await browser.engine.hold(IDEAS)

    const { how } = letting(browser.disk)
    expect(await browser.engine.trim(0, how)).toBe(0)
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)?.startsWith('Mine. ')).toBe(true)

    // Once it has gone up and been let go of, it may go.
    await browser.engine.pass(SPACE)
    await browser.engine.letGo(IDEAS)
    expect(await browser.engine.trim(0, how)).toBe(2)
    expect((await account.view()).texts[PLAN]).toMatch(/^Mine\. /)
  })

  test('a let-go cut short drops the rest of the row at the next trim', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    await browser.engine.fetch(`${ROOT}/Plan.md`)

    let cut = true
    const how = {
      drop: (path: string) => {
        if (cut) return Promise.reject(new Error('the tab closed'))
        browser.disk.files.delete(path)
        return Promise.resolve()
      },
    }
    await expect(browser.engine.trim(0, how)).rejects.toThrow('the tab closed')
    expect(browser.disk.files.has(`${ROOT}/Plan.md`)).toBe(true)
    expect(browser.engine.awayFiles().map((one) => one.path)).toContain(`${ROOT}/Plan.md`)

    cut = false
    await browser.engine.trim(0, how)
    expect(browser.disk.files.has(`${ROOT}/Plan.md`)).toBe(false)
    expect(await browser.engine.fetch(`${ROOT}/Plan.md`)).toBe(true)
    expect(browser.disk.files.get(`${ROOT}/Plan.md`)).toBe(SEEDED[0]?.text)
  })

  test('a note kept away is renamed and deleted by its id, with no words fetched', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)

    // The file list's moves and deletes, said before the disk has them; there is no row
    // to move, so the disk's part is nothing.
    await browser.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Later.md`, () => Promise.resolve())
    await browser.engine.removing(`${ROOT}/Ideas.md`, () => Promise.resolve())
    expect(browser.engine.awayFiles().map((one) => one.path)).toEqual([`${ROOT}/Later.md`])
    await browser.engine.pass(SPACE)

    const tree = account.tree.entries
    expect(tree.get(PLAN)?.name).toBe('Later.md')
    expect(tree.get(IDEAS)?.deleted).toBe(true)
    expect(browser.pulled).toEqual([])
    expect(browser.disk.files.size).toBe(0)
  })

  test('a delete of a note kept away takes the words it was listed with, and no later ones', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const other = await fresh(account, 'o', { lazy: false })
    await other.engine.pass(SPACE)
    const write = async (id: string, name: string, words: string) => {
      const doc = await other.engine.hold(id)
      doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, words), HERE)
      await other.disk.write(`${ROOT}/${name}`, doc?.text() ?? '')
      await other.engine.saved(`${ROOT}/${name}`, doc?.text() ?? '')
      await other.engine.letGo(id)
      // Twice: the second hears the account take the words, and sends nothing more.
      await other.engine.pass(SPACE)
      await other.engine.pass(SPACE)
    }
    // Written in before the browser listed it: what it was shown, so its delete stands.
    await write(IDEAS, 'Ideas.md', 'Earlier. ')
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    // Written in after: words the browser was never told of, which its delete leaves.
    await write(PLAN, 'Plan.md', 'Later. ')

    await browser.engine.removing(`${ROOT}/Ideas.md`, () => Promise.resolve())
    await browser.engine.removing(`${ROOT}/Plan.md`, () => Promise.resolve())
    await browser.engine.pass(SPACE)
    await browser.engine.pass(SPACE)

    expect(account.tree.entries.get(IDEAS)?.deleted).toBe(true)
    expect(account.tree.entries.get(PLAN)?.deleted).toBe(false)
    expect(browser.engine.awayFiles().map((one) => one.path)).toEqual([`${ROOT}/Plan.md`])
  })

  test('and a folder deleted takes the notes kept away inside it, as they were listed', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const other = await fresh(account, 'o', { lazy: false })
    await other.engine.pass(SPACE)
    await other.disk.mkdir(`${ROOT}/Box`)
    await other.engine.created(`${ROOT}/Box`, true)
    await other.engine.moving(`${ROOT}/Ideas.md`, `${ROOT}/Box/Ideas.md`, () =>
      other.disk.move(`${ROOT}/Ideas.md`, `${ROOT}/Box/Ideas.md`),
    )
    await other.engine.pass(SPACE)
    await other.engine.pass(SPACE)

    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    expect(browser.engine.awayFiles().map((one) => one.path)).toContain(`${ROOT}/Box/Ideas.md`)
    await browser.engine.removing(`${ROOT}/Box`, () => Promise.resolve())
    await browser.engine.pass(SPACE)
    await browser.engine.pass(SPACE)

    expect(account.tree.entries.get(IDEAS)?.deleted).toBe(true)
    expect(browser.engine.awayFiles().map((one) => one.path)).toEqual([`${ROOT}/Plan.md`])
  })

  test('an account that does not say it serves the rest, and a desktop, are kept whole', async () => {
    for (const how of [{ index: false }, { lazy: false }]) {
      const account = new ReferenceAccount(new Clock(), SEEDED)
      const device = await fresh(account, 'b', how)
      await device.engine.pass(SPACE)
      expect(device.pulled.sort()).toEqual([PLAN, IDEAS])
      expect(device.disk.files.size).toBe(2)
      expect(device.engine.awayFiles()).toEqual([])
    }
  })

  test('an account that stops saying so is kept whole again from the next pass', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const saying = { on: true }
    const browser = await fresh(account, 'b', { index: saying })
    await browser.engine.pass(SPACE)
    expect(browser.pulled).toEqual([])

    saying.on = false
    // A change on the account, so the feed has a page to say it on.
    const other = await fresh(account, 'o', { lazy: false })
    await other.engine.pass(SPACE)
    const doc = await other.engine.hold(PLAN)
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, 'Now. '), HERE)
    await other.disk.write(`${ROOT}/Plan.md`, doc?.text() ?? '')
    await other.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    await other.engine.pass(SPACE)

    await browser.engine.pass(SPACE)
    await browser.engine.pass(SPACE)
    expect(browser.disk.files.size).toBe(2)
    expect(browser.engine.awayFiles()).toEqual([])
  })
})

/** The account's half of #1126 as the Worker answers it (sync2/reading.ts), over the
 *  simulator's account: each note's scan from its words, and a search of them a note
 *  per page, so paging is walked. `missing` is a Worker from before the routes. */
function readingOf(account: ReferenceAccount, how = { missing: false }) {
  const asked: { route: string; ids: string[] }[] = []
  const reading: Reading = {
    async index(_space, ids) {
      asked.push({ route: 'index', ids: [...ids] })
      if (how.missing) return 'missing'
      const { texts } = await account.view()
      return ids.map((id): IndexItem => {
        const entry = account.tree.entries.get(id)
        if (!entry || entry.deleted) return { id, refused: 'gone' }
        const stamp = { size: 0, mtime: 0, ctime: 0 }
        return { id, docSeq: entry.docSeq, scan: indexed(entry.name, texts[id] ?? '', stamp) }
      })
    },
    async search(_space, request: SearchRequest): Promise<SearchAnswer | 'missing' | null> {
      asked.push({ route: 'search', ids: request.skip ?? [] })
      if (how.missing) return 'missing'
      const { texts } = await account.view()
      const notes = [...account.tree.entries.values()]
        .filter(
          (one) =>
            !one.deleted && one.id > (request.after ?? '') && !request.skip?.includes(one.id),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
      const one = notes[0]
      if (!one) return { hits: [], loose: [], after: null }
      const note = { path: one.name, relative: one.name, name: one.name, body: texts[one.id] ?? '' }
      const hits = new Matcher(request.query)
        .hits(note, request.limit)
        .map((hit) => ({ ...hit, id: one.id }))
      return { hits, loose: [], after: notes.length > 1 ? one.id : null }
    },
  }
  return { reading, asked }
}

function memoryIndex(): IndexStore & { rows: Map<string, IndexRow> } {
  const rows = new Map<string, IndexRow>()
  return {
    rows,
    of: (space) => Promise.resolve([...rows.values()].filter((one) => one.space === space)),
    put: (some) => {
      for (const one of some) rows.set(one.id, one)
      return Promise.resolve()
    },
    remove: (ids) => {
      for (const id of ids) rows.delete(id)
      return Promise.resolve()
    },
    close: () => undefined,
  }
}

describe('what a browser knows of the notes it keeps no words of', () => {
  test("asks for each one's scan once per version of its words", async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    const { reading, asked } = readingOf(account)
    const store = memoryIndex()
    const indexing = new Indexing(browser.engine, reading, store)

    const first = await indexing.refresh()
    expect(asked).toEqual([{ route: 'index', ids: [PLAN, IDEAS] }])
    expect(first[0]?.root).toBe(ROOT)
    expect(first[0]?.scans.map((one) => one.path).sort()).toEqual(['Ideas.md', 'Plan.md'])
    expect(indexing.scans().get(IDEAS)?.headings).toEqual(['Ideas'])
    expect(await indexing.refresh()).toEqual([])
    expect(asked).toHaveLength(1)

    // Another device writes in one: that one is asked for again, and only that one.
    const other = await fresh(account, 'o', { lazy: false })
    await other.engine.pass(SPACE)
    const doc = await other.engine.hold(IDEAS)
    doc?.live?.transact(() => doc.live?.getText(TEXT).insert(0, '# New\n'), HERE)
    await other.disk.write(`${ROOT}/Ideas.md`, doc?.text() ?? '')
    await other.engine.saved(`${ROOT}/Ideas.md`, doc?.text() ?? '')
    await other.engine.letGo(IDEAS)
    await other.engine.pass(SPACE)
    await other.engine.pass(SPACE)
    await browser.engine.pass(SPACE)
    await indexing.refresh()
    expect(asked.at(-1)).toEqual({ route: 'index', ids: [IDEAS] })
    expect(indexing.scans().get(IDEAS)?.headings).toEqual(['New', 'Ideas'])

    // Kept across a launch, in its own store.
    const again = new Indexing(browser.engine, reading, store)
    expect(await again.refresh()).toEqual([])
    expect(again.scans().get(PLAN)?.path).toBe('Plan.md')
  })

  test('a note let go of leaves its scan made here, and nothing is asked for it', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    await browser.engine.fetch(`${ROOT}/Plan.md`)
    const { reading, asked } = readingOf(account)
    const indexing = new Indexing(browser.engine, reading, memoryIndex())
    await browser.engine.trim(0, {
      drop: (path) => Promise.resolve(void browser.disk.files.delete(path)),
      leaving: (one) => indexing.leaving(one),
    })
    expect(indexing.scans().get(PLAN)?.path).toBe('Plan.md')
    await indexing.refresh()
    expect(asked).toEqual([{ route: 'index', ids: [IDEAS] }])
  })

  test('a search of them pages through the account, by the path each is shown at', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    await browser.engine.moving(`${ROOT}/Plan.md`, `${ROOT}/Later.md`, () => Promise.resolve())
    const { reading, asked } = readingOf(account)
    const indexing = new Indexing(browser.engine, reading, memoryIndex())

    const found: string[] = []
    await indexing.search(
      ROOT,
      parseQuery('e'),
      [],
      10,
      (batch) => {
        found.push(...batch.hits.map((hit) => `${hit.path}:${String(hit.line)}`))
      },
      [],
    )
    expect(asked.map((one) => one.route)).toEqual(['search', 'search'])
    expect(found.some((one) => one.startsWith(`${ROOT}/Later.md:`))).toBe(true)
    expect(found.some((one) => one.startsWith(`${ROOT}/Ideas.md:`))).toBe(true)

    // What is kept here is walked here, and left out of the account's walk.
    await browser.engine.fetch(`${ROOT}/Ideas.md`)
    asked.length = 0
    await indexing.search(ROOT, parseQuery('e'), [], 1, () => undefined, [])
    expect(asked).toEqual([{ route: 'search', ids: [IDEAS] }])
  })

  test('an account with no route for it keeps the space whole from the next pass', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const browser = await fresh(account, 'b')
    await browser.engine.pass(SPACE)
    const { reading } = readingOf(account, { missing: true })
    const indexing = new Indexing(browser.engine, reading, memoryIndex())

    expect(await indexing.refresh()).toEqual([])
    expect(browser.engine.keepingFew()).toEqual([])
    await browser.engine.pass(SPACE)
    expect(browser.disk.files.size).toBe(2)
    expect(browser.engine.awayFiles()).toEqual([])

    // And it stays whole across a launch, while the feed still says it serves the rest.
    const launched = await Engine.start(browser.engine.core.world, browser.store.open(), {
      freshens: false,
    })
    expect(launched.keepingFew()).toEqual([])
  })
})
