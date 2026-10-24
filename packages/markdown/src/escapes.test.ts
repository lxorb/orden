import { describe, expect, test } from 'vitest'
import { escapeText, plainWords } from './escapes'
import { renderMarkdown } from './index'

/** One text node at a time, which is how turndown hands a page's words over.
 *  from-html.test.ts is the same rule seen through a conversion; what is here is
 *  the rule itself, including the edges a page rarely reaches and an adversarial
 *  one aims for. */
/** Words typed in another app that never meant markdown, a line at a time: they
 *  read back as themselves, but a line that is a list item stays one. */
describe('plain text, as a note may hold it', () => {
  test('a dollar, a tilde, a caret and two percent signs are the characters', () => {
    expect(plainWords('Tickets $5-$10\nwait ~5 min or ~10 min\nx^2 and format is %%d')).toBe(
      'Tickets \\$5-\\$10\nwait \\~5 min or \\~10 min\nx\\^2 and format is %\\%d',
    )
    expect(renderMarkdown(plainWords('Tickets $5-$10, format is %%d\nrest'))).toBe(
      '<p>Tickets $5-$10, format is %%d\nrest</p>\n',
    )
  })

  test('two equals signs are the characters, not a highlight', () => {
    expect(plainWords('if a==b or c==d then\nx === y')).toBe(
      'if a=\\=b or c=\\=d then\nx =\\=\\= y',
    )
    expect(renderMarkdown(plainWords('if a==b or c==d then'))).toBe('<p>if a==b or c==d then</p>\n')
  })

  test('a list item stays a list item, and a heading-like line is words', () => {
    expect(plainWords('- milk at ~2\n  * eggs $3\n1. one\n# not a heading')).toBe(
      '- milk at \\~2\n  * eggs \\$3\n1. one\n\\# not a heading',
    )
  })

  /** Up to three spaces in front change nothing about what a line opens, and four
   *  make it code, where an escape is shown as a backslash. */
  test('an indented line keeps its meaning', () => {
    const NBSP = '\u00a0'
    expect(plainWords('   # x\n  > x\nfoo\n   ---')).toBe('   \\# x\n  \\> x\nfoo\n   \\---')
    expect(renderMarkdown(plainWords('   # x\n\n  > x\n\nfoo\n   ---'))).toBe(
      '<p>   # x</p>\n<p>  &gt; x</p>\n<p>foo\n   ---</p>\n',
    )
    const indented = plainWords('Sum:\n\n    total $5 or ~10\n\n\tand a tab')
    expect(indented).toBe(
      `Sum:\n\n${NBSP.repeat(4)}total \\$5 or \\~10\n\n${NBSP.repeat(4)}and a tab`,
    )
    expect(renderMarkdown(indented)).toBe(
      `<p>Sum:</p>\n<p>${NBSP.repeat(4)}total $5 or ~10</p>\n<p>${NBSP.repeat(4)}and a tab</p>\n`,
    )
  })

  test('a bare address still links', () => {
    expect(plainWords('see https://a.test/~al/_x_/ now')).toBe('see https://a.test/~al/_x_/ now')
  })
})

/** A page's prose, where the renderer autolinks a bare address. */
const PROSE = { addresses: true }

describe('a page’s text, as a note may hold it', () => {
  test('prose is prose', () => {
    expect(escapeText('Schauen Sie sich das Cheatsheet an.')).toBe(
      'Schauen Sie sich das Cheatsheet an.',
    )
  })

  test('a marker that would be read as markup is escaped', () => {
    expect(escapeText('see [1] and [2]')).toBe('see \\[1\\] and \\[2\\]')
    expect(escapeText('a ` and nothing to close it')).toBe('a \\` and nothing to close it')
    expect(escapeText('*emphasis*')).toBe('\\*emphasis\\*')
    expect(escapeText('_emphasis_')).toBe('\\_emphasis\\_')
  })

  describe('an escape that changes nothing', () => {
    test('is not written in front of an underscore inside a word', () => {
      expect(escapeText('cx_out and snake_case_name')).toBe('cx_out and snake_case_name')
    })

    test('and is still written where the underscore can open emphasis', () => {
      expect(escapeText('_start and end_')).toBe('\\_start and end\\_')
      expect(escapeText('a _ b')).toBe('a \\_ b')
      // The ends of the text are the next node's business, so they are escaped.
      expect(escapeText('_out')).toBe('\\_out')
      expect(escapeText('out_')).toBe('out\\_')
    })

    test('nor in front of a star that leans neither way', () => {
      expect(escapeText('2 * 3 = 6')).toBe('2 * 3 = 6')
    })

    test('and is still written where the star could begin a list or a word', () => {
      expect(escapeText('* item')).toBe('\\* item')
      expect(escapeText('  * item')).toBe('  \\* item')
      expect(escapeText('2*3*4')).toBe('2\\*3\\*4')
      expect(escapeText('rename *.md to *.txt')).toBe('rename \\*.md to \\*.txt')
    })

    test('nor in front of a backslash that escapes nothing', () => {
      expect(escapeText('C:\\Users\\me')).toBe('C:\\Users\\me')
    })

    test('and is still written where the backslash would eat the marker after it', () => {
      expect(escapeText('C:\\*.md')).toBe('C:\\\\\\*.md')
      // At the end of the text, whatever the next node starts with.
      expect(escapeText('ends in \\')).toBe('ends in \\\\')
    })
  })

  describe('a run that is unmistakably markdown', () => {
    test('is kept as it was written', () => {
      expect(escapeText('überfliegen Sie **kurz** das Dokument')).toBe(
        'überfliegen Sie **kurz** das Dokument',
      )
      expect(escapeText('ganz __fett__ gesagt')).toBe('ganz __fett__ gesagt')
      expect(escapeText('run `npm run dev` first')).toBe('run `npm run dev` first')
    })

    test('and a code span keeps what a fence would keep', () => {
      expect(escapeText('the `<img>` tag')).toBe('the `<img>` tag')
      expect(escapeText('write `a_b` for it')).toBe('write `a_b` for it')
    })

    test('unless a marker has a blank against it, where markdown stops reading one', () => {
      expect(escapeText('2 ** 3 ** 4')).toBe('2 \\*\\* 3 \\*\\* 4')
      expect(escapeText('**half open')).toBe('\\*\\*half open')
    })

    test('unless there is more of the same marker against it', () => {
      expect(escapeText('***drei***')).toBe('\\*\\*\\*drei\\*\\*\\*')
    })

    test('unless the words inside it are not words', () => {
      expect(escapeText('**<img src=q>**')).toBe('\\*\\*\\<img src=q>\\*\\*')
      expect(escapeText('**[a](javascript:alert(1))**')).toBe(
        '\\*\\*\\[a\\](javascript:alert(1))\\*\\*',
      )
      expect(escapeText('**a\\**')).toBe('\\*\\*a\\\\\\*\\*')
      expect(escapeText('**a`b**')).toBe('\\*\\*a\\`b\\*\\*')
    })

    test('and the words around it are escaped as the text they are', () => {
      expect(escapeText('[1] **kurz** *lang*')).toBe('\\[1\\] **kurz** \\*lang\\*')
    })

    /** A page is somebody else's to fill with whatever it likes, and a run of
     *  backticks with no end to it is the shape that would have the engine try
     *  every length of it. Three is every code span anybody writes. */
    test('and a wall of markers is escaped rather than read', () => {
      expect(escapeText('````x````')).toBe('\\`\\`\\`\\`x\\`\\`\\`\\`')
      expect(escapeText(`${'`'.repeat(2000)}x`)).toBe(`${'\\`'.repeat(2000)}x`)
    })
  })

  /** Only at the start of the text, which is where turndown looked for these too:
   *  a marker in the middle of a line opens nothing. */
  describe('a marker that would open a block of its own', () => {
    test('is escaped where the text begins', () => {
      expect(escapeText('+ Lesen und üben Sie')).toBe('\\+ Lesen und üben Sie')
      expect(escapeText('# 1 der Liste')).toBe('\\# 1 der Liste')
      expect(escapeText('> sagte sie')).toBe('\\> sagte sie')
      expect(escapeText('- eins')).toBe('\\- eins')
      expect(escapeText('--- und weiter')).toBe('\\--- und weiter')
      expect(escapeText('=== und weiter')).toBe('\\=== und weiter')
      expect(escapeText('~~~ und weiter')).toBe('\\~~~ und weiter')
      expect(escapeText('1. eins')).toBe('1\\. eins')
      expect(escapeText('1) eins')).toBe('1\\) eins')
    })

    test('and is not where the same characters are punctuation', () => {
      expect(escapeText('-5 °C und +5 °C')).toBe('-5 °C und +5 °C')
      expect(escapeText('#hashtag')).toBe('#hashtag')
      expect(escapeText('sagte sie > mir')).toBe('sagte sie > mir')
      expect(escapeText('Kapitel 1. eins')).toBe('Kapitel 1. eins')
      expect(escapeText('Kapitel 1) eins')).toBe('Kapitel 1) eins')
    })
  })

  /** The rule the whole escaping was written for, and the one a kept run must not
   *  be a way around: a note's own HTML is markup, so a page's `<` is not. */
  test('a bracket that would open a tag is escaped wherever it is', () => {
    expect(escapeText('a <img src=x onerror=alert(1)> b')).toBe(
      'a \\<img src=x onerror=alert(1)> b',
    )
    expect(escapeText('**kurz** <script>alert(1)</script>')).toBe(
      '**kurz** \\<script>alert(1)\\</script>',
    )
    expect(escapeText('a < b')).toBe('a < b')
  })

  /** Obsidian's comment opens on two percent signs and closes on the next two, so
   *  a page quoting `printf("%%d")` twice would lose every word between them. */
  test('a percent sign that would open or close a comment is escaped', () => {
    expect(escapeText('printf("%%d") and then printf("%%s") again')).toBe(
      'printf("%\\%d") and then printf("%\\%s") again',
    )
    expect(escapeText('%%%')).toBe('%\\%\\%')
    expect(escapeText('**a %% b** and %%')).toBe('\\*\\*a %\\% b\\*\\* and %\\%')
    expect(escapeText('100% sure, 50 % off')).toBe('100% sure, 50 % off')
  })

  /** The renderer links a bare address as it is written, backslashes and all, so an
   *  escape inside one is a broken link rather than a safer one. */
  test('a bare web address is kept as it was written', () => {
    expect(escapeText('see https://www.cs.cmu.edu/~bob/ now', PROSE)).toBe(
      'see https://www.cs.cmu.edu/~bob/ now',
    )
    expect(escapeText('https://ex.com/page#:~:text=hello', PROSE)).toBe(
      'https://ex.com/page#:~:text=hello',
    )
    // But for its brackets and backticks, which could close or open something
    // around it where the address is a link's text. The renderer reads past those.
    expect(escapeText('at www.example.com/_next/x and https://ex.com/a?b=[1]&c=`d`.', PROSE)).toBe(
      'at www.example.com/_next/x and https://ex.com/a?b=\\[1\\]&c=\\`d\\`.',
    )
    expect(escapeText('a <https://ex.com/x>', PROSE)).toBe('a \\<https://ex.com/x>')
    // What the renderer leaves off the end of an address is words again.
    expect(escapeText('(https://ex.com/a_b) and *ftp://ex.com/x*', PROSE)).toBe(
      '(https://ex.com/a_b) and \\*ftp://ex.com/x\\*',
    )
    // Not an address: nothing after the scheme, or no scheme the renderer links.
    expect(escapeText('https:// and mailto:a_b [x]', PROSE)).toBe('https:// and mailto:a_b \\[x\\]')
    // Nor one that holds a comment's two percent signs, which no writing keeps.
    expect(escapeText('https://ex.com/a%%b', PROSE)).toBe('https://ex.com/a%\\%b')
  })

  /** Inline maths opens on a dollar with something other than a blank after it
   *  and closes on the next one with something other than a blank before it, so
   *  two prices in a sentence would draw the words between as a formula. */
  test('a dollar that would open or close maths is escaped', () => {
    expect(escapeText('Tickets cost $5-$10 each', PROSE)).toBe('Tickets cost \\$5-\\$10 each')
    expect(escapeText('5$ or 10$', PROSE)).toBe('5\\$ or 10\\$')
    expect(escapeText('$$', PROSE)).toBe('\\$\\$')
    expect(escapeText('a $ b', PROSE)).toBe('a $ b')
  })

  /** A kept run is written as it is, so a dollar inside one would be a dollar the
   *  rule above never saw: `**$5** and **$6**` would be maths from one to the other. */
  test('a doubled marker around a dollar is escaped rather than kept', () => {
    expect(escapeText('**$5** and **$6**', PROSE)).toBe('\\*\\*\\$5\\*\\* and \\*\\*\\$6\\*\\*')
  })

  /** Only a caller that knows its words are prose asks for addresses to be kept. A
   *  link's text written by hand around the result - a media link's name, a card's
   *  title - is inside brackets, where nothing autolinks. */
  test('an address is words unless the words are said to be prose', () => {
    const name = escapeText('https://player.test/v/__ab__/')
    expect(name).toBe('https://player.test/v/\\_\\_ab\\_\\_/')
    expect(renderMarkdown(`[${name}](https://player.test/v/__ab__/)`)).toBe(
      '<p><a class="url" href="https://player.test/v/__ab__/">https://player.test/v/__ab__/</a></p>\n',
    )
  })

  test('nothing in, nothing out', () => {
    expect(escapeText('')).toBe('')
  })
})
