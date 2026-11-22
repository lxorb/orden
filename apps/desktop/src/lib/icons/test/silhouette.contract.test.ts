import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'
import { siteMasks } from '../src/api'

const SIZE = 32
function rgbaOf(name: string): Uint8ClampedArray {
  const file = readFileSync(join(import.meta.dirname, 'favicons', name))
  const chunks: Buffer[] = []
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at)
    if (file.toString('latin1', at + 4, at + 8) === 'IDAT') chunks.push(file.subarray(at + 8, at + 8 + length))
    at += length + 12
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = SIZE * 4
  const out = new Uint8ClampedArray(SIZE * stride)
  for (let y = 0; y < SIZE; y++) {
    const kind = raw[y * (stride + 1)] ?? 0
    for (let x = 0; x < stride; x++) {
      const byte = raw[y * (stride + 1) + 1 + x] ?? 0
      const left = x >= 4 ? (out[y * stride + x - 4] ?? 0) : 0
      const up = y > 0 ? (out[(y - 1) * stride + x] ?? 0) : 0
      const corner = x >= 4 && y > 0 ? (out[(y - 1) * stride + x - 4] ?? 0) : 0
      const guess = left + up - corner
      const [pa, pb, pc] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - corner)]
      const near = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner
      const add = [0, left, up, (left + up) >> 1, near][kind] ?? 0
      out[y * stride + x] = (byte + add) & 255
    }
  }
  return out
}
const at = (mask: Uint8ClampedArray, x: number, y: number) => mask[y * SIZE + x] ?? 0
const share = (mask: Uint8ClampedArray) => mask.reduce((sum, one) => sum + one / 255, 0) / mask.length
async function shaped(name: string) {
  const { silhouette } = await siteMasks()
  return silhouette(rgbaOf(name), SIZE)
}
describe('the one-colour form of a web icon (#2485)', () => {
  test('an opaque tile gives the mark drawn on it, not the tile', async () => {
    const mask = await shaped('news.ycombinator.com.png')
    expect(at(mask, 15, 18)).toBeGreaterThan(200)
    for (const [x, y] of [
      [0, 0],
      [31, 31],
      [4, 20],
      [28, 4],
    ] as const)
      expect(at(mask, x, y)).toBeLessThan(40)
    expect(share(mask)).toBeGreaterThan(0.05)
    expect(share(mask)).toBeLessThan(0.3)
  })
  test('a disc on a transparent ground gives the many-coloured mark inside it', async () => {
    const mask = await shaped('google.com.png')
    for (const [x, y] of [
      [7, 14],
      [20, 14],
    ] as const)
      expect(at(mask, x, y)).toBeGreaterThan(200)
    for (const [x, y] of [
      [0, 0],
      [31, 0],
      [12, 12],
      [16, 2],
    ] as const)
      expect(at(mask, x, y)).toBeLessThan(40)
  })
  test('a mark on a light ground gives the mark, its own holes kept', async () => {
    const mask = await shaped('github.com.png')
    for (const [x, y] of [
      [15, 0],
      [0, 14],
      [28, 12],
    ] as const)
      expect(at(mask, x, y)).toBeGreaterThan(200)
    for (const [x, y] of [
      [0, 0],
      [31, 31],
      [16, 14],
      [12, 20],
    ] as const)
      expect(at(mask, x, y)).toBeLessThan(40)
  })
  test('a many-coloured badge keeps its ring and its figure', async () => {
    const mask = await shaped('duckduckgo.com.png')
    expect(at(mask, 6, 6)).toBeGreaterThan(200)
    for (const [x, y] of [
      [0, 0],
      [31, 31],
      [9, 6],
    ] as const)
      expect(at(mask, x, y)).toBeLessThan(40)
    expect(share(mask)).toBeGreaterThan(0.2)
  })
  test('a one-colour mark on a transparent ground is its own shape', async () => {
    const { silhouette } = await siteMasks()
    const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) rgba.set([20, 20, 20, 255], (y * SIZE + x) * 4)
    const mask = silhouette(rgba, SIZE)
    expect(at(mask, 16, 16)).toBe(255)
    expect(at(mask, 2, 2)).toBe(0)
  })
  test('is kept as a mask small enough to be the icon value, and nothing when no size fits', async () => {
    const { keptMask } = await siteMasks()
    const head = 'mask:data:image/png;base64,'
    const asked: number[] = []
    const kept = await keptMask('data:image/png;base64,AAAA', (_src, size) => {
      asked.push(size)
      return Promise.resolve(head + 'A'.repeat(size > 32 ? 3000 : 600))
    })
    expect(asked).toEqual([48, 32])
    expect(kept?.startsWith(head)).toBe(true)
    expect(kept?.length).toBeLessThanOrEqual(2048)
    expect(await keptMask('data:image/png;base64,AAAA', () => Promise.resolve(head + 'A'.repeat(3000)))).toBeNull()
    expect(await keptMask('data:image/png;base64,AAAA', () => Promise.resolve('data:image/png;base64,AAAA'))).toBeNull()
  })
})
