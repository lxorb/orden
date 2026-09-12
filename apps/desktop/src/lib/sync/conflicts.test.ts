import { describe, expect, test } from 'vitest'

import { conflictPath, conflictRule, DEFAULT_RULE } from './conflicts'

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

describe('where the other copy goes', () => {
  test('is beside the note, saying where it came from and when', () => {
    const today = new Date().toISOString().slice(0, 10)

    expect(conflictPath('Plans/Trip.md')).toBe(`Plans/Trip (from another device ${today}).md`)
  })

  test('keeps the extension whatever it is', () => {
    expect(conflictPath('Board.canvas')).toContain('.canvas')
  })

  test('and a file with no extension is still a name', () => {
    expect(conflictPath('Notes')).toBe('Notes')
  })
})
