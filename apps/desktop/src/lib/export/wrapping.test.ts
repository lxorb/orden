import JSZip from 'jszip'
import { setHardBreaks } from '@orden/markdown'
import { afterEach, describe, expect, test } from 'vitest'
import { paperTwips } from '../page-setup'
import { DEFAULT_PAGE_SETUP } from '../paper'
import { documentOf } from './document'
import { toDocx } from './docx'
import { toRtf } from './rtf'
import { toPlainText } from './text'

const PAPER = paperTwips(DEFAULT_PAGE_SETUP, 'Note', '2026-09-14')

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

describe('a single newline, when the switch says it breaks the line', () => {
  const WRAPPED = 'one\ntwo\n'

  afterEach(() => {
    setHardBreaks(false)
  })

  test('is a break in the blocks every document format is written from', () => {
    setHardBreaks(true)
    const doc = documentOf(WRAPPED, 'Note.md')
    const first = doc.blocks.find((block) => block.kind === 'paragraph')

    expect(first && 'spans' in first ? first.spans.map((span) => span.text).join('') : '').toBe(
      'one\ntwo',
    )
  })

  test('is asked of the caller when the caller has an answer of its own', () => {
    expect(
      documentOf(WRAPPED, 'Note.md', { hardBreaks: true })
        .blocks.flatMap((block) => ('spans' in block ? block.spans : []))
        .map((span) => span.text)
        .join(''),
    ).toBe('one\ntwo')
  })

  test('is two lines in the plain text file', () => {
    expect(toPlainText(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }))).toContain('one\ntwo')
  })

  test('is a \\line in the RTF file', () => {
    const rtf = toRtf(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }), [], PAPER)

    expect(rtf).toContain('one\\line two')
    expect(rtf).not.toContain('one two')
  })

  test('is a real break in the Word document', async () => {
    const bytes = await toDocx(documentOf(WRAPPED, 'Note.md', { hardBreaks: true }), [], PAPER)
    const zip = await JSZip.loadAsync(bytes)
    const file = zip.file('word/document.xml')
    expect(file).not.toBeNull()
    const xml = await file!.async('string')

    expect(xml).toContain('<w:br/>')
    expect(xml).not.toContain('one two')
  })

  test('leaves the fence and the wrapped paragraph alone when the switch is off', async () => {
    const bytes = await toDocx(documentOf(WRAPPED, 'Note.md', { hardBreaks: false }), [], PAPER)
    const zip = await JSZip.loadAsync(bytes)
    const file = zip.file('word/document.xml')
    expect(file).not.toBeNull()
    expect(await file!.async('string')).toContain('one two')
  })
})
