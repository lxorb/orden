import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, test, vi } from 'vitest'
import { holdDatabases } from '../src/held'
import { drifted, frameAt, replacement, SCENES, writtenAt } from '../src/scenes'
import { PLAN_TEXT, WRITTEN } from '../src/space'

const PREFIX = 'orden-demo:'
const SCRIPT = readFileSync(join(import.meta.dirname, '../../../../public/demo.js'), 'utf8')
class Kept {
  readonly held = new Map<string, string>()
  getItem(key: string) {
    return this.held.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.held.set(key, value)
  }
}
function visitor(search: string, light = false) {
  const real = new Kept()
  real.setItem('orden:theme-scheme', '"light"')
  const opened: string[] = []
  const deleted: string[] = []
  const fetched: string[] = []
  const queries: string[] = []
  const registered = vi.fn(() => Promise.resolve())
  const into: Record<string, unknown> = {
    URL,
    URLSearchParams,
    DOMException,
    EventTarget,
    Event,
    queueMicrotask,
    location: { href: `https://orden.so/${search}`, search },
    navigator: { serviceWorker: { register: registered }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
    document: { documentElement: { dataset: {} as Record<string, string>, style: { background: '#fff' } } },
    localStorage: real,
    caches: { keys: () => Promise.resolve(['visitor']) },
    indexedDB: {
      open: (name: string) => opened.push(name),
      deleteDatabase: (name: string) => deleted.push(name),
      databases: () =>
        Promise.resolve([
          { name: 'orden', version: 2 },
          { name: `${PREFIX}orden`, version: 2 },
        ]),
      cmp: () => 0,
    },
    BroadcastChannel: class {
      constructor(readonly name: string) {}
      close() {
        return this.name
      }
    },
    WebSocket: class {
      readonly readyState = 1
    },
    fetch: (input: string) => {
      fetched.push(input)
      return Promise.resolve('fetched')
    },
    matchMedia: (query: string) => {
      queries.push(query)
      return { matches: query === 'all' || (light && query.includes('light')) }
    },
  }
  into.window = into
  runInNewContext(SCRIPT, into)
  const root = (
    into.document as { documentElement: { dataset: Record<string, string>; style: { background: string } } }
  ).documentElement
  return { into, real, root, opened, deleted, fetched, queries, registered }
}
describe('the demo starts', () => {
  test('only when the address asks for it, and as a phone when it says so', () => {
    const plain = visitor('?space=1')
    expect(plain.into.localStorage).toBe(plain.real)
    expect(plain.root.dataset.demo).toBe(undefined)
    expect(visitor('?demo').root.dataset.demo).toBe('desktop')
    expect(visitor('?demo=phone').root.dataset.demo).toBe('phone')
  })
})
describe('a visit to the demo leaves the visitor’s own data alone', () => {
  test('its storage is held in memory, already past every first-run question', () => {
    const { into, real } = visitor('?demo')
    const held = into.localStorage as Storage
    expect(held).not.toBe(real)
    for (const key of ['orden:seeded', 'orden:setup', 'orden:renamed', 'orden:first-visit', 'orden:hints'])
      expect(held.getItem(key)).not.toBe(null)
    expect(held.getItem('orden:theme-scheme')).toBe(null)
    expect(held.getItem('orden:theme')).toBe('default')
    held.setItem('orden:theme-scheme', '"dark"')
    held.removeItem('orden:seeded')
    expect(held.getItem('orden:seeded')).toBe(null)
    expect(real.getItem('orden:theme-scheme')).toBe('"light"')
    expect(real.held.size).toBe(1)
    expect((into.sessionStorage as Storage).length).toBe(0)
  })
  test('it opens no database, cache or file of this browser, and keeps its own in memory', async () => {
    const { into, opened, deleted } = visitor('?demo')
    const databases = into.indexedDB as IDBFactory
    expect(() => databases.open('orden', 2)).toThrow()
    expect(() => databases.deleteDatabase('orden')).toThrow()
    await expect(databases.databases()).rejects.toThrow()
    expect(opened).toEqual([])
    expect(deleted).toEqual([])
    const kept = (into.navigator as { storage: StorageManager }).storage
    await expect(kept.getDirectory()).rejects.toThrow()
    await expect(kept.persist()).rejects.toThrow()
    await expect((into.caches as CacheStorage).keys()).rejects.toThrow()
    holdDatabases(into)
    const held = into.indexedDB as IDBFactory
    const db = await new Promise<IDBDatabase>((done, failed) => {
      const asked = held.open('orden', 1)
      asked.onupgradeneeded = () => asked.result.createObjectStore('files', { keyPath: 'path' })
      asked.onsuccess = () => done(asked.result)
      asked.onerror = () => failed(asked.error ?? new Error('not opened'))
    })
    const read = await new Promise<unknown>((done) => {
      const change = db.transaction('files', 'readwrite')
      change.objectStore('files').put({ path: '/Kestrel/Plan.md', content: 'plan' })
      change.oncomplete = () => {
        const got = db.transaction('files').objectStore('files').get('/Kestrel/Plan.md')
        got.onsuccess = () => done(got.result)
      }
    })
    expect(read).toEqual({ path: '/Kestrel/Plan.md', content: 'plan' })
    expect(opened).toEqual([])
  })
  test('its channels never reach the visitor’s other windows', () => {
    const Channel = visitor('?demo').into.BroadcastChannel as new (name: string) => { name: string }
    expect(new Channel('orden:windows').name).toBe(`${PREFIX}orden:windows`)
  })
  test('it registers no service worker', () => {
    const { into, registered } = visitor('?demo')
    void (into.navigator as { serviceWorker: { register: () => Promise<unknown> } }).serviceWorker.register()
    expect(registered).not.toHaveBeenCalled()
  })
  test('it stays off the network, but still reads its own pages and pictures', async () => {
    const { into, fetched } = visitor('?demo')
    const fetching = into.fetch as (input: string) => Promise<unknown>
    await expect(fetching('https://orden.so/v1/account')).rejects.toThrow()
    await expect(fetching('/v2/hub')).rejects.toThrow()
    await expect(fetching('/themes/index.json')).rejects.toThrow()
    await expect(fetching('https://example.com/')).rejects.toThrow()
    await expect(fetching('/demo/bike.svg')).resolves.toBe('fetched')
    expect(fetched).toEqual(['/demo/bike.svg'])
    const Socket = into.WebSocket as new () => { readyState: number }
    expect(new Socket().readyState).toBe(3)
  })
  test('its colours follow the system in the plain default theme, never a stored choice', () => {
    expect(visitor('?demo', true).root.dataset.theme).toBe('light')
    const dark = visitor('?demo').root
    expect(dark.dataset.theme).toBe('dark')
    expect(dark.style.background).toBe('')
  })
  test('as a phone it is touched, not pointed at', () => {
    const { into, queries } = visitor('?demo=phone')
    const media = into.matchMedia as (query: string) => { matches: boolean }
    expect(media('(hover: none) and (pointer: coarse)').matches).toBe(true)
    expect(queries).toContain('all')
    expect((into.navigator as { userAgent: string }).userAgent).toContain('iPhone')
  })
})
describe('every scene', () => {
  const origin = 'https://orden.so'
  test('is the same frame for the same place, every visit', () => {
    for (const scene of SCENES) {
      for (const at of [0, 0.25, 0.5, 0.75, 1]) expect(frameAt(scene, at, origin)).toEqual(frameAt(scene, at, origin))
    }
  })
  test('runs back the way it came, since a frame is only where the scroll is', () => {
    const there = frameAt('organize', 0.2, origin)
    frameAt('organize', 0.9, origin)
    frameAt('overview', 1, origin)
    expect(frameAt('organize', 0.2, origin)).toEqual(there)
    expect(frameAt('organize', 0.9, origin).moved).toBe(true)
    expect(there.moved).toBe(false)
  })
  test('ends with every card it began with', () => {
    for (const scene of SCENES)
      expect(frameAt(scene, 1, origin).nodes.length).toBeGreaterThanOrEqual(frameAt(scene, 0, origin).nodes.length)
  })
  test('opens and closes its views at fixed places in the scroll', () => {
    expect(frameAt('write', 0.29, origin).shown).toBe('canvas')
    expect(frameAt('write', 0.3, origin).shown).toBe('note')
    expect(frameAt('browse', 0.3, origin).shown).toBe('page')
    expect(frameAt('browse', 0.7, origin).shown).toBe('canvas')
    expect(frameAt('organize', 0.05, origin).tree).toBe(false)
    expect(frameAt('organize', 0.2, origin).tree).toBe(true)
    expect(frameAt('overview', 0.1, origin).overview).toBe(false)
    expect(frameAt('overview', 0.3, origin).overview).toBe(true)
  })
  test('builds the canvas up as the team works on it', () => {
    const ids = (scene: (typeof SCENES)[number], at: number) => frameAt(scene, at, origin).nodes.map((one) => one.id)
    expect(ids('canvas', 0)).not.toContain('bike')
    expect(ids('canvas', 0.8)).toContain('bike')
    expect(frameAt('canvas', 0.5, origin).edges.map((one) => one.id)).not.toContain('plan-ride')
    expect(frameAt('canvas', 0.6, origin).edges.map((one) => one.id)).toContain('plan-ride')
    expect(ids('browse', 0.5)).not.toContain('routes')
    expect(ids('browse', 0.7)).toContain('routes')
    expect(ids('overview', 0)).toEqual(expect.arrayContaining(['bike', 'routes']))
  })
  test('moves the teammates only while time passes', () => {
    const resting = frameAt('overview', 1, origin).hands
    expect(drifted(resting, 0)).not.toEqual(drifted(resting, 2))
    expect(drifted(resting, 3)).toEqual(drifted(resting, 3))
  })
})
describe('two teammates writing', () => {
  test('type their words in, a letter at a time, each with a caret after the last one', () => {
    const half = writtenAt(PLAN_TEXT, [5, 3])
    expect(half.text).toContain(`${WRITTEN[0].after}\n- ${WRITTEN[0].words.slice(0, 5)}\n`)
    expect(half.text.slice(half.carets[1] - 3, half.carets[1])).toBe(WRITTEN[1].words.slice(0, 3))
    const done = writtenAt(PLAN_TEXT, [WRITTEN[0].words.length, WRITTEN[1].words.length]).text
    for (const one of WRITTEN) expect(done).toContain(one.words)
  })
  test('and change only what changed', () => {
    const from = writtenAt(PLAN_TEXT, [4, 9]).text
    const to = writtenAt(PLAN_TEXT, [6, 2]).text
    const change = replacement(from, to)
    expect(change).not.toBe(null)
    if (change) expect(from.slice(0, change.from) + change.insert + from.slice(change.to)).toBe(to)
    expect(replacement(to, to)).toBe(null)
  })
})
describe('the demo', () => {
  test('never draws by chance', () => {
    const folder = join(import.meta.dirname, '../src')
    for (const name of readdirSync(folder))
      expect(readFileSync(join(folder, name), 'utf8')).not.toContain('Math.random')
    expect(SCRIPT).not.toContain('Math.random')
  })
})
