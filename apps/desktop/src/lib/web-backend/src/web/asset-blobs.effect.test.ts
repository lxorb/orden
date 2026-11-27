import { afterEach, describe, expect, test, vi } from 'vitest'
import { measuredGrowth } from '../../../../../../../scripts/growth'
import { settle as turned } from '../../../../../test/effects/settle'

const disk = new Map<string, Uint8Array>()
const reads: string[] = []
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
const { assetPath, assetUrl } = await import('../../../platform/src/api')
const { assetGone, assetWritten, showAssets } = await import('./asset-blobs')
showAssets((path) => {
  reads.push(path)
  return Promise.resolve(disk.get(path) ?? null)
})
const bytes = (...some: number[]) => new Uint8Array(some)
const bytesAt = (url: string) =>
  new Promise<number[]>((done, failed) => {
    const reader = new FileReader()
    reader.onload = () => done([...new Uint8Array(reader.result as ArrayBuffer)])
    reader.onerror = () => failed(reader.error ?? new Error('unread'))
    reader.readAsArrayBuffer(made.get(url) ?? new Blob())
  })
let space = 0
const fresh = (name: string) => `/Space ${++space}/assets/${name}`
const src = (el: Element) => el.getAttribute('src') ?? ''
const filled = (...some: Element[]) =>
  vi.waitFor(() => {
    for (const el of some) expect(src(el)).toMatch(/^blob:/)
  })
function put(tag: 'img' | 'audio' | 'video', path: string) {
  const el = document.createElement(tag)
  el.setAttribute('src', assetUrl(path))
  document.body.append(el)
  return el
}
afterEach(() => {
  document.body.replaceChildren()
  reads.length = 0
  revoked.length = 0
})
describe('the address a file of the space has in a browser', () => {
  test('is a name that loads nothing and reads back to its path, held or not', () => {
    const path = '/Read me/100% done/a#b.png'
    const url = assetUrl(path)
    expect(url).toMatch(/^data:image\/gif;base64,[\w+/=]+#/)
    expect(assetPath(url)).toBe(path)
    expect(assetUrl('Read me//notes/../100% done/a#b.png')).toBe(url)
    expect(reads).toEqual([])
  })
  test('never changes, so words kept from before still name the file', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const before = assetUrl(path)
    await filled(put('img', path))
    await assetWritten(path, () => bytes(2))
    expect(assetUrl(path)).toBe(before)
  })
})
describe('a file shown on the page', () => {
  test('is read when the page first shows it, once, and not before', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1, 2, 3))
    assetUrl(path)
    await turned()
    expect(reads).toEqual([])
    const first = put('img', path)
    const second = put('img', path)
    await filled(first, second)
    expect(reads).toEqual([path])
    expect(src(second)).toBe(src(first))
    expect(await bytesAt(src(first))).toEqual([1, 2, 3])
    const later = put('img', path)
    await filled(later)
    expect(reads).toEqual([path])
    expect(assetPath(src(later))).toBe(path)
  })
  test('is filled wherever it stands: in kept markup, in a sound, a film and a film’s source, and when named later', async () => {
    const path = fresh('clip.webm')
    disk.set(path, bytes(9))
    const card = document.createElement('div')
    const name = assetUrl(path).replace(/&/g, '&amp;')
    card.innerHTML = `<p><img src="${name}"></p><audio src="${name}"></audio><video><source src="${name}"></video>`
    const loads = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    document.body.append(card)
    const late = document.createElement('video')
    document.body.append(late)
    late.setAttribute('src', assetUrl(path))
    const every = [...card.querySelectorAll('img,audio,source'), late]
    await filled(...every)
    expect(new Set(every.map(src)).size).toBe(1)
    expect(loads.mock.contexts).toContain(card.querySelector('video'))
    expect(made.get(src(late))?.type).toBe('video/webm')
    loads.mockRestore()
  })
  test('is given a type a browser will not run as a page of the app', async () => {
    for (const name of ['page.html', 'page', 'run.js', 'a.xml']) {
      const path = fresh(name)
      disk.set(path, bytes(60))
      const el = put('img', path)
      await filled(el)
      expect(made.get(src(el))?.type, name).toBe('application/octet-stream')
    }
  })
  test('leaves alone what is not a file of the space', async () => {
    const other = document.createElement('img')
    other.setAttribute('src', 'blob:test/someone-else')
    const data = document.createElement('img')
    data.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')
    document.body.append(other, data)
    await turned()
    expect(src(other)).toBe('blob:test/someone-else')
    expect(src(data)).not.toContain('#')
    expect(reads).toEqual([])
  })
})
describe('what the page hears of a picture', () => {
  test('is nothing while its name stands in for it, then the real load', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const el = put('img', path)
    const heard: string[] = []
    el.addEventListener('load', () => heard.push('load'))
    el.addEventListener('error', () => heard.push('error'))
    el.dispatchEvent(new Event('load'))
    el.dispatchEvent(new Event('error'))
    expect(heard).toEqual([])
    await filled(el)
    el.dispatchEvent(new Event('load'))
    expect(heard).toEqual(['load'])
  })
  test('is one error when the file is not there, and a load once it arrives', async () => {
    const path = fresh('late.png')
    const el = put('img', path)
    const heard: string[] = []
    el.addEventListener('load', () => heard.push('load'))
    el.addEventListener('error', () => heard.push('error'))
    await vi.waitFor(() => expect(heard).toEqual(['error']))
    expect(src(el)).toBe(assetUrl(path))
    disk.set(path, bytes(4))
    await assetWritten(path, () => bytes(4))
    await filled(el)
    el.dispatchEvent(new Event('load'))
    expect(heard).toEqual(['error', 'load'])
    expect(await bytesAt(src(el))).toEqual([4])
  })
})
describe('a picture written over', () => {
  test('shows its new bytes at once everywhere it is shown, and its old address is given up once', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1, 1))
    const kept = `<div class="card"><img src="${assetUrl(path)}"></div>`
    const card = document.createElement('div')
    card.innerHTML = kept
    document.body.append(card)
    const inNote = put('img', path)
    const inCard = card.querySelector('img') ?? card
    await filled(inNote, inCard)
    const old = src(inNote)
    disk.set(path, bytes(2, 2))
    await assetWritten(path, () => bytes(2, 2))
    expect(src(inNote)).not.toBe(old)
    expect(src(inCard)).toBe(src(inNote))
    expect(await bytesAt(src(inCard))).toEqual([2, 2])
    expect(revoked).toEqual([old])
    expect(assetPath(old)).toBe(path)
  })
  test('and markup kept from before, drawn again afterwards, shows the new bytes too', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const kept = `<img src="${assetUrl(path)}">`
    const drawn = () => {
      const card = document.createElement('div')
      card.innerHTML = kept
      document.body.append(card)
      return card.querySelector('img') ?? card
    }
    const first = drawn()
    await filled(first)
    const old = src(first)
    await assetWritten(path, () => bytes(7))
    const again = drawn()
    await filled(again)
    expect(src(again)).not.toBe(old)
    expect(await bytesAt(src(again))).toEqual([7])
  })
  test('and an element taken off the page with the old address is put right when it comes back', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const el = put('img', path)
    await filled(el)
    const old = src(el)
    el.remove()
    await assetWritten(path, () => bytes(8))
    expect(src(el)).toBe(old)
    document.body.append(el)
    await vi.waitFor(() => expect(src(el)).not.toBe(old))
    expect(await bytesAt(src(el))).toEqual([8])
  })
  test('with the same bytes keeps the address the page is showing', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(5, 6))
    const el = put('img', path)
    await filled(el)
    const before = src(el)
    await assetWritten(path, () => bytes(5, 6))
    expect(src(el)).toBe(before)
    expect(revoked).toEqual([])
  })
  test('twice at once ends on the last bytes, with every earlier address given up', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const el = put('img', path)
    await filled(el)
    const first = src(el)
    await Promise.all([2, 3, 4].map((value) => assetWritten(path, () => bytes(value))))
    expect(await bytesAt(src(el))).toEqual([4])
    expect(revoked).toHaveLength(3)
    expect(revoked).toContain(first)
    expect(revoked).not.toContain(src(el))
  })
  test('while nobody shows it costs nothing: its bytes are not even asked for', async () => {
    const path = fresh('pic.png')
    const asked = vi.fn(() => bytes(1))
    await assetWritten(path, asked)
    expect(asked).not.toHaveBeenCalled()
    expect(reads).toEqual([])
  })
})
describe('a file deleted', () => {
  test('gives its address up, and what showed it says it is missing', async () => {
    const path = fresh('pic.png')
    disk.set(path, bytes(1))
    const el = put('img', path)
    await filled(el)
    const old = src(el)
    const heard: string[] = []
    el.addEventListener('error', () => heard.push('error'))
    disk.delete(path)
    await assetGone(path)
    expect(revoked).toEqual([old])
    await vi.waitFor(() => expect(heard).toEqual(['error']))
    expect(src(el)).toBe(assetUrl(path))
  })
})
describe('a space with many files', () => {
  async function shownOneOf(count: number): Promise<number> {
    reads.length = 0
    const paths = Array.from({ length: count }, (_, at) => fresh(`${at}.png`))
    for (const path of paths) disk.set(path, new Uint8Array(1000))
    for (const path of paths) assetUrl(path)
    const el = put('img', paths[0] ?? '')
    await filled(el)
    const read = reads.reduce((sum, path) => sum + (disk.get(path)?.length ?? 0), 0)
    for (const path of paths) disk.delete(path)
    return read
  }
  test('costs the page the bytes of what it shows, however many there are', async () => {
    const cost = new Map<number, number>()
    for (const count of [50, 200]) cost.set(count, await shownOneOf(count))
    expect(cost.get(50)).toBe(1000)
    expect(measuredGrowth((count) => cost.get(count) ?? Infinity, 50)).toBeLessThan(2)
  })
})
