import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { heldDatabase } from './held-database'
import { readFaces, writeFace } from './overview/src/faces'
import { padDisk } from './scratchpad/disk'
import { openTimeDisk } from './time/src/disk'

function deletedElsewhere(name: string): Promise<'gone' | 'stuck'> {
  return Promise.race([
    new Promise<'gone' | 'stuck'>((resolve) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve('gone')
      request.onerror = () => resolve('stuck')
    }),
    new Promise<'stuck'>((resolve) => setTimeout(() => resolve('stuck'), 2000)),
  ])
}

describe('a store of the browser that another tab deletes', () => {
  test('lets it go at once and opens again for what is asked next', async () => {
    const held = heldDatabase('held-one', 1, (request) => request.result.createObjectStore('s'))
    const put = async (key: string) => {
      const tx = await held.transaction('s', 'readwrite')
      tx.objectStore('s').put(1, key)
      await new Promise((resolve) => (tx.oncomplete = resolve))
    }
    await put('a')
    expect(await deletedElsewhere('held-one')).toBe('gone')
    await put('b')
    const tx = await held.transaction('s')
    const keys = tx.objectStore('s').getAllKeys()
    await new Promise((resolve) => (keys.onsuccess = resolve))
    expect(keys.result).toEqual(['b'])
  })

  test('is the scratchpad’s own, which still keeps and reads', async () => {
    const disk = padDisk()
    await disk.keep('a', 1)
    expect(await deletedElsewhere('orden-pad')).toBe('gone')
    await disk.keep('b', 2)
    expect(await disk.read('b')).toBe(2)
  })

  test('is the time records’ own, which still keep and read', async () => {
    const disk = await openTimeDisk('held-time')
    await disk.keep('cursor', 1)
    expect(await deletedElsewhere('orden-time:held-time')).toBe('gone')
    await disk.keep('cursor', 2)
    await disk.put([{ kind: 'span', id: 'a', value: { start: 1 }, dirty: 0, at: 1 }])
    expect(await disk.read('cursor')).toBe(2)
    expect((await disk.rows()).map((row) => row.id)).toEqual(['a'])
    disk.close()
  })

  test('is the overview’s pictures, which another tab is not kept waiting on', async () => {
    const face = { html: '<p>a</p>', shot: null, w: 1, h: 1, at: 1 }
    await writeFace('note:/a.md', face)
    expect(await deletedElsewhere('orden-overview-faces')).toBe('gone')
    await writeFace('note:/b.md', face)
    expect((await readFaces()).map(([name]) => name)).toEqual(['note:/b.md'])
  })
})
