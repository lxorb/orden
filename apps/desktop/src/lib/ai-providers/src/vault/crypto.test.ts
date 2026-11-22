import { describe, expect, test } from 'vitest'
import { fingerprint } from './crypto'

describe('a key’s fingerprint', () => {
  test('says whether it changed without saying the key', async () => {
    const one = await fingerprint('sk-one')
    expect(one).toBe(await fingerprint('sk-one'))
    expect(one).not.toBe(await fingerprint('sk-two'))
    expect(one).not.toContain('sk-one')
  })
})
