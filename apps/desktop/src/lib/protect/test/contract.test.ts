import { describe, expect, test, vi } from 'vitest'
import type { AccountDouble } from '../../accounts/test/fakes'
import './storage'
import { DEFAULT_RELOCK, NEVER, protection, RELOCK_MINUTES, unlocks } from '../src/api'
import { scrypt } from '../src/scrypt'

const signedIn = vi.hoisted(() => ({ account: null as AccountDouble | null }))
vi.mock('../../accounts/src/api', async () => {
  signedIn.account = (await import('../../accounts/test/fakes')).accountDouble('first')
  return { account: signedIn.account }
})

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
describe('another account signing in on this device', () => {
  test('neither holds the password of the account before it nor finds its unlocks open', async () => {
    const hashed = { n: 16, r: 1, p: 1, salt: 'c2FsdA==', hash: 'aGFzaA==' }
    protection.setPassword(hashed)
    protection.set('/space', '/space/Diary', 'password')
    unlocks.unlock(protection.covering('/space/Diary/today.md'))
    await new Promise((done) => setTimeout(done, 0))
    signedIn.account?.signInAs('second')
    expect(protection.password).toBeNull()
    expect(protection.locked('/space/Diary/today.md')).toBe(true)
    expect(protection.passwordFor('/space/Diary/today.md')?.hash).toBe('aGFzaA==')
  })
})
