import { describe, expect, test } from 'vitest'
import { type Around, closedAround } from './closing-around'

function closing(shape: string, id: string, which: Around): string {
  const strip: { id: string }[] = []
  for (const name of shape) strip.push({ id: name })

  return closedAround(strip, id, which)
    .map((one) => one.id)
    .join('')
}

describe('the tabs a close around one tab takes', () => {
  test('to the right: every tab after it', () => {
    expect(closing('abcd', 'b', 'right')).toBe('cd')
    expect(closing('abcd', 'd', 'right')).toBe('')
  })

  test('others: every tab but it', () => {
    expect(closing('abcd', 'b', 'others')).toBe('acd')
  })

  test('all: the whole strip, the tab itself included', () => {
    expect(closing('abcd', 'b', 'all')).toBe('abcd')
  })

  test('nothing for a tab the strip has not got', () => {
    expect(closing('abc', 'z', 'all')).toBe('')
  })
})
