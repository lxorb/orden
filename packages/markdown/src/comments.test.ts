import { describe, expect, test } from 'vitest'
import { withoutComments } from './comments'
import { renderMarkdown } from './index'

describe('a comment in the source', () => {
  test('goes, and the words around it stay', () => {
    expect(withoutComments('before <!-- aside --> after')).toBe('before  after')
  })

  /** Line for line: what it held goes and the lines stay, which is the same rule
   *  as the one below and keeps a blank line where a block used to be. */
  test('goes when it spans several lines', () => {
    expect(withoutComments('one\n<!-- a\nb\nc -->\ntwo')).toBe('one\n\n\n\ntwo')
  })

  test('leaves the line it had to itself behind, empty', () => {
    // A comment on its own line already ends the paragraph above it in
    // CommonMark, so dropping the line as well would join two paragraphs that
    // were never one.
    expect(withoutComments('one\n\n<!-- note -->\n\ntwo')).toBe('one\n\n\n\ntwo')
  })

  test('is left alone inside a fence, which is showing it', () => {
    const source = '```html\n<!-- kept -->\n```\n\n<!-- gone -->'
    expect(withoutComments(source)).toBe('```html\n<!-- kept -->\n```\n\n')
  })

  test('is left alone inside a tilde fence too', () => {
    expect(withoutComments('~~~\n<!-- kept -->\n~~~')).toBe('~~~\n<!-- kept -->\n~~~')
  })

  test('is left alone inside backticks', () => {
    expect(withoutComments('write `<!-- this -->` to hide a note')).toBe(
      'write `<!-- this -->` to hide a note',
    )
  })

  test('is taken out either side of some inline code', () => {
    expect(withoutComments('<!-- a -->`code`<!-- b -->')).toBe('`code`')
  })

  test('that never closes takes the rest of the note with it', () => {
    // Which is what a browser does with it too, and what CommonMark says of an
    // HTML block nothing closes.
    expect(withoutComments('one\n\n<!-- open\ntwo\nthree')).toBe('one\n\n\n\n')
  })

  test('costs nothing to look for in a note that has none', () => {
    const source = 'a note with no comment in it at all\n'
    expect(withoutComments(source)).toBe(source)
  })

  test('a run of backticks that never closes is not code, and the scan carries on', () => {
    expect(withoutComments('` <!-- gone -->')).toBe('` ')
  })
})

/** Obsidian's spelling of the same thing, read by the same scan. */
describe('a percent comment', () => {
  test('goes, and the words around it stay', () => {
    expect(withoutComments('before %%aside%% after')).toBe('before  after')
  })

  test('goes when it spans several lines, and the lines stay', () => {
    expect(withoutComments('one\n%% a\nb\nc %%\ntwo')).toBe('one\n\n\n\ntwo')
  })

  test('is left alone inside a fence, which is showing it', () => {
    expect(withoutComments('```\n%% kept %%\n```')).toBe('```\n%% kept %%\n```')
  })

  test('is left alone inside backticks', () => {
    expect(withoutComments('write `%% this %%` to hide a note')).toBe(
      'write `%% this %%` to hide a note',
    )
  })

  test('that never closes takes the rest of the note with it, as Obsidian does', () => {
    expect(withoutComments('one\n\n%% open\ntwo')).toBe('one\n\n\n')
  })

  test('costs nothing to look for in a note that has none', () => {
    const source = 'a note with 50 per cent and no comment\n'
    expect(withoutComments(source)).toBe(source)
  })

  test('stands beside the other spelling in one note', () => {
    expect(withoutComments('a <!-- one --> b %% two %% c')).toBe('a  b  c')
  })

  test('whichever opens first is the one that opens', () => {
    expect(withoutComments('a %% b <!-- c %% d')).toBe('a  d')
  })
})

describe('a comment on the page', () => {
  test('is nowhere in the rendered HTML', () => {
    const html = renderMarkdown('# Head\n\n<!-- a note to myself -->\n\nWords.\n')
    expect(html).not.toContain('a note to myself')
    expect(html).toContain('Words.')
  })

  /** The bug: publishing escapes a note's HTML, because a blog shares a domain
   *  with every other blog, and the escape turned a comment into a line of prose
   *  on the page. */
  test('is not shown as text on a published page', () => {
    const html = renderMarkdown('<!-- private -->\n\nWords.\n', { escapeHtml: true })
    expect(html).not.toContain('private')
    expect(html).not.toContain('&lt;!--')
  })

  test('inside a fence is still part of what the fence shows', () => {
    const html = renderMarkdown('```html\n<!-- kept -->\n```\n')
    expect(html).toContain('&lt;!-- kept --&gt;')
  })

  test('does not disturb the table of contents, which is a comment of the renderer’s own', () => {
    const html = renderMarkdown('[toc]\n\n# One\n\n<!-- hidden -->\n\n## Two\n', { toc: true })

    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('One')
    expect(html).toContain('Two')
    expect(html).not.toContain('hidden')
  })

  /** A deck's speaker notes are a `Note:` line, not a comment, so they are
   *  untouched by any of this; see slides.ts. */
  test('leaves a deck’s speaker notes alone', () => {
    const html = renderMarkdown('# Slide\n\n<!-- gone -->\n\nNote: said out loud\n')
    expect(html).not.toContain('gone')
    expect(html).toContain('said out loud')
  })
})
