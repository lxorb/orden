import { describe, expect, test } from 'vitest'
import { hashedOf } from './protection.svelte'
import { hashPassword, matches } from './password'

describe('the protection password', () => {
  test('is kept as a salted hash, never as itself', async () => {
    const kept = await hashPassword('tulip ladder')
    expect(JSON.stringify(kept)).not.toContain('tulip')
    expect((await hashPassword('tulip ladder')).salt).not.toBe(kept.salt)
  })

  test('opens with itself and nothing else', async () => {
    const kept = await hashPassword('tulip ladder')
    expect(await matches('tulip ladder', kept)).toBe(true)
    expect(await matches('tulip ladde', kept)).toBe(false)
    expect(await matches('', kept)).toBe(false)
  })

  test('is read back only as a hash the app could have written', async () => {
    const kept = await hashPassword('x')
    expect(hashedOf(JSON.parse(JSON.stringify(kept)))).toEqual(kept)
    expect(hashedOf({ ...kept, n: 1000 })).toBeNull()
    expect(hashedOf({ ...kept, hash: 1 })).toBeNull()
    expect(hashedOf('tulip')).toBeNull()
  })
})
