import { describe, expect, test } from 'vitest'
import { DEFAULT_RELOCK, NEVER, protection, RELOCK_MINUTES, unlocks } from '../src/api'
import { scrypt } from '../src/scrypt'

describe('the module stands on its own', () => {
  test('the protection and the unlocks are there to read', () => {
    expect(typeof protection.locked).toBe('function')
    expect(protection.locked(null)).toBe(false)
    expect(typeof unlocks).toBe('object')
  })

  test('a lock comes back after a few minutes unless it is never to', () => {
    expect(RELOCK_MINUTES).toContain(DEFAULT_RELOCK)
    expect(RELOCK_MINUTES).toContain(NEVER)
    expect(RELOCK_MINUTES.filter((one) => one !== NEVER).every((one) => one >= 0)).toBe(true)
  })
})

describe('passwords', () => {
  test('are stretched by scrypt as RFC 7914 has it', async () => {
    const empty = new Uint8Array(0)
    const out = await scrypt(empty, empty, { n: 16, r: 1, p: 1 }, 64)
    expect(Buffer.from(out).toString('hex')).toBe(
      '77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906',
    )
  })

  test('refuse a cost that is not a power of two', async () => {
    const one = new Uint8Array(1)
    await expect(scrypt(one, one, { n: 12, r: 1, p: 1 }, 16)).rejects.toThrow()
  })
})
