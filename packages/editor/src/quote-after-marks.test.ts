import { describe, expect, test } from 'vitest'
import { smartReplacement } from './typography'

function type(line: string, character: string): string {
  const before = line + character
  const replacement = smartReplacement(before)
  if (!replacement) return before
  return before.slice(0, before.length - replacement.consumed) + replacement.insert
}

describe('a quote typed right after the opening marks of bold or italic', () => {
  test('opens after bold marks', () => {
    expect(type('He said **', '"')).toBe('He said **“')
  })

  test('opens after italic marks', () => {
    expect(type('He said *', '"')).toBe('He said *“')
  })

  test('opens after underscore italic marks at the start of a line', () => {
    expect(type('_', '"')).toBe('_“')
  })

  test('opens after strikethrough and highlight marks', () => {
    expect(type('Then ~~', '"')).toBe('Then ~~“')
    expect(type('Then ==', '"')).toBe('Then ==“')
  })
})
