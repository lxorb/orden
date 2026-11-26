import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, test } from 'vitest'

const APP = join(import.meta.dirname, '../../../../..')
const SOURCE = readFileSync(join(APP, 'public/sw.js'), 'utf8')
type Heard = (event: { waitUntil(work: Promise<unknown>): void }) => void
function load(kept: string[] | null) {
  const listeners = new Map<string, Heard>()
  const state = { skipped: 0, unregistered: 0, deleted: [] as string[] }
  const self = {
    skipWaiting: () => {
      state.skipped++
    },
    registration: {
      unregister: () => {
        state.unregistered++
        return Promise.resolve(true)
      },
    },
    addEventListener: (kind: string, heard: Heard) => {
      listeners.set(kind, heard)
    },
  }
  const caches = kept && {
    keys: () => Promise.resolve([...kept]),
    delete: (name: string) => {
      state.deleted.push(name)
      return Promise.resolve(true)
    },
  }
  runInNewContext(SOURCE, caches ? { self, caches } : { self })
  const fire = async (kind: string) => {
    const waited: Promise<unknown>[] = []
    listeners.get(kind)?.({
      waitUntil: (work) => {
        waited.push(work)
      },
    })
    await Promise.all(waited)
  }
  return { state, fire, kinds: () => [...listeners.keys()].sort() }
}
describe('the worker a browser that once installed the app still asks for', () => {
  test('takes over at once, deletes the app it kept and unregisters itself', async () => {
    const worker = load(['orden-pages', 'orden-code-first', 'orden-code-3f9a0c17e2b4d685'])
    await worker.fire('install')
    expect(worker.state.skipped).toBe(1)
    await worker.fire('activate')
    expect(worker.state.deleted.sort()).toEqual(['orden-code-3f9a0c17e2b4d685', 'orden-code-first', 'orden-pages'])
    expect(worker.state.unregistered).toBe(1)
  })
  test('deletes no cache that is not the app’s own', async () => {
    const worker = load(['orden-pages', 'someone-else', 'orden-codex', 'orden-pages-2', 'orden'])
    await worker.fire('activate')
    expect(worker.state.deleted).toEqual(['orden-pages'])
    expect(worker.state.unregistered).toBe(1)
  })
  test('unregisters where there are no caches at all', async () => {
    const worker = load(null)
    await worker.fire('activate')
    expect(worker.state.unregistered).toBe(1)
  })
  test('answers no request, shows no notice and keeps nothing', () => {
    expect(load([]).kinds()).toEqual(['activate', 'install'])
    for (const word of ['fetch', 'caches.open', 'indexedDB', 'importScripts', 'clients']) {
      expect(SOURCE, word).not.toContain(word)
    }
  })
})
describe('the app in a browser is a page and nothing more', () => {
  const pages = readdirSync(APP).filter((name) => name.endsWith('.html'))
  const source = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((one) =>
      one.isDirectory()
        ? source(join(dir, one.name))
        : /\.(ts|svelte|js)$/.test(one.name) && !one.name.endsWith('.test.ts')
          ? [join(dir, one.name)]
          : [],
    )
  test('no page links a manifest or asks to be installed', () => {
    expect(pages.length).toBeGreaterThan(3)
    for (const name of pages) {
      const page = readFileSync(join(APP, name), 'utf8')
      expect(page, name).not.toMatch(/rel="manifest"|mobile-web-app-capable|apple-mobile-web-app|apple-touch-icon/)
    }
    expect(readdirSync(join(APP, 'public')).filter((name) => name.endsWith('.webmanifest'))).toEqual([])
  })
  test('nothing the app runs registers a service worker', () => {
    const files = [...source(join(APP, 'src')), join(APP, 'public/demo.js')].filter(existsSync)
    expect(files.length).toBeGreaterThan(500)
    const asking = files.filter((file) => /serviceWorker|display-mode:\s*standalone/.test(readFileSync(file, 'utf8')))
    expect(asking.map((file) => file.slice(APP.length + 1))).toEqual([])
  })
})
