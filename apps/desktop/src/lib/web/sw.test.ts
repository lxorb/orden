/** The asset worker, driven without a browser.
 *
 *  public/sw.js is a classic script rather than a module, so it is read and run
 *  here with a `self` and an `indexedDB` of our own and its `fetch` listener is
 *  asked the questions a page asks it. What is under test is the answer: whether
 *  it answers at all, what it says the bytes are, how long they may be kept, and
 *  what a picture that is not there gets.
 *
 *  The reading of real rows out of real storage is not something a fake can say
 *  anything true about; that is the drive's, in test/e2e/pictures.py, where a real
 *  browser installs the real worker over the real store. */

import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, test } from 'vitest'

const SW = new URL('../../../public/sw.js', import.meta.url)
const SOURCE = readFileSync(SW, 'utf8')

const ORIGIN = 'http://127.0.0.1:18967'

/** A one-pixel PNG, as the store keeps one: base64 in a row. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

interface Row {
  path: string
  type: string
  data: string
  modified: number
}

interface Worker {
  fetch(url: string, method?: string): Promise<Response | null>
}

/** The file, run over rows of our own. A fresh evaluation each time, because the
 *  worker holds its database open between requests. */
function load(rows: readonly Row[], options: { store?: boolean; broken?: boolean } = {}): Worker {
  const { store = true, broken = false } = options
  const listeners = new Map<string, (event: unknown) => void>()

  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: { claim: () => Promise.resolve() },
    addEventListener: (kind: string, heard: (event: unknown) => void) => {
      listeners.set(kind, heard)
    },
  }

  const by = new Map(rows.map((row) => [row.path, row]))

  const indexedDB = {
    open: () => {
      const request: Record<string, unknown> = {}

      queueMicrotask(() => {
        if (broken) {
          request.error = new Error('no')
          ;(request.onerror as (() => void) | undefined)?.()
          return
        }

        request.result = {
          objectStoreNames: { contains: (name: string) => store && name === 'assets' },
          transaction: () => ({
            objectStore: () => ({
              get: (path: string) => {
                const read: Record<string, unknown> = {}
                queueMicrotask(() => {
                  read.result = by.get(path)
                  ;(read.onsuccess as (() => void) | undefined)?.()
                })
                return read
              },
            }),
          }),
        }
        ;(request.onsuccess as (() => void) | undefined)?.()
      })

      return request
    },
  }

  new Function('self', 'indexedDB', SOURCE)(self, indexedDB)

  return {
    fetch: (url: string, method = 'GET') => {
      const heard = listeners.get('fetch')
      if (!heard) throw new Error('the worker never listened for a fetch')

      let answered: Promise<Response> | null = null
      heard({
        request: { method, url },
        respondWith: (given: Promise<Response>) => {
          answered = given
        },
      })

      return Promise.resolve(answered)
    },
  }
}

function pixel(path: string, type = 'image/png'): Row {
  return { path, type, data: PIXEL, modified: 1 }
}

describe('the asset worker', () => {
  let worker: Worker

  beforeEach(() => {
    worker = load([
      pixel('/Work/assets/0123456789abcdef.png'),
      pixel('/Work/assets/diagram.svg', 'image/svg'),
      pixel('/Work/Read me/a b.png'),
      pixel('/Work/notes/screenshot.png'),
    ])
  })

  test('answers for the asset route and for nothing else', async () => {
    expect(await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)).not.toBeNull()
    // The app's own chunks, the page itself, another origin's picture: left alone
    // entirely rather than passed through, so nothing of the app is ever served
    // from here.
    expect(await worker.fetch(`${ORIGIN}/assets/index-a1b2.js`)).toBeNull()
    expect(await worker.fetch(`${ORIGIN}/`)).toBeNull()
    expect(await worker.fetch('https://example.com/asset/Work/pic.png')).toBeNull()
  })

  test('leaves anything that is not a read alone', async () => {
    expect(await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`, 'POST')).toBeNull()
  })

  test('a hit answers with the bytes in the row', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)
    expect(answer?.status).toBe(200)

    const bytes = new Uint8Array((await answer?.arrayBuffer()) ?? new ArrayBuffer(0))
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(answer?.headers.get('content-length')).toBe(String(bytes.length))
  })

  test('a name with a space in it is the row it was encoded from', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/Read%20me/a%20b.png`)
    expect(answer?.status).toBe(200)
  })

  test('the type comes from the name, not from what the row claims', async () => {
    const png = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)
    expect(png?.headers.get('content-type')).toBe('image/png')

    // The row says `image/svg`, which draws nothing at all.
    const svg = await worker.fetch(`${ORIGIN}/asset/Work/assets/diagram.svg`)
    expect(svg?.headers.get('content-type')).toBe('image/svg+xml')
  })

  test('a picture named by its own hash is kept for good', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/assets/0123456789abcdef.png`)
    expect(answer?.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('a picture named by a person is checked every time', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)
    expect(answer?.headers.get('cache-control')).toBe('no-cache')
  })

  test('a miss is a 404, so the placeholder a missing file shows appears', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/assets/nowhere.png`)
    expect(answer?.status).toBe(404)
    expect(await answer?.text()).toBe('')
    expect(answer?.headers.get('cache-control')).toBe('no-store')
  })

  test('the route with nothing after it is a miss rather than a throw', async () => {
    expect((await worker.fetch(`${ORIGIN}/asset/`))?.status).toBe(404)
  })

  test('an address that is not encoding is a miss', async () => {
    expect((await worker.fetch(`${ORIGIN}/asset/Work/%ZZ.png`))?.status).toBe(404)
  })

  test('a row that is not base64 is a miss rather than a broken picture', async () => {
    const odd = load([{ path: '/Work/a.png', type: 'image/png', data: 'not base64!!', modified: 1 }])
    expect((await odd.fetch(`${ORIGIN}/asset/Work/a.png`))?.status).toBe(404)
  })

  test('a browser that has never opened the app gets a miss, not an error', async () => {
    const empty = load([], { store: false })
    expect((await empty.fetch(`${ORIGIN}/asset/Work/a.png`))?.status).toBe(404)
  })

  test('storage that will not open gets a miss too', async () => {
    const shut = load([], { broken: true })
    expect((await shut.fetch(`${ORIGIN}/asset/Work/a.png`))?.status).toBe(404)
  })
})
