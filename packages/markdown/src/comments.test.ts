import { describe, expect, test } from 'vitest'
import { noteWithoutComments, withoutComments } from './comments'
import { htmlToMarkdown } from './from-html'
import { renderMarkdown } from './index'
import { asWords } from './words'

describe('a comment in the source', () => {
  test('goes, and the words around it stay', () => {
    expect(withoutComments('before <!-- aside --> after')).toBe('before  after')
  })

  test('goes when it spans several lines', () => {
    expect(withoutComments('one\n<!-- a\nb\nc -->\ntwo')).toBe('one\n\n\n\ntwo')
  })

  test('leaves the line it had to itself behind, empty', () => {
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

describe('an escaped comment marker', () => {
  test('opens no comment, and the rest of the note stays', () => {
    const source = 'Write \\<!-- to open a comment.\n\nSecond paragraph.'
    expect(withoutComments(source)).toBe(source)
  })

  test('opens no comment after an escaped bracket or backtick either', () => {
    expect(withoutComments('a \\[<!-- b --> c')).toBe('a \\[ c')
    expect(withoutComments('a \\`<!-- b -->` c')).toBe('a \\`` c')
  })

  test('opens one when the backslash is itself escaped', () => {
    expect(withoutComments('a \\\\<!-- b --> c')).toBe('a \\\\ c')
  })

  test('is left alone inside backticks, backslash and all', () => {
    expect(withoutComments('`a\\`<!-- b -->')).toBe('`a\\`')
  })
})

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
  test('written as words by a conversion stays words, and so does the rest', () => {
    const code = htmlToMarkdown('<p>Write &lt;!-- to open a comment.</p><p>Second paragraph.</p>')
    expect(code).toBe('Write \\<!-- to open a comment.\n\nSecond paragraph.')
    expect(renderMarkdown(code)).toBe(
      '<p>Write &lt;!-- to open a comment.</p>\n<p>Second paragraph.</p>\n',
    )
    expect(renderMarkdown(asWords('Write <!-- to open a comment.\n\nSecond paragraph.'))).toBe(
      '<p>Write &lt;!-- to open a comment.</p>\n<p>Second paragraph.</p>\n',
    )
  })

  test('is nowhere in the rendered HTML', () => {
    const html = renderMarkdown('# Head\n\n<!-- a note to myself -->\n\nWords.\n')
    expect(html).not.toContain('a note to myself')
    expect(html).toContain('Words.')
  })

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

  test('leaves a deck’s speaker notes alone', () => {
    const html = renderMarkdown('# Slide\n\n<!-- gone -->\n\nNote: said out loud\n')
    expect(html).not.toContain('gone')
    expect(html).toContain('said out loud')
  })
})

describe('a comment after code that only looks like a fence', () => {
  test('goes after a line of inline code in three backticks', () => {
    const html = renderMarkdown('```inline```\n\n%%secret%%\n\nmore <!-- hidden -->', {
      escapeHtml: true,
    })
    expect(html).toContain('<code>inline</code>')
    expect(html).not.toContain('secret')
    expect(html).not.toContain('hidden')
    expect(html).toContain('more')
  })

  test('goes after a code span with a longer run of backticks inside it', () => {
    expect(withoutComments('a `` x ``` y `` %%secret%% b')).toBe('a `` x ``` y ``  b')
    expect(withoutComments('a `` %%secret%% ``` b')).toBe('a ``  ``` b')
  })

  test('goes from a fence’s info string, and never becomes its caption', () => {
    expect(withoutComments('```js %%secret%%\nx %%kept%%\n```')).toBe('```js \nx %%kept%%\n```')
    expect(withoutComments('```js <!-- open\nx\n```')).toBe('```js \nx\n```')
    const html = renderMarkdown('```js src/a.ts %%secret%%\nx\n```', { escapeHtml: true })
    expect(html).not.toContain('secret')
    expect(html).toContain('<figcaption>src/a.ts</figcaption>')
  })
})

describe('a comment marker in code a fence does not open', () => {
  test('is left alone in a fence inside a quote or a callout', () => {
    const source = '> [!note]\n> ```\n> %%timeit\n> ```\n\nafter'
    expect(withoutComments(source)).toBe(source)
    expect(renderMarkdown(source)).toContain('after')
  })

  test('is left alone in indented code', () => {
    const source = '    %%timeit\n    <!-- x\n\nfoo'
    expect(withoutComments(source)).toBe(source)
    expect(renderMarkdown(source)).toContain('foo')
  })

  test('is left alone in a fence that a shorter one does not close', () => {
    const source = '````\n```\n%%x\n````\n\nfoo'
    expect(withoutComments(source)).toBe(source)
  })

  test('is left alone in indented code after a line the comment took', () => {
    const source = 'words\n<!-- c -->\n    %%x\n\nafter'
    expect(withoutComments(source)).toBe('words\n\n    %%x\n\nafter')
    expect(renderMarkdown(source)).toContain('after')
  })

  test('still opens one on an indented line that carries on a paragraph', () => {
    expect(withoutComments('words\n    %%gone%% kept')).toBe('words\n     kept')
  })
})

describe('a whole note, its front matter included', () => {
  test('a comment closed in a value goes', () => {
    expect(noteWithoutComments('---\ntitle: Launch %% secret %%\nz: 1\n---\nWords\n')).toBe(
      '---\ntitle: Launch \nz: 1\n---\nWords\n',
    )
    expect(noteWithoutComments('---\nt: a <!-- b --> c\n---\nWords\n')).toBe(
      '---\nt: a  c\n---\nWords\n',
    )
  })

  test('a comment of whole lines goes', () => {
    expect(noteWithoutComments('---\nt: a\n%%\nsecret: 5\n%%\nz: 1\n---\nWords\n')).toBe(
      '---\nt: a\n\n\n\nz: 1\n---\nWords\n',
    )
    expect(noteWithoutComments('---\nt: a\n<!-- secret: 5 -->\n---\nWords\n')).toBe(
      '---\nt: a\n\n---\nWords\n',
    )
  })

  test('an opener nothing closes on its line is the value own, and stops at the block', () => {
    for (const note of [
      '---\nnote: 50%% off\n---\nWords\n',
      '---\nnote: 50%% off\nother: 60%% more\n---\nWords\n',
      '---\nnote: a <!-- b\nz: 1\n---\nWords\n',
      '---\nt: a\n%%\nz: 1\n---\nWords\n',
    ]) {
      expect(noteWithoutComments(note)).toBe(note)
    }
    expect(noteWithoutComments('---\nnote: 50%% off\n---\nWords %% mine %% here\n')).toBe(
      '---\nnote: 50%% off\n---\nWords  here\n',
    )
  })
})
