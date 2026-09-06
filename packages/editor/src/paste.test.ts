import { describe, expect, test } from 'vitest'
import { delimitedToTable, htmlToMarkdown } from './paste'

describe('pasting a web page', () => {
  test('headings and emphasis become markdown', () => {
    expect(htmlToMarkdown('<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '## Title\n\n**bold** and *italic*',
    )
  })

  test('links keep their target', () => {
    expect(htmlToMarkdown('<a href="https://x.dev">site</a>')).toBe('[site](https://x.dev)')
  })

  test('lists become markdown lists', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('-   one\n-   two')
  })

  test('code blocks keep their fence', () => {
    const markdown = htmlToMarkdown('<pre><code>let x = 1</code></pre>')
    expect(markdown).toContain('```')
    expect(markdown).toContain('let x = 1')
  })

  test('tables survive, via the GFM rules', () => {
    const markdown = htmlToMarkdown(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
    expect(markdown).toContain('| a | b |')
    expect(markdown).toContain('| 1 | 2 |')
  })

  test('strikethrough survives', () => {
    expect(htmlToMarkdown('<del>gone</del>')).toBe('~~gone~~')
  })

  test('highlighted text keeps its markdown form', () => {
    expect(htmlToMarkdown('<mark>kept</mark>')).toBe('==kept==')
  })

  test('underline has no markdown, so the tag stays', () => {
    expect(htmlToMarkdown('<u>under</u>')).toBe('<u>under</u>')
  })

  test('scripts and styles are dropped', () => {
    const markdown = htmlToMarkdown('<p>text</p><script>alert(1)</script><style>p{}</style>')
    expect(markdown).toBe('text')
  })

  test('images become markdown images', () => {
    expect(htmlToMarkdown('<img src="a.png" alt="alt">')).toBe('![alt](a.png)')
  })
})

describe('pasting spreadsheet cells', () => {
  test('tab-separated rows become a table', () => {
    expect(delimitedToTable('Name\tSize\na\t1\nb\t2')).toBe(
      ['| Name | Size |', '| --- | --- |', '| a | 1 |', '| b | 2 |'].join('\n'),
    )
  })

  test('comma-separated rows work too', () => {
    expect(delimitedToTable('a,b,c\n1,2,3')).toContain('| a | b | c |')
  })

  test('two sentences that happen to have a comma each are not a table', () => {
    // One comma per line is a sentence, and pasting prose was turning it into a
    // two-column table. A spreadsheet's tabs still settle it outright.
    expect(delimitedToTable('Hello, world\nGoodbye, world')).toBeNull()
    expect(delimitedToTable('Yes, it is\nNo, it is not')).toBeNull()
    expect(delimitedToTable('a\tb\n1\t2')).toContain('| a | b |')
  })

  test('a pipe inside a cell is escaped', () => {
    expect(delimitedToTable('a\tb\nx|y\tz')).toContain('x\\|y')
  })

  test('ordinary prose is left alone', () => {
    expect(delimitedToTable('Just a sentence.')).toBeNull()
    expect(delimitedToTable('One line\nAnother line')).toBeNull()
  })

  test('ragged rows are not a table', () => {
    expect(delimitedToTable('a\tb\n1')).toBeNull()
  })

  test('a single column is not a table', () => {
    expect(delimitedToTable('a\nb\nc')).toBeNull()
  })
})
