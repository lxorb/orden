import { expect, test } from 'vitest'
import { zipOf } from './zip'

function methods(zip: Uint8Array): Record<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const found: Record<string, number> = {}
  for (let at = 0; at + 30 <= zip.length;) {
    if (view.getUint32(at, true) !== 0x04034b50) break
    const method = view.getUint16(at + 8, true)
    const size = view.getUint32(at + 18, true)
    const named = view.getUint16(at + 26, true)
    const extra = view.getUint16(at + 28, true)
    found[new TextDecoder().decode(zip.subarray(at + 30, at + 30 + named))] = method
    at += 30 + named + extra + size
  }
  return found
}

test('what is packed already is stored as it is, and words are squeezed', async () => {
  const picture = new Uint8Array(4096).map((_, at) => at % 7)
  const zip = await zipOf([
    { path: 'a/one.png', body: picture },
    { path: 'a/two.JPG', body: picture },
    { path: 'a/three.md', body: 'words '.repeat(500) },
    { path: 'a/four.png', body: picture, stored: false },
  ])

  expect(methods(zip)).toMatchObject({
    'a/one.png': 0,
    'a/two.JPG': 0,
    'a/three.md': 8,
    'a/four.png': 8,
  })
})
