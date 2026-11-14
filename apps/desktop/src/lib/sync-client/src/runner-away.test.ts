import '../../sync-ports'
import { describe, expect, test, vi } from 'vitest'
import { hash32, frame, unframe } from '@orden/sync-core'
import { Clock, ReferenceAccount, SEEDED } from '@orden/sync-core/sim'
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
vi.mock('../../platform/src/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/src/tauri')>()),
  isNative: false,
  isDesktop: false,
}))

const { runner } = await import('./runner.svelte')
const { keptAway } = await import('../../web/away.svelte')
const { windows } = await import('../../platform/src/windows')

const ROOT = '/browser/space'
const SPACE = 'sim'

interface Open {
  current: Engine | null
  telling: { moved(from: string, to: string, kind: string): Promise<void> }
  awayHeard(engine: Engine, told: boolean): Promise<void>
}

interface Window {
  leaderId: string | null
  asked: Map<string, (value: unknown) => void>
  answering(said: { what: string; args: unknown }): Promise<unknown>
  heardAway(files: unknown): void
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

  test('are listed in another window too, which brings one back through the window syncing', async () => {
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
    const open = runner as unknown as Open & Window
    open.current = browser.engine
    const said: { kind: string; files?: unknown }[] = []
    const alone = vi.spyOn(windows, 'alone', 'get').mockReturnValue(false)
    const saying = vi.spyOn(windows, 'say').mockImplementation((kind, what = {}) => {
      said.push({ kind, ...what })
      if (kind !== 'sync-ask') return
      void open
        .answering(what as { what: string; args: unknown })
        .then((value) => open.asked.get(what.id as string)?.(value))
    })
    keptAway.clear()
    await open.awayHeard(browser.engine, false)
    const told = [...said].reverse().find((one) => one.kind === 'sync-away')
    const paths = (told?.files as { path: string }[] | undefined)?.map((one) => one.path) ?? []
    expect(paths).toEqual(expect.arrayContaining([`${ROOT}/F/a.md`, `${ROOT}/F/b.md`]))

    keptAway.clear()
    open.leaderId = 'the window syncing'
    open.heardAway(told?.files)
    expect(keptAway.under(`${ROOT}/F`)).toHaveLength(2)
    expect(await keptAway.bringBack(`${ROOT}/F/a.md`)).toBe(true)
    expect(await browser.disk.read(`${ROOT}/F/a.md`)).toBe('# a.md\n')
    expect(keptAway.under(`${ROOT}/F`).map((one) => one.path)).toEqual([`${ROOT}/F/b.md`])

    saying.mockRestore()
    alone.mockRestore()
    open.leaderId = null
    open.current = null
    keptAway.clear()
  })

  test('a search in another window hears each page as it is found, even from an older window', async () => {
    const open = runner as unknown as Window & { parts: Map<string, (value: unknown) => void> }
    const page = (name: string) => ({ hits: [{ path: `${ROOT}/${name}` }], loose: [] })
    let finalIs: 'all' | 'nothing streamed' = 'all'
    const saying = vi.spyOn(windows, 'say').mockImplementation((kind, what = {}) => {
      if (kind !== 'sync-ask') return
      const id = what.id as string
      if (finalIs === 'all') open.parts.get(id)?.(page('a.md'))
      queueMicrotask(() => open.asked.get(id)?.([page('a.md'), page('b.md')]))
    })
    keptAway.clear()
    open.leaderId = 'the window syncing'
    open.heardAway([{ id: 'n1', path: `${ROOT}/a.md`, size: 1, modified: 1 }])
    const query = { text: 'a' } as never

    const heard: string[] = []
    const searching = keptAway.search(ROOT, query, [], 10, (found) =>
      heard.push(...found.hits.map((one) => one.path)),
    )
    expect(heard).toEqual([`${ROOT}/a.md`])
    await searching
    expect(heard).toEqual([`${ROOT}/a.md`, `${ROOT}/b.md`])

    finalIs = 'nothing streamed'
    heard.length = 0
    await keptAway.search(ROOT, query, [], 10, (found) =>
      heard.push(...found.hits.map((one) => one.path)),
    )
    expect(heard).toEqual([`${ROOT}/a.md`, `${ROOT}/b.md`])

    saying.mockRestore()
    open.leaderId = null
    keptAway.clear()
  })

  test('the window syncing answers a search at once, not after the writes waiting their turn', async () => {
    const open = runner as unknown as Window & {
      taking: Promise<unknown>
      heardAsk(said: Record<string, unknown>): void
    }
    const said: { kind: string; value?: unknown }[] = []
    const saying = vi.spyOn(windows, 'say').mockImplementation((kind, what = {}) => {
      said.push({ kind, ...what })
    })
    keptAway.clear()
    keptAway.keep([{ id: 'n1', path: `${ROOT}/a.md`, size: 1, modified: 1 }], () =>
      Promise.resolve(true),
    )
    keptAway.answeredBy(new Map(), (_root, _query, _terms, _limit, onFound) => {
      onFound({ hits: [{ path: `${ROOT}/a.md` }], loose: [] } as never)
      return Promise.resolve(true)
    })
    const before = open.taking
    open.taking = new Promise(() => undefined)

    open.heardAsk({
      kind: 'sync-ask',
      id: 'q1',
      from: 'another window',
      what: 'search-away',
      args: { root: ROOT, query: { text: 'a' }, terms: [], limit: 10, excluded: [] },
    })
    await vi.waitFor(() => expect(said.map((one) => one.kind)).toEqual(['sync-part', 'sync-said']))
    expect(said[1]?.value).toEqual([{ hits: [{ path: `${ROOT}/a.md` }], loose: [] }])

    open.taking = before
    saying.mockRestore()
    keptAway.clear()
  })

  test('another window waits for a long fetch for as long as the window syncing says it is still at it', async () => {
    vi.useFakeTimers()
    const open = runner as unknown as Window & {
      alive: Map<string, () => void>
      heardAsk(said: Record<string, unknown>): void
      taking: Promise<unknown>
    }
    let asked = ''
    const saying = vi.spyOn(windows, 'say').mockImplementation((kind, what = {}) => {
      if (kind === 'sync-ask') asked = what.id as string
    })
    keptAway.clear()
    open.leaderId = 'the window syncing'
    open.heardAway([{ id: 'n1', path: `${ROOT}/a.md`, size: 1, modified: 1 }])
    let brought: boolean | null = null
    void keptAway.bringBack(`${ROOT}/a.md`).then((here) => (brought = here))
    for (let at = 0; at < 6; at++) {
      await vi.advanceTimersByTimeAsync(20_000)
      open.alive.get(asked)?.()
    }
    expect(brought).toBeNull()
    open.asked.get(asked)?.(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(brought).toBe(true)

    saying.mockRestore()
    const beats: string[] = []
    const beating = vi.spyOn(windows, 'say').mockImplementation((kind) => void beats.push(kind))
    const slow = vi
      .spyOn(open, 'answering')
      .mockImplementation(() => new Promise((done) => setTimeout(() => done(true), 25_000)))
    open.heardAsk({ kind: 'sync-ask', id: 'f1', from: 'another', what: 'fetch-away', args: {} })
    await vi.advanceTimersByTimeAsync(26_000)
    expect(beats).toEqual(['sync-alive', 'sync-alive', 'sync-said'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(beats).toHaveLength(3)

    slow.mockRestore()
    beating.mockRestore()
    open.leaderId = null
    keptAway.clear()
    vi.useRealTimers()
  })
})
