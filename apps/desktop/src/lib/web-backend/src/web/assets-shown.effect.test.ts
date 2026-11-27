import 'fake-indexeddb/auto'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { measuredGrowth } from '../../../../../../../scripts/growth'
import type { AssetRow } from './store'

const made = new Map<string, Blob>()
const revoked: string[] = []
URL.createObjectURL = (blob: Blob | MediaSource) => {
  const url = `blob:test/${made.size + 1}`
  made.set(url, blob as Blob)
  return url
}
URL.revokeObjectURL = (url: string) => {
  revoked.push(url)
}
let read = 0
for (const name of ['get', 'getAll'] as const) {
  const real = Reflect.get(IDBObjectStore.prototype, name) as (...given: unknown[]) => IDBRequest
  IDBObjectStore.prototype[name] = function (this: IDBObjectStore, ...given: unknown[]) {
    const asked = Reflect.apply(real, this, given)
    if (this.name === 'assets') {
      asked.addEventListener('success', () => {
        const found = (Array.isArray(asked.result) ? asked.result : [asked.result]) as (AssetRow | undefined)[]
        for (const row of found) read += row?.data.length ?? 0
      })
    }
    return asked
  } as never
}
const { assetPath, assetUrl } = await import('../../../platform/src/api')
const { assets } = await import('./store')
const { webInvoke } = await import('./commands')
const row = (path: string, ...bytes: number[]): AssetRow => ({
  path,
  type: '',
  data: btoa(String.fromCharCode(...bytes)),
  modified: 1,
})
const bytesAt = (url: string) =>
  new Promise<number[]>((done, failed) => {
    const reader = new FileReader()
    reader.onload = () => done([...new Uint8Array(reader.result as ArrayBuffer)])
    reader.onerror = () => failed(reader.error ?? new Error('unread'))
    reader.readAsArrayBuffer(made.get(url) ?? new Blob())
  })
const src = (el: Element) => el.getAttribute('src') ?? ''
const filled = (...some: Element[]) =>
  vi.waitFor(() => {
    for (const el of some) expect(src(el)).toMatch(/^blob:/)
  })
function put(path: string) {
  const el = document.createElement('img')
  el.setAttribute('src', assetUrl(path))
  document.body.append(el)
  return el
}
function written(path: string, value: number | null): Promise<void> {
  return new Promise<void>((done, failed) => {
    const asked = indexedDB.open('orden')
    asked.onsuccess = () => {
      const change = asked.result.transaction('assets', 'readwrite')
      if (value === null) change.objectStore('assets').delete(path)
      else change.objectStore('assets').put(row(path, value))
      change.oncomplete = () => {
        asked.result.close()
        done()
      }
    }
    asked.onerror = () => failed(asked.error ?? new Error('unopened'))
  })
}
let space = 0
const fresh = (name: string) => `/Space ${++space}/assets/${name}`
afterEach(() => {
  document.body.replaceChildren()
  revoked.length = 0
})
describe('the files a browser keeps, shown from its own store', () => {
  test('a file is read from the store when the page shows it', async () => {
    const path = fresh('shot.png')
    await webInvoke('write_bytes', { path, base64: btoa('ab') })
    const el = put(path)
    await filled(el)
    expect(await bytesAt(src(el))).toEqual([97, 98])
    expect(assetPath(src(el))).toBe(path)
  })
  test('written over while it is shown, it shows the new bytes', async () => {
    const path = fresh('shot.png')
    await webInvoke('write_bytes', { path, base64: btoa('ab') })
    const el = put(path)
    await filled(el)
    const before = src(el)
    await webInvoke('write_bytes', { path, base64: btoa('cd') })
    expect(src(el)).not.toBe(before)
    expect(await bytesAt(src(el))).toEqual([99, 100])
    expect(revoked).toEqual([before])
  })
  test('touched but not changed, it keeps the address the page is showing', async () => {
    const path = fresh('shot.png')
    await webInvoke('write_bytes', { path, base64: btoa('ab') })
    const el = put(path)
    await filled(el)
    const before = src(el)
    await webInvoke('set_file_times', { path, modified: 99 })
    expect(src(el)).toBe(before)
    expect(revoked).toEqual([])
  })
  test('deleted, it gives its address up', async () => {
    const path = fresh('shot.png')
    await webInvoke('write_bytes', { path, base64: btoa('ab') })
    const el = put(path)
    await filled(el)
    const before = src(el)
    await webInvoke('delete_note', { path })
    expect(revoked).toEqual([before])
    expect(src(el)).toBe(assetUrl(path))
  })
  test('a row that is not base64 shows as missing and breaks nothing', async () => {
    const path = fresh('bad.png')
    await assets.put({ ...row(path), data: '%%%' })
    const el = put(path)
    const heard = vi.fn()
    el.addEventListener('error', heard)
    await vi.waitFor(() => expect(heard).toHaveBeenCalledOnce())
  })
  test('what another tab writes over a shown file is heard, and so is its delete', async () => {
    const path = fresh('shared.png')
    await assets.put(row(path, 1))
    const el = put(path)
    await filled(el)
    const before = src(el)
    const other = new BroadcastChannel('orden:assets')
    await written(path, 2)
    other.postMessage({ written: [path], gone: [] })
    await vi.waitFor(() => expect(src(el)).not.toBe(before))
    expect(await bytesAt(src(el))).toEqual([2])
    await written(path, null)
    other.postMessage({ written: [], gone: [path] })
    await vi.waitFor(() => expect(src(el)).toBe(assetUrl(path)))
    other.close()
  })
  test('and this tab tells the others', async () => {
    const path = fresh('told.png')
    const other = new BroadcastChannel('orden:assets')
    const told: unknown[] = []
    other.onmessage = (event) => told.push(event.data)
    await assets.put(row(path, 1))
    await assets.remove(path)
    await vi.waitFor(() =>
      expect(told).toEqual([
        { written: [path], gone: [] },
        { written: [], gone: [path] },
      ]),
    )
    other.close()
  })
})
describe('a space with many attachments', () => {
  async function loaded(count: number): Promise<number> {
    const root = `/Space ${++space}`
    for (let at = 0; at < count; at++)
      await assets.put(row(`${root}/assets/${at}.png`, ...new Array<number>(300).fill(at % 250)))
    read = 0
    await webInvoke('read_tree', { root, options: { every: true } })
    for (let at = 0; at < count; at++) assetUrl(`${root}/assets/${at}.png`)
    const el = put(`${root}/assets/0.png`)
    await filled(el)
    return read
  }
  test('reads on load only what the page shows, however many there are', async () => {
    const cost = new Map<number, number>()
    for (const count of [20, 80]) cost.set(count, await loaded(count))
    expect(cost.get(20)).toBe(400)
    expect(measuredGrowth((count) => cost.get(count) ?? Infinity, 20)).toBeLessThan(2)
  })
})
