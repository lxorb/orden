import { describe, expect, test } from 'vitest'
import { CODE_PALETTES } from '@nib/editor'
import { fenceSpans } from './code'
import { layoutNote, plainPage } from './layout'
import { ruler } from './measure'
import { isTextPage, TEXT_ROWS, textPages } from './text'

const options = { scope: 'off' as const, fence: (code: string) => fenceSpans(code) }
const pages = (source: string) => textPages(source, options)

const PROSE = Array.from(
  { length: 40 },
  (_one, at) => `Paragraph ${at} with enough words in it to run past the end of one line easily.`,
).join('\n\n')

/** The pager the glasses use when they set the note themselves.
 *
 *  It exists because the firmware's measure is not ours. Ours is 16 px at 1.3
 *  leading, about twelve lines to a panel; the firmware's is one font at a fixed
 *  27 px line, ten to a panel. A page cut our way and handed to the firmware
 *  comes out five lines too long and the bottom of it is simply not shown. */
describe('a note as pages the glasses set', () => {
  test('never puts more on a page than the panel holds', () => {
    for (const page of pages(PROSE)) {
      // Every page is at most the panel's ten lines. Counted as the firmware
      // counts, which is what `textPages` cut them by.
      expect(page.words.split('\n').length).toBeLessThanOrEqual(TEXT_ROWS)
    }
  })

  test('cuts a long note into several pages, in order', () => {
    const all = pages(PROSE)

    expect(all.length).toBeGreaterThan(1)
    expect(all.map((one) => one.index)).toEqual(all.map((_one, at) => at))
  })

  test('keeps the position map, so the session does not care which pager ran', () => {
    const all = pages(PROSE)

    // Every page says where in the note it starts, and they only go forwards.
    for (const [at, page] of all.entries()) {
      expect(page.from).toBeGreaterThanOrEqual(0)
      if (at) expect(page.from).toBeGreaterThanOrEqual(all[at - 1]?.from ?? 0)
    }

    expect(all.at(-1)?.to).toBe(PROSE.length)
  })

  test('hashes a page by its words, so an unchanged page is not sent again', () => {
    const [first] = pages(PROSE)
    const [again] = pages(PROSE)

    expect(first?.hash).toBe(again?.hash)
    expect(first?.hash).not.toBe(pages(`x\n\n${PROSE}`)[0]?.hash)
  })

  test('says what a formula is rather than dropping it', () => {
    const [page] = pages('Before.\n\n$$\nE = mc^2\n$$\n\nAfter.\n')

    expect(page?.words).toContain('E = mc^2')
  })

  test('says a table as its rows', () => {
    const [page] = pages('| Kind | Size |\n| --- | --- |\n| Image | 288 |\n')

    expect(page?.words).toContain('Kind')
    expect(page?.words).toContain('Image')
    expect(page?.words).toContain('288')
  })

  test('keeps a fence line by line', () => {
    const [page] = pages('```ts\nconst a = 1\nconst b = 2\n```\n')

    expect(page?.words).toContain('const a = 1')
    expect(page?.words).toContain('const b = 2')
  })

  test('marks a heading, since the firmware has one size', () => {
    const [page] = pages('# A heading\n\nWords.\n')

    expect(page?.words.startsWith('# A heading')).toBe(true)
  })

  test('puts a ligature glyph back as the characters it stands for', () => {
    // The firmware has no such glyph and would draw a blank.
    const [page] = textPages('```ts\nconst a = x => y\n```\n', { ...options, scope: 'code' })

    expect(page?.words).toContain('=>')
  })

  test('answers with nothing for a note with nothing in it', () => {
    expect(pages('')).toEqual([])
  })

  test('is told apart from a drawn page', () => {
    const [text] = pages('Words.\n')
    const [drawn] = layoutNote('Words.\n', {
      ...options,
      palette: CODE_PALETTES[0]!,
      measure: ruler(),
    })

    expect(text && isTextPage(text)).toBe(true)
    expect(drawn && isTextPage(drawn)).toBe(false)
  })
})

/** What text mode costs, page by page. */
describe('whether a page loses anything as words', () => {
  const drawn = (source: string) =>
    layoutNote(source, { ...options, palette: CODE_PALETTES[0]!, measure: ruler() })[0]

  test('plain prose loses nothing', () => {
    const page = drawn('Just some words, wrapping across the panel as prose does.\n')
    expect(page && plainPage(page)).toBe(true)
  })

  test.each([
    ['a heading', '# Heading\n'],
    ['bold', 'a **bold** word\n'],
    ['italic', 'an *italic* word\n'],
    ['inline code', 'some `code` here\n'],
    ['a fence', '```ts\nconst a = 1\n```\n'],
    ['a table', '| a | b |\n| --- | --- |\n| 1 | 2 |\n'],
    ['a quote', '> quoted\n'],
    ['maths', 'the value $E = mc^2$ here\n'],
    ['a link', 'see [the docs](https://example.com)\n'],
  ])('%s does not', (_what, source) => {
    const page = drawn(source)
    expect(page && plainPage(page)).toBe(false)
  })
})
