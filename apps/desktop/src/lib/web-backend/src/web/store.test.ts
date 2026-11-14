import 'fake-indexeddb/auto'
import { describe, expect, test, vi } from 'vitest'
import { assets, files, inSlices, type RowChange, stats } from './store'

function shelf(count: number) {
  const rows = Array.from({ length: count }, (_, at) => ({
    path: `/Big/note-${String(at).padStart(5, '0')}.md`,
  }))

  const asked: number[] = []

  return {
    rows,
    asked,
    read: (after: string | null, most: number) => {
      const from = after === null ? 0 : rows.findIndex((row) => row.path > after)
      const slice = from === -1 ? [] : rows.slice(from, from + most)
      asked.push(slice.length)
      return Promise.resolve(slice)
    },
  }
}

const keyOf = (row: { path: string }) => row.path

describe('a whole store read in slices', () => {
  test('answers the same rows in the same order as one read would', async () => {
    const store = shelf(5003)
    const found = await inSlices(store.read, keyOf, 500)

    expect(found).toEqual(store.rows)
  })

  test('and no one read builds more than a slice of them', async () => {
    const store = shelf(5003)
    await inSlices(store.read, keyOf, 500)

    expect(store.asked).toHaveLength(11)
    expect(Math.max(...store.asked)).toBe(500)
    expect(store.asked.at(-1)).toBe(3)
  })

  test('stops on the read that came back short, and asks nothing after it', async () => {
    const store = shelf(400)
    await inSlices(store.read, keyOf, 500)

    expect(store.asked).toEqual([400])
  })

  test('and a store with nothing in it is one read and an empty answer', async () => {
    const store = shelf(0)
    expect(await inSlices(store.read, keyOf, 500)).toEqual([])
    expect(store.asked).toEqual([0])
  })

  test('a store that is exactly a slice long asks once more to find the end', async () => {
    const store = shelf(500)
    const found = await inSlices(store.read, keyOf, 500)

    expect(found).toHaveLength(500)
    expect(store.asked).toEqual([500, 0])
  })
})

describe('a file written over', () => {
  test('keeps the day it was made, read off its listing and never off the file', async () => {
    await files.write('/s/plane.canvas', 'x'.repeat(1000), 100)

    const reads = vi.spyOn(IDBObjectStore.prototype, 'get')
    await files.write('/s/plane.canvas', 'y'.repeat(1000), 200)
    const stores = reads.mock.contexts.map((store) => (store as IDBObjectStore).name)
    reads.mockRestore()

    expect(stores).toEqual(['stats'])
    expect(await files.get('/s/plane.canvas')).toMatchObject({ created: 100, modified: 200 })
    expect((await stats.all()).find((row) => row.path === '/s/plane.canvas')).toMatchObject({
      created: 100,
      modified: 200,
      size: 1000,
    })
  })

  test('says which path changed, and not what is in it', async () => {
    const heard: unknown[] = []
    const listening = new BroadcastChannel('orden:rows')
    const arrived = new Promise<void>((done) => {
      listening.onmessage = (event: MessageEvent<unknown>) => {
        heard.push(event.data)
        done()
      }
    })

    await files.write('/s/note.md', '# words', 300)
    await arrived
    listening.close()

    expect(heard).toEqual([{ written: ['/s/note.md'], gone: [] } satisfies RowChange])
  })
})

describe('whether the listing holds a path', () => {
  test('holds a note, a picture, a folder of either, and not a name they only begin', async () => {
    await files.write('/h/Plan.md', '# Plan', 1)
    await assets.put({ path: '/h/Pics/shot.png', type: 'image/png', data: 'AAAA', modified: 1 })

    expect(await stats.holds('/h/Plan.md')).toBe(true)
    expect(await stats.holds('/h/Pics/shot.png')).toBe(true)
    expect(await stats.holds('/h/Pics')).toBe(true)
    expect(await stats.holds('/h')).toBe(true)
    expect(await stats.holds('/h/Plan')).toBe(false)
    expect(await stats.holds('/h/Pic')).toBe(false)
    expect(await stats.holds('/h/Gone.md')).toBe(false)
  })
})

describe('the notes kept in this browser', () => {
  test('let another tab delete or upgrade their store, and carry on with it afterwards', async () => {
    await files.write('/t/kept.md', '# kept', 1)
    await new Promise<void>((done, failed) => {
      const request = indexedDB.deleteDatabase('orden')
      request.onsuccess = () => done()
      request.onerror = () => failed(request.error ?? new Error('not deleted'))
    })

    expect(await files.get('/t/kept.md')).toBeUndefined()
    await files.write('/t/kept.md', '# again', 2)
    expect(await files.get('/t/kept.md')).toMatchObject({ content: '# again' })
  })

  test('open their store again when the browser lets the old connection go', async () => {
    await files.write('/t/lost.md', '# lost', 1)
    const lost = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw new DOMException('The database connection is closing.', 'InvalidStateError')
    })
    try {
      expect(await files.get('/t/lost.md')).toMatchObject({ content: '# lost' })
      expect(lost).toHaveBeenCalledTimes(2)
    } finally {
      lost.mockRestore()
    }
  })

  test('write all of a move or none of it', async () => {
    await files.write('/t/a.md', '# a', 1)
    const bad = { path: '/t/c.md', content: (() => 0) as never, created: 1, modified: 1 }
    await expect(
      files.move([{ path: '/t/b.md', content: '# b', created: 1, modified: 1 }, bad], ['/t/a.md']),
    ).rejects.toThrow()

    expect(await files.get('/t/b.md')).toBeUndefined()
    expect(await files.get('/t/a.md')).toMatchObject({ content: '# a' })
  })
})
