import { describe, expect, test } from 'vitest'
import { headingAt, lineOf, scanHeadings } from './outline'

describe('the outline of a note', () => {
  test('reads every heading with its level and line', () => {
    expect(scanHeadings('# One\n\ntext\n\n### Three\n')).toEqual([
      { level: 1, text: 'One', line: 0 },
      { level: 3, text: 'Three', line: 4 },
    ])
  })

  test('a hash inside a fence is a comment, not a heading', () => {
    const doc = '# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n'
    expect(scanHeadings(doc).map((one) => one.text)).toEqual(['Real', 'Also real'])
  })

  test('tilde fences close as backtick ones do', () => {
    expect(scanHeadings('~~~\n# no\n~~~\n# yes\n').map((one) => one.text)).toEqual(['yes'])
  })

  test('a hash without a space is not a heading', () => {
    expect(scanHeadings('#tag\n')).toEqual([])
  })

  test('seven hashes are too many', () => {
    expect(scanHeadings('####### deep\n')).toEqual([])
  })

  test('an empty note has no outline', () => {
    expect(scanHeadings('')).toEqual([])
  })

  test('trailing hashes and space around the words are not part of them', () => {
    expect(scanHeadings('##   Spaced   \n')[0].text).toBe('Spaced')
  })
})

describe('where the caret is in the outline', () => {
  const headings = [
    { level: 1, text: 'One', line: 0 },
    { level: 2, text: 'Two', line: 10 },
    { level: 2, text: 'Three', line: 20 },
  ]

  test('the last heading on or above the line', () => {
    expect(headingAt(headings, 0)).toBe(0)
    expect(headingAt(headings, 9)).toBe(0)
    expect(headingAt(headings, 10)).toBe(1)
    expect(headingAt(headings, 99)).toBe(2)
  })

  test('nothing when there are no headings', () => {
    expect(headingAt([], 4)).toBe(-1)
  })

  test('the line an offset falls on, for sessions that did not record it', () => {
    expect(lineOf('a\nb\nc', 0)).toBe(0)
    expect(lineOf('a\nb\nc', 2)).toBe(1)
    expect(lineOf('a\nb\nc', 4)).toBe(2)
  })
})
