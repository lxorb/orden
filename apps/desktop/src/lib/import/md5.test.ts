import { describe, expect, test } from 'vitest'

import { md5 } from './md5'

function hashOf(text: string): string {
  return md5(new TextEncoder().encode(text))
}

describe('md5', () => {
  test('answers the hashes the algorithm is defined by', () => {
    expect(hashOf('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(hashOf('a')).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(hashOf('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(hashOf('message digest')).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(hashOf('The quick brown fox jumps over the lazy dog')).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    )
  })

  test('runs over more than one block, and over the lengths that pad awkwardly', () => {
    expect(hashOf('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8')
    // 55, 56 and 64 bytes are where the padding has to start a block of its own.
    expect(hashOf('a'.repeat(55))).toBe('ef1772b6dff9a122358552954ad0df65')
    expect(hashOf('a'.repeat(56))).toBe('3b0c8ac703f828b04c6c197006d17218')
    expect(hashOf('a'.repeat(64))).toBe('014842d480b571495a4a0363793f7367')
  })

  test('hashes bytes rather than characters', () => {
    // A picture's bytes are not text, and every byte value has to survive.
    const bytes = Uint8Array.from({ length: 256 }, (_one, at) => at)
    expect(md5(bytes)).toBe('e2c865db4162bed963bfaa9ef6ac18f0')
  })
})
