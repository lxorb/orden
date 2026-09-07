import { describe, expect, test } from 'vitest'
import { type Anchor, headingOffsets, positionAt, topFor } from './places'

/** A note of four sections, with the headings at the places a page of it would
 *  put them: 0, 200, 500 and 900 pixels down, over a page 1200 tall. */
const ANCHORS: Anchor[] = [
  { position: 0, top: 0 },
  { position: 0, top: 0 },
  { position: 100, top: 200 },
  { position: 260, top: 500 },
  { position: 470, top: 900 },
  { position: 600, top: 1200 },
]

describe('from the editor to the page', () => {
  test('a heading goes to its heading', () => {
    expect(topFor(100, ANCHORS)).toBe(200)
    expect(topFor(260, ANCHORS)).toBe(500)
    expect(topFor(470, ANCHORS)).toBe(900)
  })

  test('a paragraph between two goes the same fraction of the way', () => {
    // Halfway from the second heading to the third in the text is halfway down
    // between them on the page.
    expect(topFor(180, ANCHORS)).toBe(350)
  })

  test('the top is the top and the end is the end', () => {
    expect(topFor(0, ANCHORS)).toBe(0)
    expect(topFor(600, ANCHORS)).toBe(1200)
  })

  test('past either end is that end', () => {
    expect(topFor(-40, ANCHORS)).toBe(0)
    expect(topFor(9000, ANCHORS)).toBe(1200)
  })
})

describe('from the page to the editor', () => {
  test('a heading comes back as its heading', () => {
    expect(positionAt(200, ANCHORS)).toBe(100)
    expect(positionAt(500, ANCHORS)).toBe(260)
    expect(positionAt(900, ANCHORS)).toBe(470)
  })

  test('between two, the same fraction back', () => {
    expect(positionAt(350, ANCHORS)).toBe(180)
  })

  test('past either end is that end', () => {
    expect(positionAt(-100, ANCHORS)).toBe(0)
    expect(positionAt(99999, ANCHORS)).toBe(600)
  })
})

describe('the two directions are one mapping', () => {
  test('a place survives the round trip, and so does an offset', () => {
    for (const position of [0, 40, 100, 173, 260, 399, 470, 522, 600]) {
      expect(positionAt(topFor(position, ANCHORS), ANCHORS)).toBe(position)
    }

    // A place in the text is a whole number of characters, and a character is a
    // pixel or two of page, so an offset comes back to within that much.
    for (const top of [0, 120, 200, 333, 500, 712, 900, 1050, 1200]) {
      expect(Math.abs(topFor(positionAt(top, ANCHORS), ANCHORS) - top)).toBeLessThanOrEqual(2)
    }
  })
})

describe('a note with nothing to anchor to', () => {
  const ends: Anchor[] = [
    { position: 0, top: 0 },
    { position: 1000, top: 4000 },
  ]

  test('is read as one long stretch', () => {
    expect(topFor(250, ends)).toBe(1000)
    expect(positionAt(1000, ends)).toBe(250)
  })

  test('and an empty one is the top', () => {
    expect(topFor(10, [])).toBe(0)
    expect(positionAt(10, [])).toBe(0)
  })

  test('and one whose page has no height is still the top', () => {
    const flat: Anchor[] = [
      { position: 0, top: 0 },
      { position: 500, top: 0 },
    ]
    expect(topFor(250, flat)).toBe(0)
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
