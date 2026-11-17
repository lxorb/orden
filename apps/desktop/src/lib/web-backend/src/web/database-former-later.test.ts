import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'

function opened(name: string) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('meta')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('not opened'))
  })
}

async function kept(name: string, key: string, value: string) {
  const db = await opened(name)
  await new Promise<void>((resolve) => {
    const writing = db.transaction('meta', 'readwrite')
    writing.objectStore('meta').put(value, key)
    writing.oncomplete = () => resolve()
  })
  db.close()
}

async function names(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap((one) => (one.name ? [one.name] : []))
}

function olderTab(channel: string, from = 0) {
  let heard = 0
  const line = new BroadcastChannel(channel)
  line.onmessage = (event: MessageEvent<{ kind?: string }>) => {
    if (event.data.kind !== 'hello') return
    heard += 1
    if (heard > from) line.postMessage({ kind: 'here', from: 'an-older-tab' })
  }
  return line
}

async function freshTab() {
  vi.resetModules()
  return await import('./carry-database')
}

test('a tab working in the older store with an older tab keeps it for tabs opened after that one closed', async () => {
  await kept('former-a', 'note', 'written before')
  const older = olderTab('former-a:windows')

  const first = await freshTab()
  expect(await first.databaseName('former-a', 'new-a', 'former-a')).toBe('former-a')
  older.close()

  const later = await freshTab()
  expect(await later.databaseName('former-a', 'new-a', 'former-a')).toBe('former-a')
  expect(await names()).toContain('former-a')
  expect(await names()).not.toContain('new-a')
})

test('an older tab heard only while carrying keeps its store: it is carried but not deleted', async () => {
  await kept('former-b', 'note', 'written before')
  const older = olderTab('former-b:windows', 1)

  const tab = await freshTab()
  expect(await tab.databaseName('former-b', 'new-b', 'former-b')).toBe('new-b')
  expect(await names()).toContain('former-b')
  expect(await names()).toContain('new-b')
  older.close()
})

test('with no other tab at all the older store is carried and deleted', async () => {
  await kept('former-c', 'note', 'written before')

  const tab = await freshTab()
  expect(await tab.databaseName('former-c', 'new-c', 'former-c')).toBe('new-c')
  expect(await names()).not.toContain('former-c')
  expect(await names()).toContain('new-c')
})
