/** Two windows over one device's storage. Each window is its own copy of these
 *  modules, and what one of them wrote is not undone by what the other still holds:
 *  a visit, a reset of a site's permissions, a deleted history. Each module here is
 *  imported twice, after `vi.resetModules`, which is what a second window is. */

import { beforeEach, expect, test, vi } from 'vitest'

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

const disk = memoryStorage()
vi.stubGlobal('localStorage', disk)

beforeEach(() => {
  disk.clear()
  vi.resetModules()
})

const BOOK = 'nib:web-visits'

async function twice<T>(load: () => Promise<T>): Promise<[T, T]> {
  const a = await load()
  vi.resetModules()
  const b = await load()
  return [a, b]
}

test('history deleted in one window does not come back from the other', async () => {
  const [a, b] = await twice(async () => (await import('./visited')).visited)

  a.saw(BOOK, 't1', 'https://secret.example/', 'Secret')
  b.wake(BOOK)
  a.removeSince(BOOK, 0)
  b.saw(BOOK, 't2', 'https://other.example/', 'Other')

  expect(disk.getItem(BOOK)).not.toContain('secret.example')
  expect(disk.getItem(BOOK)).toContain('other.example')
  expect(b.all(BOOK).map((one) => one.url)).not.toContain('secret.example')
})

test('a visit in one window is kept through the other window’s next visit', async () => {
  const [a, b] = await twice(async () => (await import('./visited')).visited)

  a.wake(BOOK)
  b.wake(BOOK)
  a.saw(BOOK, 't1', 'https://one.example/', 'One')
  b.saw(BOOK, 't2', 'https://two.example/', 'Two')

  expect(disk.getItem(BOOK)).toContain('one.example')
  expect(disk.getItem(BOOK)).toContain('two.example')
  expect(a.complete(BOOK, 'two')?.url).toContain('two.example')
})

test('a zoom or a mute in one window is kept through the other window’s next one', async () => {
  const [a, b] = await twice(() => import('./sites'))

  expect(a.zoomOf('one.example')).toBe(1)
  expect(b.zoomOf('two.example')).toBe(1)
  a.keepZoom('one.example', 1.5)
  b.keepZoom('two.example', 2)
  a.setMuted('one.example', true)
  b.setMuted('two.example', true)

  expect(a.zoomOf('two.example')).toBe(2)
  expect(b.zoomOf('one.example')).toBe(1.5)
  expect(a.isMuted('two.example')).toBe(true)
  expect(b.isMuted('one.example')).toBe(true)
})

test('permissions reset in one window are not answered back by the other', async () => {
  const [a, b] = await twice(async () => (await import('./permissions.svelte')).grants)

  a.remember('one.example', 'camera', 'allow')
  expect(b.said('one.example', 'camera')).toBe('allow')
  a.forget('one.example')
  b.remember('two.example', 'camera', 'block')

  const kept = disk.getItem('nib:web-grants') ?? ''
  expect(kept).not.toContain('one.example')
  expect(kept).toContain('two.example')
  expect(b.said('one.example', 'camera')).toBeNull()
  expect(a.said('two.example', 'camera')).toBe('block')
})
