import { describe, expect, test } from 'vitest'
import { headingLevel, headingText } from './headings'

describe('which nodes are headings', () => {
  test('the six written with hashes', () => {
    for (let level = 1; level <= 6; level++) {
      expect(headingLevel(`ATXHeading${level}`)).toBe(level)
    }
  })

  test('and the two written with an underline', () => {
    expect(headingLevel('SetextHeading1')).toBe(1)
    expect(headingLevel('SetextHeading2')).toBe(2)
  })

  test('nothing else is one', () => {
    for (const name of ['Paragraph', 'ATXHeading7', 'ATXHeading', 'SetextHeading3', 'Heading1']) {
      expect(headingLevel(name), name).toBeNull()
    }
  })
})

describe('the words a heading shows', () => {
  test('without its hashes', () => {
    expect(headingText('# Title')).toBe('Title')
    expect(headingText('###### Deep')).toBe('Deep')
  })

  test('without the indent CommonMark allows in front of them', () => {
    expect(headingText('   ## Title')).toBe('Title')
  })

  test('without the hashes some styles close one with', () => {
    expect(headingText('## Title ##')).toBe('Title')
    expect(headingText('## Title #')).toBe('Title')
  })

  test('keeping a hash that is one of the words', () => {
    expect(headingText('# C# and F#')).toBe('C# and F#')
  })

  test('and nothing at all for a heading with no words', () => {
    expect(headingText('#')).toBe('')
    expect(headingText('## ##')).toBe('')
  })
})
