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
      leaving: (path: string, text: string) => {
        told.push({ path, text })
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

    expect(told).toEqual([{ path: `${ROOT}/Ideas.md`, text: SEEDED[1]?.text }])
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
    await other.engine.saved(`${ROOT}/Plan.md`, doc?.text() ?? '')
    await other.engine.pass(SPACE)

    await browser.engine.pass(SPACE)
    await browser.engine.pass(SPACE)
    expect(browser.disk.files.size).toBe(2)
    expect(browser.engine.awayFiles()).toEqual([])
  })
})
