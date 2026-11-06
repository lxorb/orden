import { describe, expect, test } from 'vitest'
import { newestFirst, secretName } from './provider'

describe('provider helpers', () => {
  test('a secret name is one the vault takes, and differs per account', () => {
    const one = secretName('mail', 'emil@example.org', 'password')
    const two = secretName('mail', 'lucile@example.org', 'password')
    for (const name of [one, two, secretName('a'.repeat(90), 'x'.repeat(500), 'f'.repeat(90))]) {
      expect(name).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    }
    expect(one).not.toBe(two)
    expect(secretName('mail', 'emil@example.org', 'password')).toBe(one)
  })

  test('conversations sort newest first, an unknown time last', () => {
    const at = (id: string, lastAt: number | null) => ({
      id,
      title: id,
      kind: 'direct' as const,
      people: [],
      lastAt,
      unread: 0,
    })
    const sorted = [at('a', null), at('b', 3), at('c', 9)].sort(newestFirst)
    expect(sorted.map((one) => one.id)).toEqual(['c', 'b', 'a'])
  })
})
