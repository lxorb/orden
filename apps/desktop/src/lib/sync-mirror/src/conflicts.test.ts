import { describe, expect, test } from 'vitest'

import { conflictRule, DEFAULT_RULE } from './conflicts'

describe('the rule', () => {
  test('is what the app has always done unless the account says otherwise', () => {
    expect(DEFAULT_RULE).toBe('both')
  })

  test('is read off the account, and nothing else is taken', () => {
    expect(conflictRule('both')).toBe('both')
    expect(conflictRule('newest')).toBe('newest')
    expect(conflictRule('ask')).toBe('ask')
    expect(conflictRule('whatever')).toBeNull()
    expect(conflictRule(3)).toBeNull()
    expect(conflictRule(undefined)).toBeNull()
  })
})
