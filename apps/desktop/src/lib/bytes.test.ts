import { describe, expect, test } from 'vitest'
import { decoded, sha256, toBase64 } from './bytes'

describe('the hash', () => {
  test('is the digest of the bytes, so the same file is the same hash', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const same = await sha256(bytes)

    expect(same).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256(new Uint8Array([1, 2, 3, 4]))).toBe(same)
    expect(await sha256(new Uint8Array([1, 2, 3, 5]))).not.toBe(same)
  })

  test('of text is the digest of its UTF-8, whichever shape the bytes came in', async () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

    expect(await sha256('abc')).toBe(abc)
    expect(await sha256(new TextEncoder().encode('abc'))).toBe(abc)
    expect(await sha256(new TextEncoder().encode('abc').buffer)).toBe(abc)
  })
})

describe('a data URI read back', () => {
  test('is its bytes, base64 or not', async () => {
    const bytes = new Uint8Array(70_000).map((_unused, at) => (at * 7) % 256)

    expect(await decoded(`data:application/pdf;base64,${toBase64(bytes)}`)).toEqual(bytes)
    expect(await decoded('data:text/plain,a%20b')).toEqual(new TextEncoder().encode('a b'))
  })

  test('is nothing when it is not a data URI at all', async () => {
    expect(await decoded('not a uri')).toEqual(new Uint8Array())
  })
})
