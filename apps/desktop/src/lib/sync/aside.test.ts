import { describe, expect, test } from 'vitest'
import { asideOf, nameSetAside } from './pass'

describe('where a note waits aside under v1', () => {
  // Its id is whatever the account's feed said, and the rename follows the path it spells.
  test.each(['../../Private/AGENTS.md', '..\\..\\Private', 'C:evil', 'plain-id'])(
    'stays beside itself whatever its id is: %s',
    (id) => {
      expect(asideOf('folder/A.md', id)).toMatch(/^folder\/\.nib-moving-[a-z0-9]+-A\.md$/)
      expect(asideOf('A.md', id)).toMatch(/^\.nib-moving-[a-z0-9]+-A\.md$/)
    },
  )

  test('gives back its name, spelled now or by an older version', () => {
    const id = 'c81e728d-9d4c-4f6b-a1b2-3c4d5e6f7a8b'
    expect(nameSetAside(asideOf('folder/A b-c.md', id), id)).toBe('A b-c.md')
    expect(nameSetAside(`.nib-moving-${id}-A b-c.md`, id)).toBe('A b-c.md')
    expect(nameSetAside('.nib-moving-other.md', id)).toBe('other.md')
  })
})
