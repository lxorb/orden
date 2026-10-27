import { describe, expect, test } from 'vitest'
import { headingAt, lineOf, lineOfHeading, scanHeadings } from './outline'

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
    expect(scanHeadings('##   Spaced   \n')[0]?.text).toBe('Spaced')
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

describe('finding a heading by name', () => {
  const headings = scanHeadings('# Read me\n\ntext\n\n## Why it works\n\n## Later\n')

  test('takes the words as they are written', () => {
    expect(lineOfHeading(headings, 'Why it works')).toBe(4)
  })

  test('ignores the case and the space around it', () => {
    expect(lineOfHeading(headings, '  why IT works ')).toBe(4)
  })

  test('takes the anchor those words turn into, which is what a link writes', () => {
    expect(lineOfHeading(headings, 'why-it-works')).toBe(4)
  })

  test('is nothing when the note has no such heading', () => {
    expect(lineOfHeading(headings, 'Something else')).toBeNull()
    expect(lineOfHeading([], 'Read me')).toBeNull()
  })

  test('finds the first of two headings with the same words', () => {
    const twice = scanHeadings('## Notes\n\n## Notes\n')
    expect(lineOfHeading(twice, 'Notes')).toBe(0)
  })
})

describe('the outline reads code the way the page does', () => {
  test('a tilde line inside a backtick block does not close it', () => {
    const note =
      '# Setup\n```bash\ncat <<EOF > a.md\n~~~\nEOF\n# install deps\nnpm i\n```\n## Usage\ntext\n# Next\nmore'
    expect(scanHeadings(note).map((one) => one.text)).toEqual(['Setup', 'Usage', 'Next'])
    expect(lineOfHeading(scanHeadings(note), 'Usage')).toBe(8)
  })

  test('a shorter fence inside a longer one is code', () => {
    const note = '# A\n````md\n```js\n# not\n```\n````\n# B\nb\n'
    expect(scanHeadings(note).map((one) => one.text)).toEqual(['A', 'B'])
  })

  test('a fence in a list item closes on its own mark too', () => {
    expect(scanHeadings('- a\n\n  ````\n  ```\n  ````\n# B\n').map((one) => one.text)).toEqual([
      'B',
    ])
  })

  test('a comment in the front matter is no heading', () => {
    expect(scanHeadings('---\n# c\ntitle: x\n---\n# A\n')).toEqual([
      { level: 1, text: 'A', line: 4 },
    ])
  })
})
