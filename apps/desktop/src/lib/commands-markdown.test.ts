import { describe, expect, test } from 'vitest'

const { tidies } = await import('./commands')

describe('tidying up', () => {
  test('is offered for a note, saved or not', () => {
    expect(tidies('/space/Plan.md')).toBe(true)
    expect(tidies(null)).toBe(true)
  })

  test('is not offered for a file that is not a note', () => {
    for (const path of ['/space/custom.css', '/space/snippets.json', '/space/a.txt']) {
      expect(tidies(path)).toBe(false)
    }
  })
})
