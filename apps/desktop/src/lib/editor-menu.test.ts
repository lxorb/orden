import { describe, expect, test } from 'vitest'
import { blockLinkName } from './editor-menu'

describe('the note a block link points into', () => {
  test('is the note the block is in', () => {
    expect(blockLinkName('/space/Plan.md')).toBe('Plan')
  })

  test('is none for a file that is not a note', () => {
    for (const path of ['/space/custom.css', '/space/snippets.json', '/space/a.txt']) {
      expect(blockLinkName(path)).toBeNull()
    }
  })

  test('is none for a note nobody has saved', () => {
    expect(blockLinkName(null)).toBeNull()
  })
})
