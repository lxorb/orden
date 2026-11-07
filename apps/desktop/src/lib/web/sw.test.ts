import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'

const SW = join(import.meta.dirname, '../../../public/sw.js')
const SOURCE = readFileSync(SW, 'utf8')

const ORIGIN = 'http://127.0.0.1:18967'

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

interface Row {
  path: string
  type: string
  data: string
  modified: number
}

interface OpenWindow {
  focused: number
  said: unknown[]
}

interface Worker {
  fetch(url: string, method?: string, range?: string): Promise<Response | null>
  press(data: unknown): Promise<{ closed: boolean; opened: string[] }>
}

function load(
  rows: readonly Row[],
  options: { store?: boolean; broken?: boolean; windows?: OpenWindow[]; under?: string } = {},
): Worker {
  const { store = true, broken = false, windows = [], under } = options
  const opened: string[] = []
  const client = (one: OpenWindow) => ({
    focus: () => {
      one.focused++
      return Promise.resolve(one)
    },
    postMessage: (said: unknown) => one.said.push(said),
  })
  const listeners = new Map<string, (event: unknown) => void>()

  const self = {
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows.map(client)),
      openWindow: (url: string) => {
        opened.push(url)
        return Promise.resolve(null)
      },
    },
    addEventListener: (kind: string, heard: (event: unknown) => void) => {
      listeners.set(kind, heard)
    },
  }

  const by = new Map(rows.map((row) => [row.path, row]))

  const indexedDB = {
    open: (name: string) => {
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
                  read.result = under === undefined || under === name ? by.get(path) : undefined
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

  // eslint-disable-next-line @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call -- the worker is a classic script in this repository rather than a module anything can import, and running it with a window of our own is the only way to ask it anything without a browser
  new Function('self', 'indexedDB', SOURCE)(self, indexedDB)

  return {
    fetch: (url: string, method = 'GET', range?: string) => {
      const heard = listeners.get('fetch')
      if (!heard) throw new Error('the worker never listened for a fetch')

      let answered: Promise<Response> | null = null
      heard({
        request: { method, url, headers: new Headers(range === undefined ? {} : { Range: range }) },
        respondWith: (given: Promise<Response>) => {
          answered = given
        },
      })

      return Promise.resolve(answered)
    },
    press: async (data: unknown) => {
      const heard = listeners.get('notificationclick')
      if (!heard) throw new Error('the worker never listened for a press on a notice')

      let closed = false
      let waited: Promise<unknown> = Promise.resolve()
      heard({
        notification: { data, close: () => (closed = true) },
        waitUntil: (until: Promise<unknown>) => (waited = until),
      })
      await waited
      return { closed, opened }
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

  test('a piece asked for is the piece, so a player can read where it seeks', async () => {
    const whole = new Uint8Array(
      (await (await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`))?.arrayBuffer()) ??
        new ArrayBuffer(0),
    )
    const size = whole.length
    const piece = async (range: string) => {
      const answer = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`, 'GET', range)
      const bytes = new Uint8Array((await answer?.arrayBuffer()) ?? new ArrayBuffer(0))
      return {
        status: answer?.status,
        range: answer?.headers.get('content-range'),
        length: answer?.headers.get('content-length'),
        bytes: [...bytes],
      }
    }

    expect(await piece('bytes=0-1')).toEqual({
      status: 206,
      range: `bytes 0-1/${size}`,
      length: '2',
      bytes: [...whole.subarray(0, 2)],
    })
    expect(await piece('bytes=10-')).toMatchObject({
      status: 206,
      range: `bytes 10-${size - 1}/${size}`,
      bytes: [...whole.subarray(10)],
    })
    expect(await piece('bytes=-4')).toMatchObject({
      status: 206,
      range: `bytes ${size - 4}-${size - 1}/${size}`,
      bytes: [...whole.subarray(size - 4)],
    })
    expect(await piece(`bytes=5-${size + 100}`)).toMatchObject({
      status: 206,
      range: `bytes 5-${size - 1}/${size}`,
    })
    expect(await piece(`bytes=${size}-`)).toMatchObject({ status: 416, range: `bytes */${size}` })
    expect(await piece('bytes=-0')).toMatchObject({ status: 416 })
    expect(await piece('bytes=0-1,4-5')).toMatchObject({ status: 200, bytes: [...whole] })
    expect(await piece('bytes=9-3')).toMatchObject({ status: 200, bytes: [...whole] })
    expect(await piece('lines=1-2')).toMatchObject({ status: 200, bytes: [...whole] })

    const all = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)
    expect(all?.headers.get('accept-ranges')).toBe('bytes')
  })

  test('a file opened on its own is sandboxed, so nothing in it runs as the app', async () => {
    const svg = await worker.fetch(`${ORIGIN}/asset/Work/assets/diagram.svg`)
    const policy = svg?.headers.get('content-security-policy') ?? ''
    expect(policy.split(';')[0]).toBe('sandbox')
    expect(policy).toContain("default-src 'none'")
    expect(svg?.headers.get('x-content-type-options')).toBe('nosniff')

    const piece = await worker.fetch(`${ORIGIN}/asset/Work/assets/diagram.svg`, 'GET', 'bytes=0-3')
    expect(piece?.headers.get('content-security-policy')).toBe(policy)

    const odd = load([{ path: '/Work/page', type: 'text/html', data: PIXEL, modified: 1 }])
    const html = await odd.fetch(`${ORIGIN}/asset/Work/page`)
    expect(html?.headers.get('content-type')).toBe('text/html')
    expect(html?.headers.get('content-security-policy')).toBe(policy)
  })

  test('a PDF keeps the viewer that reads it, and is still never sniffed', async () => {
    const pdf = load([{ path: '/Work/a.pdf', type: 'application/pdf', data: PIXEL, modified: 1 }])
    const answer = await pdf.fetch(`${ORIGIN}/asset/Work/a.pdf`)
    expect(answer?.headers.get('content-security-policy')).toBeNull()
    expect(answer?.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('a name with a space in it is the row it was encoded from', async () => {
    const answer = await worker.fetch(`${ORIGIN}/asset/Work/Read%20me/a%20b.png`)
    expect(answer?.status).toBe(200)
  })

  test('the type comes from the name, not from what the row claims', async () => {
    const png = await worker.fetch(`${ORIGIN}/asset/Work/notes/screenshot.png`)
    expect(png?.headers.get('content-type')).toBe('image/png')

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
    const odd = load([
      { path: '/Work/a.png', type: 'image/png', data: 'not base64!!', modified: 1 },
    ])
    expect((await odd.fetch(`${ORIGIN}/asset/Work/a.png`))?.status).toBe(404)
  })

  test('a row an older version kept under its own name is still found', async () => {
    const old = load([pixel('/Work/old.png')], { under: 'nib' })
    expect((await old.fetch(`${ORIGIN}/asset/Work/old.png`))?.status).toBe(200)
    const now = load([pixel('/Work/new.png')], { under: 'orden' })
    expect((await now.fetch(`${ORIGIN}/asset/Work/new.png`))?.status).toBe(200)
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

describe('a notice the worker showed, pressed', () => {
  test('brings the open window forward and tells it which notice it was', async () => {
    const window: OpenWindow = { focused: 0, said: [] }
    const pressed = await load([], { windows: [window] }).press({ ordenNotice: 'c_2' })

    expect(pressed).toEqual({ closed: true, opened: [] })
    expect(window).toEqual({ focused: 1, said: [{ ordenNotice: 'c_2' }] })
  })

  test('knows a notice shown before the rename by its old tag', async () => {
    const window: OpenWindow = { focused: 0, said: [] }
    await load([], { windows: [window] }).press({ nibNotice: 'c_2' })

    expect(window).toEqual({ focused: 1, said: [{ ordenNotice: 'c_2' }] })
  })

  test('opens Orden when no window of it is open', async () => {
    expect(await load([]).press({ ordenNotice: 'c_2' })).toEqual({ closed: true, opened: ['/'] })
  })

  test('tells nothing of a notice it did not name', async () => {
    const window: OpenWindow = { focused: 0, said: [] }
    await load([], { windows: [window] }).press(undefined)

    expect(window).toEqual({ focused: 1, said: [] })
  })
})
