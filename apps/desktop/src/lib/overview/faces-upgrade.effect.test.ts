import 'fake-indexeddb/auto'
import { expect, test, vi } from 'vitest'

const { memoryStorage } = await import('../../../test/disk')
vi.stubGlobal('localStorage', memoryStorage())

function writtenBefore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('orden-overview-faces', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('face')
    request.onerror = () => reject(request.error ?? new Error('not opened'))
    request.onsuccess = () => {
      const db = request.result
      const store = db.transaction('face', 'readwrite').objectStore('face')
      const one = { html: null, shot: 'data:image/png;base64,AA', w: 1, h: 1, at: 1 }
      store.put(one, 'web:~Secret Bank Login')
      store.put(one, 'web:~Secret Bank Login#1')
      store.put(one, 'web:/notes/kept.url')
      store.put({ ...one, shot: null, html: '<p>a</p>' }, 'note:/notes/a.md')
      store.transaction.oncomplete = () => {
        db.close()
        resolve()
      }
    }
  })
}

test('an upgrade wipes every web page’s picture before anything asks for one', async () => {
  await writtenBefore()
  const { upgradeFaces, readFaces } = await import('./faces')
  await upgradeFaces()
  expect((await readFaces()).map(([name]) => name)).toEqual(['note:/notes/a.md'])
})

test('an upgrade wipes every name a private tab could have left among the windows', async () => {
  const box = { x: 1, y: 2, w: 3, h: 4 }
  localStorage.setItem(
    'orden:overview-windows',
    JSON.stringify({
      'web:~Secret Bank Login': box,
      'web:/notes/kept.url': box,
      'note:/a.md': box,
    }),
  )
  const { upgradeWindows } = await import('./places.svelte')
  upgradeWindows()
  expect(localStorage.getItem('orden:overview-windows')).toBe(null)
  expect(JSON.parse(localStorage.getItem('orden:overview-windows-2') ?? '')).toEqual({
    'web:/notes/kept.url': box,
    'note:/a.md': box,
  })
})
