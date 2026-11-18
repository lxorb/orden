import { describe, expect, test } from 'vitest'
import { headingLevel, headingText } from './headings'

describe('which nodes are headings', () => {
  test('the six written with hashes', () => {
    for (let level = 1; level <= 6; level++) expect(headingLevel(`ATXHeading${level}`)).toBe(level)
  })

  test('nothing else is one', () => {
    for (const name of [
      'Paragraph',
      'ATXHeading7',
      'ATXHeading',
      'SetextHeading1',
      'SetextHeading2',
      'Heading1',
    ]) {
      expect(headingLevel(name), name).toBeNull()
    }
  })
})

describe('the words a heading shows', () => {
  test.each([
    ['# Title', 'Title'],
    ['###### Deep', 'Deep'],
    ['   ## Title', 'Title'],
    ['## Title ##', 'Title'],
    ['## Title #', 'Title'],
    ['# C# and F#', 'C# and F#'],
    ['#', ''],
    ['## ##', ''],
  ])('%j', (input, wanted) => expect(headingText(input)).toEqual(wanted))
})
