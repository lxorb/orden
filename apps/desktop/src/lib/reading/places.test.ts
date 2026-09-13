import { describe, expect, test } from 'vitest'
import { headingOffsets, positionOf, type Section, sectionAt } from './places'

/** A note of four sections, by the offset each heading starts at. */
const OFFSETS = [0, 100, 260, 470]
/** And how long the note is, which is where the last section ends. */
const END = 600

describe('which section a place is in', () => {
  test('a heading is the start of its own section', () => {
    expect(sectionAt(0, OFFSETS, END)).toEqual({ index: 0, fraction: 0 })
    expect(sectionAt(100, OFFSETS, END)).toEqual({ index: 1, fraction: 0 })
    expect(sectionAt(260, OFFSETS, END)).toEqual({ index: 2, fraction: 0 })
    expect(sectionAt(470, OFFSETS, END)).toEqual({ index: 3, fraction: 0 })
  })

  test('a paragraph between two is that far through the one above it', () => {
    expect(sectionAt(180, OFFSETS, END)).toEqual({ index: 1, fraction: 0.5 })
    expect(sectionAt(365, OFFSETS, END)).toEqual({ index: 2, fraction: 0.5 })
  })

  test('before the first heading is no section at all', () => {
    expect(sectionAt(-40, [40, 100], 600)).toEqual({ index: -1, fraction: 0 })
  })

  test('and a note with no headings is one long section', () => {
    expect(sectionAt(250, [], 1000)).toEqual({ index: -1, fraction: 0.25 })
  })
})

describe('and back again', () => {
  test('a section with no fraction is its heading', () => {
    for (const [index, offset] of OFFSETS.entries()) {
      expect(positionOf({ index, fraction: 0 }, OFFSETS, END)).toBe(offset)
    }
  })

  test('a fraction is that far towards the next heading', () => {
    expect(positionOf({ index: 1, fraction: 0.5 }, OFFSETS, END)).toBe(180)
    // The last section runs to the end of the note rather than to a heading.
    expect(positionOf({ index: 3, fraction: 0.5 }, OFFSETS, END)).toBe(535)
  })

  test('a fraction outside nought and one is held to them', () => {
    expect(positionOf({ index: 1, fraction: -3 }, OFFSETS, END)).toBe(100)
    expect(positionOf({ index: 1, fraction: 9 }, OFFSETS, END)).toBe(260)
  })

  test('no section at all is the top of the note', () => {
    expect(positionOf({ index: -1, fraction: 0 }, OFFSETS, END)).toBe(0)
  })
})

describe('the two directions are one mapping', () => {
  test('a place survives the round trip', () => {
    // Which is what makes switching a note between writing and reading and back
    // again land where it began, and it is the whole reason these are a pair.
    for (const position of [0, 40, 100, 173, 260, 399, 470, 522, 600]) {
      const section: Section = sectionAt(position, OFFSETS, END)
      expect(positionOf(section, OFFSETS, END)).toBe(position)
    }
  })

  test('even where the note has one heading and a long tail', () => {
    for (const position of [0, 10, 250, 999, 1000]) {
      expect(positionOf(sectionAt(position, [0], 1000), [0], 1000)).toBe(position)
    }
  })
})

describe('where the headings of a note are', () => {
  test('at the start of each heading line', () => {
    const note = '# One\n\ntext\n\n## Two\n\nmore\n'
    expect(headingOffsets(note)).toEqual([0, note.indexOf('## Two')])
  })

  test('the underlined spelling counts, from its words', () => {
    const note = 'One\n===\n\ntext\n\nTwo\n---\n\nmore\n'
    expect(headingOffsets(note)).toEqual([0, note.indexOf('Two')])
  })

  test('a rule after a blank line is a rule, not a heading', () => {
    expect(headingOffsets('text\n\n---\n\nmore\n')).toEqual([])
  })

  test('a hash inside a fence is a comment', () => {
    const note = '# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n'
    expect(headingOffsets(note)).toEqual([0, note.indexOf('## Also real')])
  })

  test('a list dash under a list item is not a heading', () => {
    expect(headingOffsets('- one\n---\n')).toEqual([])
  })

  test('an indented hash is code, not a heading', () => {
    expect(headingOffsets('    # indented\n')).toEqual([])
    expect(headingOffsets('   # three spaces\n')).toEqual([0])
  })

  test('front matter shifts them along, since offsets are into the whole note', () => {
    const note = '---\ntitle: x\n---\n\n# One\n'
    expect(headingOffsets(note)).toEqual([note.indexOf('# One')])
  })

  test('a note with none has none', () => {
    expect(headingOffsets('just words\n\nand more\n')).toEqual([])
    expect(headingOffsets('')).toEqual([])
  })
})
