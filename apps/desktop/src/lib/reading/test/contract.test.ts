import { describe, expect, test } from 'vitest'
import { headingOffsets, positionOf, sectionAt } from '../src/places'

describe('a place in a note read', () => {
  const offsets = [0, 100, 260]

  test('is the section it is in and how far through it, and back again', () => {
    expect(sectionAt(180, offsets, 600)).toEqual({ index: 1, fraction: 0.5 })
    expect(positionOf({ index: 1, fraction: 0.5 }, offsets, 600)).toBe(180)
  })

  test('before the first heading is no section, and a note with none is one long section', () => {
    expect(sectionAt(-40, [40, 100], 600)).toEqual({ index: -1, fraction: 0 })
    expect(sectionAt(250, [], 1000)).toEqual({ index: -1, fraction: 0.25 })
  })

  test('starts its sections at the headings, never at one inside a code block', () => {
    const note = '# One\n\ntext\n\n```\n# not\n```\n\n## Two\n'
    expect(headingOffsets(note)).toEqual([0, note.indexOf('## Two')])
  })
})
