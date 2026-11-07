import { describe, expect, it } from 'vitest'
import { base64, fromUtf8, joined, randomBytes, same, unbase64, utf8 } from './bytes'

describe('bytes', () => {
  it('round-trips base64', () => {
    for (const length of [0, 1, 2, 3, 4, 31, 32, 33]) {
      const bytes = randomBytes(length)
      expect(unbase64(base64(bytes))).toEqual(bytes)
    }
  })

  it('refuses text that is not canonical base64', () => {
    for (const bad of ['a', 'abc', 'ab=c', 'ab c', 'YQ', 'YR==', '****', 'YWJj\n'])
      expect(() => unbase64(bad)).toThrow()
  })

  it('reads utf8 strictly', () => {
    expect(fromUtf8(utf8('grüße 🔑'))).toBe('grüße 🔑')
    expect(() => fromUtf8(new Uint8Array([0xff, 0xfe]))).toThrow()
  })

  it('joins and compares', () => {
    const all = joined(new Uint8Array([1, 2]), new Uint8Array([]), new Uint8Array([3]))
    expect([...all]).toEqual([1, 2, 3])
    expect(same(all, new Uint8Array([1, 2, 3]))).toBe(true)
    expect(same(all, new Uint8Array([1, 2, 4]))).toBe(false)
    expect(same(all, new Uint8Array([1, 2]))).toBe(false)
  })

  it('makes random bytes of the length asked', () => {
    expect(randomBytes(32)).toHaveLength(32)
    expect(same(randomBytes(32), randomBytes(32))).toBe(false)
  })
})
