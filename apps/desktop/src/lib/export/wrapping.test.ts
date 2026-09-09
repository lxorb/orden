import { describe, expect, test } from 'vitest'
import { documentOf } from './document'
import { toPlainText } from './text'

/** A paragraph hard wrapped in the file is one paragraph. A single newline in
 *  the middle of it is a space, which is what CommonMark says, what the reading
 *  view and every published page already do, and what the glasses do.
 *
 *  The blocks these exports are written from used to keep the newline, so a note
 *  wrapped at eighty columns arrived in Word, in RTF and in plain text broken at
 *  eighty columns. A hard break, which the writer asked for with two spaces or a
 *  backslash, is a `br` token and still breaks. */
describe('a paragraph wrapped in the file', () => {
  const words = (source: string) => {
    const doc = documentOf(source, 'Note.md')
    const first = doc.blocks.find((block) => block.kind === 'paragraph')
    return first && 'spans' in first ? first.spans.map((span) => span.text).join('') : ''
  }

  test('is one line of words, not the lines it was typed on', () => {
    expect(words('one\ntwo\nthree\n')).toBe('one two three')
  })

  test('keeps a hard break the writer asked for', () => {
    expect(words('one  \ntwo\n')).toBe('one\ntwo')
    expect(words('one\\\ntwo\n')).toBe('one\ntwo')
  })

  test('reads the same way in plain text', () => {
    expect(toPlainText(documentOf('one\ntwo\n', 'Note.md'))).toContain('one two')
  })

  test('leaves a fence exactly as it was written', () => {
    const doc = documentOf('```\none\ntwo\n```\n', 'Note.md')
    const fence = doc.blocks.find((block) => 'code' in block)
    expect(fence && 'code' in fence ? fence.code : '').toBe('one\ntwo')
  })
})
