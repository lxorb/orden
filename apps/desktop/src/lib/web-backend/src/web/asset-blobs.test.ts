import { afterEach, describe, expect, test, vi } from 'vitest'
import { assetPath, assetUrl } from '../../../platform/src/api'
import { dropAsset, holdAsset as hold } from './asset-blobs'

const bytes = (...some: number[]) => new Uint8Array(some)
const read = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())
const known = new Set<string>()
function holdAsset(path: string, some: Uint8Array): Promise<void> {
  known.add(path)
  return hold(path, some)
}
function heldAssetUrl(path: string): string | null {
  const url = assetUrl(path)
  return url.startsWith('blob:') ? url : null
}
const heldAssetPath = assetPath
afterEach(() => {
  for (const path of known) dropAsset(path)
  known.clear()
  vi.restoreAllMocks()
})
describe('a file of the space, held for the page', () => {
  test('has a blob address that answers its bytes', async () => {
    await holdAsset('/Work/assets/pic.png', bytes(1, 2, 3))
    const url = heldAssetUrl('/Work/assets/pic.png')
    expect(url).toMatch(/^blob:/)
    expect(await read(url ?? '')).toEqual(bytes(1, 2, 3))
  })
  test('answers a part of itself, which is how a player seeks', async () => {
    await holdAsset('/Work/assets/tone.wav', bytes(0, 1, 2, 3, 4, 5, 6, 7))
    const part = await fetch(heldAssetUrl('/Work/assets/tone.wav') ?? '')
      .then((answer) => answer.blob())
      .then((whole) => whole.slice(2, 6).arrayBuffer())
    expect(new Uint8Array(part)).toEqual(bytes(2, 3, 4, 5))
  })
  test('is one address however the path is written, and the same one each time', async () => {
    await holdAsset('Work//notes/../assets/pic.png', bytes(1))
    const url = heldAssetUrl('/Work/assets/pic.png')
    expect(url).not.toBeNull()
    expect(heldAssetUrl('/Work/assets/pic.png')).toBe(url)
    expect(heldAssetUrl('Work/assets/pic.png')).toBe(url)
  })
  test('reads back to the path it names', async () => {
    await holdAsset('/Read me/a#b.png', bytes(1))
    const url = heldAssetUrl('/Read me/a#b.png') ?? ''
    expect(heldAssetPath(url)).toBe('/Read me/a#b.png')
    expect(heldAssetPath(`${url}#page=2`)).toBe('/Read me/a#b.png')
    expect(heldAssetPath('blob:http://localhost/nobody')).toBeNull()
  })
  test('a file nobody holds has no address', () => {
    expect(heldAssetUrl('/Work/assets/nowhere.png')).toBeNull()
  })
})
describe('the type a held file is given', () => {
  const typeOf = async (path: string) => {
    await holdAsset(path, bytes(60, 115, 62))
    return (await (await fetch(heldAssetUrl(path) ?? '')).blob()).type
  }
  test('comes from its extension', async () => {
    expect(await typeOf('/Work/pic.PNG')).toBe('image/png')
    expect(await typeOf('/Work/paper.pdf')).toBe('application/pdf')
    expect(await typeOf('/Work/clip.webm')).toBe('video/webm')
    expect(await typeOf('/Work/drawing.svg')).toBe('image/svg+xml')
  })
  test('and is never one a browser would run as a page of the app', async () => {
    for (const path of [
      '/Work/page.html',
      '/Work/page.htm',
      '/Work/page.xhtml',
      '/Work/page',
      '/Work/run.js',
      '/Work/a.xml',
    ])
      expect(await typeOf(path)).toBe('application/octet-stream')
  })
})
describe('an address is given up', () => {
  test('when the file goes', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    await holdAsset('/Work/pic.png', bytes(1))
    const url = heldAssetUrl('/Work/pic.png') ?? ''
    dropAsset('/Work/pic.png')
    expect(revoked).toHaveBeenCalledExactlyOnceWith(url)
    expect(heldAssetUrl('/Work/pic.png')).toBeNull()
    expect(heldAssetPath(url)).toBeNull()
    await expect(fetch(url)).rejects.toThrow()
  })
  test('when the file is written again with other bytes, and the new bytes get a new one', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    await holdAsset('/Work/pic.png', bytes(1, 2))
    const before = heldAssetUrl('/Work/pic.png') ?? ''
    await holdAsset('/Work/pic.png', bytes(1, 3))
    const after = heldAssetUrl('/Work/pic.png') ?? ''
    expect(after).not.toBe(before)
    expect(revoked).toHaveBeenCalledExactlyOnceWith(before)
    expect(await read(after)).toEqual(bytes(1, 3))
  })
  test('but not when the same bytes are written again', async () => {
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    await holdAsset('/Work/pic.png', bytes(1, 2))
    const before = heldAssetUrl('/Work/pic.png')
    await holdAsset('/Work/pic.png', bytes(1, 2))
    expect(heldAssetUrl('/Work/pic.png')).toBe(before)
    expect(revoked).not.toHaveBeenCalled()
  })
  test('and a file never shown made none to give up', async () => {
    const made = vi.spyOn(URL, 'createObjectURL')
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    await holdAsset('/Work/pic.png', bytes(1))
    dropAsset('/Work/pic.png')
    expect(made).not.toHaveBeenCalled()
    expect(revoked).not.toHaveBeenCalled()
  })
  test('so every address made is given up once and none is left, however files come and go', async () => {
    const made = vi.spyOn(URL, 'createObjectURL')
    const revoked = vi.spyOn(URL, 'revokeObjectURL')
    for (let round = 0; round < 5; round++) {
      for (let at = 0; at < 20; at++) {
        await holdAsset(`/Work/assets/${at}.png`, bytes(round, at))
        heldAssetUrl(`/Work/assets/${at}.png`)
      }
    }
    for (let at = 0; at < 20; at++) dropAsset(`/Work/assets/${at}.png`)
    const given = made.mock.results.map((one) => one.value as string)
    expect(given).toHaveLength(100)
    expect(revoked.mock.calls.map(([url]) => url).sort()).toEqual([...given].sort())
    for (let at = 0; at < 20; at++) expect(heldAssetUrl(`/Work/assets/${at}.png`)).toBeNull()
  })
})
