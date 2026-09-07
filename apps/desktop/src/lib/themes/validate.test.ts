import { describe, expect, test } from 'vitest'
import { review, stamped, stampOf } from './validate'

/** The rules a theme from the store is held to. Every one of these is something
 *  a stylesheet from a stranger could do to the app if it were applied as it
 *  arrived, so each has a test rather than a comment. */

const tokens = (body: string) => `[data-theme='dark'] {\n${body}\n}`

describe('what a theme may set', () => {
  test('keeps tokens in the blocks that carry them', () => {
    const reviewed = review(`:root { --measure: 38rem; }
[data-theme='light'] { color-scheme: light; --bg: #fff; }
[data-theme='dark'] { color-scheme: dark; --bg: #000; }`)

    expect(reviewed.refused).toEqual([])
    expect(reviewed.css).toContain('--measure: 38rem;')
    expect(reviewed.css).toContain('--bg: #fff;')
    expect(reviewed.variants).toEqual(['light', 'dark'])
  })

  test('reads a block however its quotes and spaces are written', () => {
    const reviewed = review('[ data-theme = "dark" ] { --bg: #000; }')

    expect(reviewed.refused).toEqual([])
    expect(reviewed.variants).toEqual(['dark'])
  })

  test('keeps prose rules for the parts of a note', () => {
    const reviewed = review(`#write h1 { font-family: Georgia, serif; }
#write blockquote { border-left: 3px solid #888; }
#write pre code { font-weight: 400; }`)

    expect(reviewed.refused).toEqual([])
    expect(reviewed.css).toContain('Georgia, serif')
    expect(reviewed.css).toContain('#write pre code')
  })

  test('takes a selector list apart rather than dropping the rule', () => {
    const reviewed = review('#write h1, .nib-bar { color: #111; }')

    expect(reviewed.css).toContain('#write h1 {')
    expect(reviewed.css).not.toContain('.nib-bar')
    expect(reviewed.refused).toEqual(['.nib-bar is not a selector a theme may set'])
  })
})

describe('what a theme may not set', () => {
  test('refuses a selector outside the tokens and the prose', () => {
    for (const selector of ['body', '.sidebar', '#write .sidebar', '*', '[data-theme=blue]']) {
      const reviewed = review(`${selector} { color: red; }`)

      expect(reviewed.css, selector).toBe('')
      expect(reviewed.refused[0], selector).toContain('is not a selector')
    }
  })

  test('refuses anything that would move or hide a part of the app', () => {
    for (const property of [
      'position',
      'display',
      'inset',
      'z-index',
      'transform',
      'animation',
      'transition',
      'visibility',
      'overflow',
      'width',
      'height',
      'content',
      'pointer-events',
    ]) {
      const reviewed = review(`#write p { ${property}: none; }`)

      expect(reviewed.css, property).toBe('')
      expect(reviewed.refused, property).toEqual([`${property} is not a property a theme may set`])
    }
  })

  test('refuses a property that is not a token in a token block', () => {
    const reviewed = review(tokens('color: red;\n--bg: #000;'))

    expect(reviewed.css).toContain('--bg: #000;')
    expect(reviewed.css).not.toContain('color: red')
    expect(reviewed.refused).toEqual(['color is not a property a theme may set'])
  })

  test('refuses anything that reaches outside the stylesheet', () => {
    for (const value of [
      'url(https://example.com/a.png)',
      'URL("a.png")',
      'image-set("a.png" 1x)',
      'attr(href)',
      'element(#a)',
      'expression(alert(1))',
      'javascript:alert(1)',
      '\\75 rl(a.png)',
    ]) {
      const reviewed = review(tokens(`--bg: ${value};`))

      expect(reviewed.css, value).toBe('')
      expect(reviewed.refused, value).toEqual(['--bg reaches outside the stylesheet'])
    }
  })

  test('refuses every at-rule, whatever it would have held', () => {
    const reviewed = review(`@import url('evil.css');
@media (min-width: 1px) { [data-theme='dark'] { --bg: #000; } }
[data-theme='dark'] { --text: #eee; }`)

    expect(reviewed.css).toContain('--text: #eee;')
    expect(reviewed.css).not.toContain('--bg')
    // The `@import` has no block of its own, so it is read as the front of the
    // `@media` and the two are refused together.
    expect(reviewed.refused).toHaveLength(1)
    expect(reviewed.refused[0]).toContain('@import')
  })

  test('refuses a nested rule rather than reading past it', () => {
    // A scanner that skipped to the first `}` would read `--bg` below as a rule
    // of its own, which is how a whitelist gets walked past.
    const reviewed = review(`[data-theme='dark'] { &:hover { --bg: red; } }`)

    expect(reviewed.css).toBe('')
  })

  test('a name spelled with a CSS escape is not the name it spells', () => {
    // `p\6fsition` is how a browser reads `position`. Nothing here un-escapes
    // anything, and both whitelists match the text as written, so an escape can
    // only ever turn an allowed name into one that is not on the list. Written
    // out as a test because that is a property of the design and not an
    // accident: whitelisting the raw text is what makes it true.
    const reviewed = review(String.raw`#write p { p\6fsition: fixed; }`)

    expect(reviewed.css).toBe('')
    expect(reviewed.refused[0]).toContain('is not a property a theme may set')

    const token = review(String.raw`[data-theme='dark'] { --b\67 : red; }`)
    expect(token.css).toBe('')
  })

  test('a brace inside a string costs the rule rather than letting it out', () => {
    // The scanner follows quotes to find the end of the block, so the block ends
    // where it should; a brace left in the body then means either nesting or a
    // string, and refusing both is the safe way round.
    const reviewed = review(`[data-theme='dark'] { --a: "{"; --bg: red; }`)

    expect(reviewed.css).toBe('')
  })

  test('refuses a file too big to be a theme', () => {
    const reviewed = review(tokens(`--bg: #000;`.repeat(9000)))

    expect(reviewed.css).toBe('')
    expect(reviewed.refused).toEqual(['the file is larger than 48 kB'])
  })

  test('stops reading past the rule it will read', () => {
    const reviewed = review(`[data-theme='dark'] { --bg: #000; }\n`.repeat(200))

    expect(reviewed.refused).toContain('only the first 160 rules are read')
  })
})

describe('the shape of the sheet', () => {
  test('comments hold no braces and no semicolons that count', () => {
    const reviewed = review(`/* } [data-theme='light'] { --bg: red; */
[data-theme='dark'] { --bg: #000; /* ; --text: red; */ }`)

    expect(reviewed.variants).toEqual(['dark'])
    expect(reviewed.css).not.toContain('red')
  })

  test('a semicolon inside a value does not end the declaration', () => {
    const reviewed = review(tokens(`--font-content: 'Semi; colon', serif;\n--bg: #000;`))

    expect(reviewed.css).toContain(`'Semi; colon', serif`)
    expect(reviewed.css).toContain('--bg: #000;')
  })

  test('a declaration left unfinished takes the next one with it', () => {
    // What a browser does too: without the semicolon the two lines are one
    // declaration, whose name is not a token, so neither survives. Named here
    // because a theme author whose theme half works reads it as a bug.
    const reviewed = review(tokens('--bg\n--text: #eee;'))

    expect(reviewed.css).toBe('')
    expect(reviewed.refused).toEqual(['--bg\n--text is not a property a theme may set'])
  })

  test('nothing at all comes out empty rather than throwing', () => {
    expect(review('').css).toBe('')
    expect(review('   ').refused).toEqual([])
    expect(review('}}}{{{').css).toBe('')
  })
})

describe('the stamp an installed theme carries', () => {
  const stamp = { id: 'warm-paper', name: 'Warm Paper', author: 'Nib', version: '1.2.0' }

  test('goes on the front and comes back off', () => {
    const file = stamped(stamp, tokens('--bg: #000;'))

    expect(file.startsWith('/*!')).toBe(true)
    expect(stampOf(file)).toEqual(stamp)
  })

  test('survives a name with a quote in it', () => {
    const odd = { ...stamp, name: `Emil's paper` }
    expect(stampOf(stamped(odd, ''))).toEqual(odd)
  })

  test('is absent from a theme somebody wrote by hand', () => {
    expect(stampOf(tokens('--bg: #000;'))).toBeNull()
    expect(stampOf('/* just a comment */')).toBeNull()
    expect(stampOf('/*! nib-theme {not json} */')).toBeNull()
    expect(stampOf('/*! nib-theme {"id":"a"} */')).toBeNull()
  })

  test('is only read from the front of the file', () => {
    // Otherwise a theme could claim to be another one by writing the line
    // further down, and the store would offer to update the wrong file.
    expect(stampOf(`${tokens('--bg: #000;')}\n${stamped(stamp, '')}`)).toBeNull()
  })
})
