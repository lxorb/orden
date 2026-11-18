import { describe, expect, test } from 'vitest'
import { documentOf } from './document'
import { toPlainText } from './text'

describe('a soft line break between marked words in Word, RTF and text exports', () => {
  test('a line ending in italics flows into the next as the reading view draws it', () => {
    const doc = documentOf('Some *words*\n*more* here\n', 'Note', { hardBreaks: false })
    expect(toPlainText(doc)).toBe('Some words more here\n')
  })

  test('two links on following lines stay on one line', () => {
    const doc = documentOf('[one](https://a.com)\n[two](https://b.com)\n', 'Note', {
      hardBreaks: false,
    })
    const spans = doc.blocks[0] && 'spans' in doc.blocks[0] ? doc.blocks[0].spans : []
    expect(spans.map((span) => span.text)).toEqual(['one', ' ', 'two'])
  })

  test('two resized pictures on following lines stay side by side', () => {
    const doc = documentOf(
      '<img src="a.png" style="zoom:50%;" />\n<img src="b.png" style="zoom:50%;" />\n',
      'Note',
      {
        hardBreaks: false,
      },
    )
    const spans = doc.blocks[0] && 'spans' in doc.blocks[0] ? doc.blocks[0].spans : []
    expect(spans.some((span) => span.text === '\n')).toBe(false)
  })

  test('a backslash hard break is still a line break', () => {
    const doc = documentOf('line one\\\nline two\n', 'Note', { hardBreaks: false })
    expect(toPlainText(doc)).toBe('line one\nline two\n')
  })

  test('with hard breaks on, a line ending in italics still breaks', () => {
    const doc = documentOf('Some *words*\n*more* here\n', 'Note', { hardBreaks: true })
    expect(toPlainText(doc)).toBe('Some words\nmore here\n')
  })
})
