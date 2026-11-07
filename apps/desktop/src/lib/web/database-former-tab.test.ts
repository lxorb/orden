import 'fake-indexeddb/auto'
import { afterAll, expect, test } from 'vitest'
import { FORMER_NAME, files } from './store'

const older = new BroadcastChannel(`${FORMER_NAME}:windows`)
older.onmessage = (event: MessageEvent<{ kind?: string }>) => {
  if (event.data.kind === 'hello') older.postMessage({ kind: 'here', from: 'an-older-tab' })
}
afterAll(() => older.close())

function opened(name: string, version: number) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of ['files', 'assets', 'stats']) {
        db.createObjectStore(store, { keyPath: 'path' })
      }
      db.createObjectStore('meta')
      db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex(
        'notePath',
        'notePath',
      )
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('not opened'))
  })
}

async function names(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap((one) => (one.name ? [one.name] : []))
}

test('a tab of an older version still open keeps its store, and this tab works in it too', async () => {
  const old = await opened(FORMER_NAME, 2)
  await new Promise<void>((resolve) => {
    const writing = old.transaction('files', 'readwrite')
    writing
      .objectStore('files')
      .put({ path: '/t/kept.md', content: '# kept', modified: 1, created: 1 })
    writing.oncomplete = () => resolve()
  })

  expect(await files.get('/t/kept.md')).toMatchObject({ content: '# kept' })
  expect(await names()).toContain(FORMER_NAME)
  expect(await names()).not.toContain('orden')
  old.close()
})
