import 'fake-indexeddb/auto'
import { describe, expect, test } from 'vitest'
import { heldDatabase } from '../src/api'

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
})
