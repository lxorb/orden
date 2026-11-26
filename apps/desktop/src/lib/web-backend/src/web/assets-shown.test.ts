import { IDBFactory } from 'fake-indexeddb'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { AssetRow } from './store'

const row = (path: string, ...bytes: number[]): AssetRow => ({
  path,
  type: '',
  data: btoa(String.fromCharCode(...bytes)),
  modified: 1,
})
const read = async (url: string) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())]
async function written(rows: AssetRow[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((done, failed) => {
    const asked = indexedDB.open('orden', 2)
    asked.onupgradeneeded = () => {
      for (const name of ['files', 'assets', 'stats']) asked.result.createObjectStore(name, { keyPath: 'path' })
      asked.result.createObjectStore('meta')
      asked.result
        .createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        .createIndex('notePath', 'notePath')
    }
    asked.onsuccess = () => done(asked.result)
    asked.onerror = () => failed(asked.error ?? new Error('would not open'))
  })
  await new Promise<void>((done, failed) => {
    const change = db.transaction('assets', 'readwrite')
    for (const one of rows) change.objectStore('assets').put(one)
    change.oncomplete = () => done()
    change.onerror = () => failed(change.error ?? new Error('would not write'))
  })
  db.close()
}
async function page() {
  vi.resetModules()
  vi.stubGlobal('document', {})
  const { assetUrl, assetPath } = await import('../../../platform/src/api')
  const store = await import('./store')
  const { webInvoke } = await import('./commands')
  return { assetUrl, assetPath, webInvoke, ...store }
}
const heard = () => new Promise((done) => setTimeout(done, 30))
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe('the files a browser keeps, shown without a worker', () => {
  test('every file kept before the page opened has its blob by the first answer', async () => {
    const many = Array.from({ length: 40 }, (_, at) => row(`/Work/assets/${String(at).padStart(2, '0')}.png`, at))
    await written([...many, row('/Work/paper.pdf', 37, 80, 68, 70)])
    const { assetUrl, assetPath, webInvoke } = await page()
    expect(assetUrl('/Work/assets/07.png')).toBe('/asset/Work/assets/07.png')
    await webInvoke('read_asset', { path: '/Work/paper.pdf' })
    for (const one of many) {
      const url = assetUrl(one.path)
      expect(url).toMatch(/^blob:/)
      expect(assetPath(url)).toBe(one.path)
    }
    expect(await read(assetUrl('/Work/assets/07.png'))).toEqual([7])
    expect(await read(assetUrl('/Work/paper.pdf'))).toEqual([37, 80, 68, 70])
  })
  test('a file written has its blob when the write answers, and the bytes are the new ones', async () => {
    const { assetUrl, webInvoke } = await page()
    await webInvoke('write_bytes', { path: '/Work/assets/shot.png', base64: btoa('ab') })
    const before = assetUrl('/Work/assets/shot.png')
    expect(await read(before)).toEqual([97, 98])
    await webInvoke('write_bytes', { path: '/Work/assets/shot.png', base64: btoa('cd') })
    const after = assetUrl('/Work/assets/shot.png')
    expect(after).not.toBe(before)
    expect(await read(after)).toEqual([99, 100])
    await expect(fetch(before)).rejects.toThrow()
  })
  test('a file touched but not changed keeps the address a page is already showing', async () => {
    const { assetUrl, webInvoke } = await page()
    await webInvoke('write_bytes', { path: '/Work/assets/shot.png', base64: btoa('ab') })
    const before = assetUrl('/Work/assets/shot.png')
    await webInvoke('set_file_times', { path: '/Work/assets/shot.png', modified: 99 })
    expect(assetUrl('/Work/assets/shot.png')).toBe(before)
  })
  test('a file deleted gives its address up', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    const { assetUrl, webInvoke } = await page()
    await webInvoke('write_bytes', { path: '/Work/assets/shot.png', base64: btoa('ab') })
    const url = assetUrl('/Work/assets/shot.png')
    await webInvoke('delete_note', { path: '/Work/assets/shot.png' })
    expect(revoked).toHaveBeenCalledWith(url)
    expect(assetUrl('/Work/assets/shot.png')).toBe('/asset/Work/assets/shot.png')
  })
  test('a file moved is shown where it went and no longer where it was', async () => {
    const { assetUrl, assets } = await page()
    await assets.put(row('/Work/a.png', 1))
    const before = assetUrl('/Work/a.png')
    await assets.put(row('/Work/b.png', 1))
    await assets.remove('/Work/a.png')
    expect(assetUrl('/Work/b.png')).toMatch(/^blob:/)
    expect(assetUrl('/Work/a.png')).toBe('/asset/Work/a.png')
    await expect(fetch(before)).rejects.toThrow()
  })
  test('a row that is not base64 is left out and the rest are shown', async () => {
    await written([{ ...row('/Work/bad.png'), data: '%%%' }, row('/Work/good.png', 5)])
    const { assetUrl, webInvoke } = await page()
    await webInvoke('read_asset', { path: '/Work/good.png' })
    expect(assetUrl('/Work/bad.png')).toBe('/asset/Work/bad.png')
    expect(await read(assetUrl('/Work/good.png'))).toEqual([5])
  })
  test('what another tab writes or deletes is heard', async () => {
    await written([row('/Work/old.png', 1)])
    const { assetUrl, webInvoke } = await page()
    await webInvoke('read_asset', { path: '/Work/old.png' })
    const old = assetUrl('/Work/old.png')
    await written([row('/Work/new.png', 9), row('/Work/old.png', 2)])
    const other = new BroadcastChannel('orden:assets')
    other.postMessage({ written: ['/Work/new.png', '/Work/old.png'], gone: [] })
    await heard()
    expect(await read(assetUrl('/Work/new.png'))).toEqual([9])
    expect(assetUrl('/Work/old.png')).not.toBe(old)
    expect(await read(assetUrl('/Work/old.png'))).toEqual([2])
    other.postMessage({ written: [], gone: ['/Work/new.png'] })
    await heard()
    other.close()
    expect(assetUrl('/Work/new.png')).toBe('/asset/Work/new.png')
  })
  test('and this tab tells the others', async () => {
    const other = new BroadcastChannel('orden:assets')
    const told: unknown[] = []
    other.onmessage = (event) => told.push(event.data)
    const { assets } = await page()
    await assets.put(row('/Work/a.png', 1))
    await assets.remove('/Work/a.png')
    await heard()
    other.close()
    expect(told).toEqual([
      { written: ['/Work/a.png'], gone: [] },
      { written: [], gone: ['/Work/a.png'] },
    ])
  })
  test('a worker, which has no page to show anything on, holds nothing', async () => {
    vi.resetModules()
    const made = vi.spyOn(URL, 'createObjectURL')
    const { assetUrl } = await import('../../../platform/src/api')
    const { assets, assetsShown } = await import('./store')
    await assets.put(row('/Work/a.png', 1))
    await assetsShown()
    expect(assetUrl('/Work/a.png')).toBe('/asset/Work/a.png')
    expect(made).not.toHaveBeenCalled()
  })
})
