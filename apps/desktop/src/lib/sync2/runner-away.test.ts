import { describe, expect, test, vi } from 'vitest'
import { hash32 } from '@orden/sync-core/seed'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
import { frame, unframe } from '@orden/sync-core/wire'
import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { put } from './store'
import { wantedRow } from './records'
import type { World } from './world'

vi.stubGlobal('localStorage', {
  length: 0,
  key: () => null,
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  isNative: false,
  isDesktop: false,
}))

const { runner } = await import('./runner.svelte')
const { keptAway } = await import('../web/away.svelte')

const ROOT = '/browser/space'
const SPACE = 'sim'

interface Open {
  current: Engine | null
  telling: { moved(from: string, to: string, kind: string): Promise<void> }
  awayHeard(engine: Engine, told: boolean): Promise<void>
}

async function device(account: ReferenceAccount, id: string, lazy: boolean) {
  const store = new MemoryStore(id)
  const seeding = store.open()
  await seeding.write([
    put('spaces', { space_id: SPACE, root: ROOT, cursor: 0, role: 'owner', store: null }),
    put('meta', wantedRow(SPACE, new Map())),
  ])
  await seeding.cleanExit(true)
  const disk = new MemoryDisk()
  let tick = 1000
  const world: World = {
    disk,
    account: {
      ask: async (route, body) => {
        if (route === 'prepare') return null
        const answer = unframe(await account.handle(id, route, frame(body))) as Record<
          string,
          unknown
        >
        return route === 'feed' ? { ...answer, index: true } : answer
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
  return { disk, engine: await Engine.start(world, store.open(), { freshens: false }) }
}

describe('a browser moving a folder of notes it keeps no words of', () => {
  test('lists them at their new place only once the move is done, and says each moved', async () => {
    const account = new ReferenceAccount(new Clock(), SEEDED)
    const other = await device(account, 'o', false)
    await other.engine.pass(SPACE)
    await other.disk.mkdir(`${ROOT}/F`)
    await other.engine.created(`${ROOT}/F`, true)
    for (const name of ['a.md', 'b.md']) {
      await other.disk.write(`${ROOT}/F/${name}`, `# ${name}\n`)
      await other.engine.created(`${ROOT}/F/${name}`, false, `# ${name}\n`)
    }
    await other.engine.pass(SPACE)

    const browser = await device(account, 'b', true)
    await browser.engine.pass(SPACE)
    const open = runner as unknown as Open
    open.current = browser.engine
    const moved: string[] = []
    const telling = vi
      .spyOn(open.telling, 'moved')
      .mockImplementation((from, to) => Promise.resolve(void moved.push(`${from} -> ${to}`)))
    keptAway.clear()
    await open.awayHeard(browser.engine, false)
    expect(keptAway.under(`${ROOT}/F`)).toHaveLength(2)

    let during: number | null = null
    await runner.doer(
      { op: 'moved', from: `${ROOT}/F`, to: `${ROOT}/G`, kind: 'folder', root: ROOT },
      async () => {
        await open.awayHeard(browser.engine, true)
        during = keptAway.under(`${ROOT}/G`).length
      },
    )

    expect(during).toBe(0)
    expect(
      keptAway
        .under(`${ROOT}/G`)
        .map((one) => one.path)
        .sort(),
    ).toEqual([`${ROOT}/G/a.md`, `${ROOT}/G/b.md`])
    expect(keptAway.under(`${ROOT}/F`)).toEqual([])
    expect(moved.sort()).toEqual([
      `${ROOT}/F/a.md -> ${ROOT}/G/a.md`,
      `${ROOT}/F/b.md -> ${ROOT}/G/b.md`,
    ])
    telling.mockRestore()
    open.current = null
    keptAway.clear()
  })
})
