import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(join(import.meta.dirname, '../../../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://orden.test'
type Kept = Map<string, Response>
class Shelf {
  readonly named = new Map<string, Kept>()
  open(name: string) {
    const kept = this.named.get(name) ?? new Map<string, Response>()
    this.named.set(name, kept)
    return Promise.resolve({
      match: (asked: string | Request) => Promise.resolve(kept.get(plain(asked))?.clone()),
      put: (asked: string | Request, response: Response) =>
        Promise.resolve(void kept.set(plain(asked), response.clone())),
      keys: () => Promise.resolve([...kept.keys()]),
    })
  }
  has(name: string) {
    return Promise.resolve(this.named.has(name))
  }
  delete(name: string) {
    return Promise.resolve(this.named.delete(name))
  }
  keys() {
    return Promise.resolve([...this.named.keys()])
  }
  match(asked: string | Request) {
    for (const kept of this.named.values()) {
      const found = kept.get(plain(asked))
      if (found) return Promise.resolve(found.clone())
    }
    return Promise.resolve(undefined)
  }
  code(): string[] {
    return [...this.named.keys()].filter((name) => name.startsWith('orden-code-'))
  }
}
function plain(asked: string | Request): string {
  const url = new URL(typeof asked === 'string' ? asked : asked.url, ORIGIN)
  return `${url.origin}${url.pathname}`
}
function served(site: Map<string, string>, online: { yes: boolean }, asked: string[]) {
  return (request: Request | string) => {
    const url = new URL(typeof request === 'string' ? request : request.url)
    asked.push(url.pathname)
    if (!online.yes) return Promise.reject(new TypeError('Failed to fetch'))
    const body = site.get(url.pathname)
    if (body === undefined) return Promise.resolve(new Response('Not found', { status: 404 }))
    const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8'
    return Promise.resolve(new Response(body, { headers: { 'Content-Type': type } }))
  }
}
function worker(site: Map<string, string>) {
  const listeners = new Map<string, (event: unknown) => void>()
  const online = { yes: true }
  const asked: string[] = []
  const shelf = new Shelf()
  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
    addEventListener: (kind: string, heard: (event: unknown) => void) => listeners.set(kind, heard),
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- the worker is a classic script, run here with a world of our own
  new Function('self', 'caches', 'fetch', SOURCE)(self, shelf, served(site, online, asked))
  const dispatch = async (kind: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = []
    let answered: Promise<Response> | undefined
    listeners.get(kind)?.({
      ...event,
      waitUntil: (until: Promise<unknown>) => waits.push(until),
      respondWith: (given: Promise<Response>) => (answered = given),
    })
    const response = await answered?.catch(() => null)
    await Promise.all(waits)
    return response
  }
  return {
    online,
    asked,
    shelf,
    activate: () => dispatch('activate', {}),
    open: (path: string) =>
      dispatch('fetch', {
        request: {
          method: 'GET',
          mode: 'navigate',
          url: `${ORIGIN}${path}`,
          headers: new Headers(),
        },
      }),
    load: (path: string) => dispatch('fetch', { request: new Request(`${ORIGIN}${path}`) }),
  }
}
const page = (...scripts: string[]) =>
  `<!doctype html><title>Orden</title>${scripts.map((one) => `<script type="module" src="${one}"></script>`).join('')}`
describe('the web app, offline', () => {
  test('opens from what it kept: the page and the code it named, kept when the worker started', async () => {
    const site = new Map([
      ['/', page('/assets/main-a1.js')],
      ['/assets/main-a1.js', 'main'],
    ])
    const app = worker(site)
    await app.activate()
    app.online.yes = false
    const shown = await app.open('/')
    expect(await shown?.text()).toBe(page('/assets/main-a1.js'))
    expect(await (await app.load('/assets/main-a1.js'))?.text()).toBe('main')
    expect(await (await app.open('/Notes/Plan.md?orden=x'))?.text()).toBe(page('/assets/main-a1.js'))
  })
  test('keeps a part of the app loaded later, and asks the network for it no more', async () => {
    const site = new Map([
      ['/', page('/assets/main-a1.js')],
      ['/assets/main-a1.js', 'main'],
      ['/assets/rename-b2.js', 'rename'],
    ])
    const app = worker(site)
    await app.open('/')
    await app.load('/assets/rename-b2.js')
    app.online.yes = false
    app.asked.length = 0
    expect(await (await app.load('/assets/rename-b2.js'))?.text()).toBe('rename')
    expect(app.asked).toEqual([])
  })
  test('online, the page always comes from the network, so a release is seen at once', async () => {
    const site = new Map([
      ['/', page('/assets/main-a1.js')],
      ['/assets/main-a1.js', 'main'],
    ])
    const app = worker(site)
    await app.open('/')
    site.set('/', page('/assets/main-c3.js'))
    site.set('/assets/main-c3.js', 'main, newer')
    expect(await (await app.open('/'))?.text()).toBe(page('/assets/main-c3.js'))
    app.online.yes = false
    expect(await (await app.open('/'))?.text()).toBe(page('/assets/main-c3.js'))
    expect(await (await app.load('/assets/main-c3.js'))?.text()).toBe('main, newer')
  })
  test('keeps nothing the server could not find', async () => {
    const app = worker(new Map([['/', page()]]))
    await app.open('/')
    expect((await app.load('/assets/gone-d4.js'))?.status).toBe(404)
    app.online.yes = false
    expect(await app.load('/assets/gone-d4.js')).toBeNull()
  })
  test('lets go of the code of all but the last three releases', async () => {
    const site = new Map<string, string>()
    const app = worker(site)
    for (const release of ['r1', 'r2', 'r3', 'r4']) {
      site.set('/', page(`/assets/main-${release}.js`))
      site.set(`/assets/main-${release}.js`, release)
      await app.open('/')
    }
    expect(app.shelf.code()).toHaveLength(3)
    app.online.yes = false
    expect(await app.load('/assets/main-r1.js')).toBeNull()
    expect(await (await app.load('/assets/main-r4.js'))?.text()).toBe('r4')
  })
})
