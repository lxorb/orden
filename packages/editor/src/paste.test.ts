import { describe, expect, test } from 'vitest'
import { delimitedToTable, pastedMarkdown } from './paste'

/** The conversion itself is `@nib/markdown/from-html`, tested there. What is
 *  tested here is the choosing: a clipboard carries two flavours at once, and
 *  which of them a paste reads decides what lands in the note.
 *
 *  Awaited, because the converter is fetched the first time a page is pasted and not
 *  before - so what a clipboard comes to is an answer rather than a value. The two
 *  flavours that need nothing fetched are still settled in the call: a spreadsheet,
 *  and a clipboard with no HTML on it at all. */
describe('what a clipboard comes to', () => {
  test('a page arrives as markdown', async () => {
    await expect(pastedMarkdown('<h2>Title</h2>', 'Title')).resolves.toBe('## Title')
  })

  test('a spreadsheet arrives as a table, from the plain text beside the HTML', async () => {
    const html = '<table><tr><td>Name</td><td>Size</td></tr><tr><td>a</td><td>1</td></tr></table>'
    await expect(pastedMarkdown(html, 'Name\tSize\na\t1')).resolves.toBe(
      ['| Name | Size |', '| --- | --- |', '| a | 1 |'].join('\n'),
    )
  })

  test('plain text with no HTML beside it is nothing to convert', async () => {
    await expect(pastedMarkdown('', 'just words')).resolves.toBeNull()
  })

  test('HTML that comes to nothing is nothing to insert', async () => {
    await expect(pastedMarkdown('<style>p{}</style>', '')).resolves.toBeNull()
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
