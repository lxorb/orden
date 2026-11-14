import { scryptSync } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { scrypt } from './scrypt'

const bytes = (text: string) => new TextEncoder().encode(text)
const hex = (out: Uint8Array) => Buffer.from(out).toString('hex')

describe('scrypt', () => {
  test('answers RFC 7914 section 12', async () => {
    expect(hex(await scrypt(bytes(''), bytes(''), { n: 16, r: 1, p: 1 }, 64))).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    )
    expect(hex(await scrypt(bytes('password'), bytes('NaCl'), { n: 1024, r: 8, p: 16 }, 64))).toBe(
      'fdbabe1c9d3472007856e7190d01e9fe7c6ad7cbc8237830e77376634b3731622eaf30d92e22a3886ff109279d9830dac727afb94a83ee6d8360cbdfa2cc0640',
    )
  })

  test('agrees with Node at the cost the app uses', async () => {
    const salt = bytes('a salt of sixteen')
    const ours = await scrypt(bytes('correct horse'), salt, { n: 32768, r: 8, p: 1 }, 32)
    const node = scryptSync('correct horse', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 << 20 })
    expect(hex(ours)).toBe(node.toString('hex'))
  })
})
