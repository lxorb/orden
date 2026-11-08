import { afterEach, describe, expect, test, vi } from 'vitest'
import { BYTES_WITHIN, LATE } from '../api'
import type { FileApi } from './file-api'
import { FileRefused, fileApi } from './file-api'
import type { FileWaiting } from './file-queue'
import { waitingFiles } from './file-queue'
import type { WorldFiles } from './file-sync'
import { pushedFiles } from './file-sync'
import type { SyncWorld } from './sync-world'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const BYTES = new Uint8Array([1, 2, 3])

function worldWith(waiting: FileWaiting[], put: FileApi['put']) {
  const kept = new Map<string, unknown>([['files-waiting', waiting]])
  const sent: string[] = []
  const rows = {
    items: () =>
      Promise.resolve(waiting.map((one) => ({ id: one.item, vault: 'v', deleted: false }))),
    read: (key: string) => Promise.resolve(kept.get(key)),
    keep: (key: string, value: unknown) => {
      kept.set(key, value)
      return Promise.resolve()
    },
  }
  const files: WorldFiles = {
    api: {
      put: async (vault, item, file, part, parts, bytes) => {
        await put(vault, item, file, part, parts, bytes)
        sent.push(item)
      },
      get: () => Promise.resolve(new Uint8Array()),
      remove: () => Promise.resolve(),
    },
    parts: () => Promise.resolve([{ item: '', file: '', part: 0, parts: 1, bytes: BYTES }]),
    drop: () => Promise.resolve(),
  }
  const world = {
    rows,
    exclusive: <T>(run: (held: null) => Promise<T>) => run(null),
    files: () => Promise.resolve(files),
  } as unknown as SyncWorld
  return { world, rows, sent }
}

const waiting = (item: string): FileWaiting => ({ item, file: `${item}-f`, parts: 1, gone: null })

describe('an attachment the account will not take now', () => {
  test.each([
    ['out of space', () => new FileRefused(507, 'out of space')],
    ['a server fault', () => new FileRefused(503, 'could not reach the server')],
    ['no network', () => new TypeError('Failed to fetch')],
  ])('for %s stays queued and lets the rest of the sync go on', async (_what, failure) => {
    const { world, rows, sent } = worldWith([waiting('a'), waiting('b')], (_v, item) =>
      item === 'a' ? Promise.reject(failure()) : Promise.resolve(),
    )
    await expect(pushedFiles(world)).resolves.toBe('stuck')
    expect(sent).toEqual(['b'])
    expect(await waitingFiles(rows)).toEqual([waiting('a')])
  })

  test('that is refused for good is let go', async () => {
    const { world, rows } = worldWith([waiting('a')], () =>
      Promise.reject(new FileRefused(413, 'too big', true)),
    )
    await expect(pushedFiles(world)).resolves.toBe('sent')
    expect(await waitingFiles(rows)).toEqual([])
  })

  test.each([403, 413])('that something in the way answers %i for stays queued', async (status) => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>blocked</html>', { status })))
    const real = fileApi('https://orden.so', 't')
    const { world, rows } = worldWith([waiting('a')], (...args) => real.put(...args))
    await expect(pushedFiles(world)).resolves.toBe('stuck')
    expect(await waitingFiles(rows)).toEqual([waiting('a')])
  })

  test('that the account refuses for good through the network is let go', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json({ error: 'your role in this vault does not allow that' }, { status: 403 }),
      ),
    )
    const real = fileApi('https://orden.so', 't')
    const { world, rows } = worldWith([waiting('a')], (...args) => real.put(...args))
    await expect(pushedFiles(world)).resolves.toBe('sent')
    expect(await waitingFiles(rows)).toEqual([])
  })

  test('for a fault of this device still stops the sync', async () => {
    const { world } = worldWith([waiting('a')], () => Promise.reject(new RangeError('broken')))
    await expect(pushedFiles(world)).rejects.toThrow(RangeError)
  })
})

describe('a file part sent to the account', () => {
  test('that never finishes is given up, as a network that is not there', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_done, refuse) => {
          init.signal?.addEventListener('abort', () =>
            refuse(new DOMException('aborted', 'AbortError')),
          )
        }),
    )
    const asked = fileApi('https://orden.so', 't').put('v', 'i', 'f', 0, 1, new Uint8Array(BYTES))
    const failed = expect(asked).rejects.toThrow(new TypeError(LATE))
    await vi.advanceTimersByTimeAsync(BYTES_WITHIN + 1)
    await failed
  })
})
