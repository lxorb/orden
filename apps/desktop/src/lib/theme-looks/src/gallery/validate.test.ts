import { describe, expect, test } from 'vitest'
import { stamped, stampOf } from '../../../theme/src/stamp'
import { review } from './validate'

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

  test('keeps the syntax colours a fence is drawn in', () => {
    const reviewed = review(
      tokens(`--syntax-number: #ffc861;
--syntax-function: #79b8ff;
--syntax-type: #5ef2b0;
--syntax-property: #d0a6ff;`),
    )

    expect(reviewed.refused).toEqual([])
    expect(reviewed.css).toContain('--syntax-number: #ffc861;')
    expect(reviewed.css).toContain('--syntax-property: #d0a6ff;')
  })

  test('takes a selector list apart rather than dropping the rule', () => {
    const reviewed = review('#write h1, .orden-bar { color: #111; }')

    expect(reviewed.css).toContain('#write h1 {')
    expect(reviewed.css).not.toContain('.orden-bar')
    expect(reviewed.refused).toEqual(['.orden-bar is not a selector a theme may set'])
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
      expect(reviewed.refused, value).toEqual(['--bg is not a value a theme may set'])
    }
  })

  test('refuses a value that would be read back as something else', () => {
    for (const value of ['red /* ', 'red */ x']) {
      const reviewed = review(tokens(`--bg: ${value};`))

      expect(reviewed.css, value).toBe('')
      expect(reviewed.refused, value).toContain('--bg is not a value a theme may set')
    }

    for (const value of ['"unclosed', "'unclosed"]) {
      const reviewed = review(tokens(`--bg: ${value};`))

      expect(reviewed.css, value).toBe('')
      expect(reviewed.refused, value).toHaveLength(1)
    }
  })

  test('a value cannot open a rule of its own', () => {
    const reviewed = review(`[data-theme='dark'] { --bg: red } html { opacity: 0.02 }`)

    expect(reviewed.css).toBe(`[data-theme=dark] {\n  --bg: red;\n}`)
    expect(reviewed.css).not.toContain('opacity')
    expect(reviewed.refused).toEqual(['html is not a selector a theme may set'])
  })

  test('refuses a selector list that mixes the tokens with the prose', () => {
    for (const list of ['#write, :root', ':root, #write h1', "#write, [data-theme='dark']"]) {
      const reviewed = review(`${list} { opacity: 0.03; font-size: 200px; }`)

      expect(reviewed.css, list).toBe('')
      expect(reviewed.refused[0], list).toContain('mixes the tokens with the prose')
    }
  })

  test('an at-rule with no block of its own does not swallow the rule after it', () => {
    const reviewed = review(`@charset "utf-8";\n[data-theme='dark'] { --bg: #000; }`)

    expect(reviewed.css).toContain('--bg: #000;')
    expect(reviewed.refused).toEqual(['@charset "utf-8" is not a theme rule'])
  })

  test('refuses every at-rule, whatever it would have held', () => {
    const reviewed = review(`@import url('evil.css');
@media (min-width: 1px) { [data-theme='dark'] { --bg: #000; } }
[data-theme='dark'] { --text: #eee; }`)

    expect(reviewed.css).toContain('--text: #eee;')
    expect(reviewed.css).not.toContain('--bg')
    expect(reviewed.refused).toHaveLength(2)
    expect(reviewed.refused[0]).toContain('@import')
    expect(reviewed.refused[1]).toContain('@media')
  })

  test('refuses a nested rule rather than reading past it', () => {
    const reviewed = review(`[data-theme='dark'] { &:hover { --bg: red; } }`)

    expect(reviewed.css).toBe('')
  })

  test('a name spelled with a CSS escape is not the name it spells', () => {
    const reviewed = review(String.raw`#write p { p\6fsition: fixed; }`)

    expect(reviewed.css).toBe('')
    expect(reviewed.refused[0]).toContain('is not a property a theme may set')

    const token = review(String.raw`[data-theme='dark'] { --b\67 : red; }`)
    expect(token.css).toBe('')
  })

  test('refuses a value with a function nobody closed', () => {
    const reviewed = review(`[data-theme='dark'] { --bg: rgb(0,0,0 } #write h1 { color: red; }`)

    expect(reviewed.css).not.toContain('rgb(0,0,0')
    expect(reviewed.refused).toContain('--bg is not a value a theme may set')
    expect(reviewed.css).toContain('#write h1')
  })

  test('refuses a bracket that closes nothing', () => {
    const reviewed = review(tokens('--bg: red);'))

    expect(reviewed.css).toBe('')
    expect(reviewed.refused).toEqual(['--bg is not a value a theme may set'])
  })

  test('a bracket inside a string is not a bracket', () => {
    const reviewed = review(tokens(`--font-content: 'Half (', serif;`))

    expect(reviewed.css).toContain(`'Half (', serif`)
    expect(reviewed.refused).toEqual([])
  })

  test('a brace inside a string costs the rule rather than letting it out', () => {
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
  const stamp = { id: 'warm-paper', name: 'Warm Paper', author: 'Orden', version: '1.2.0' }

  test('goes on the front and comes back off', () => {
    const file = stamped(stamp, tokens('--bg: #000;'))

    expect(file.startsWith('/*!')).toBe(true)
    expect(stampOf(file)).toEqual(stamp)
  })

  test('survives a name with a quote in it', () => {
    const odd = { ...stamp, name: `Emil's paper` }
    expect(stampOf(stamped(odd, ''))).toEqual(odd)
  })

  test('cannot be made to close its own comment', () => {
    const evil = {
      id: 'a',
      name: 'A */ html { opacity: 0.02 } /*',
      author: 'B',
      version: '1.0.0 */ .rail { display: none } /*',
    }
    const file = stamped(evil, tokens('--bg: #000;'))

    const line = file.slice(0, file.indexOf('\n'))
    expect(line.split('*/')).toHaveLength(2)
    expect(line.endsWith('*/')).toBe(true)

    expect(stampOf(file)?.id).toBe('a')
    expect(stampOf(file)?.version).toBe('1.0.0  .rail { display: none } ')
  })

  test('is absent from a theme somebody wrote by hand', () => {
    expect(stampOf(tokens('--bg: #000;'))).toBeNull()
    expect(stampOf('/* just a comment */')).toBeNull()
    expect(stampOf('/*! orden-theme {not json} */')).toBeNull()
    expect(stampOf('/*! orden-theme {"id":"a"} */')).toBeNull()
  })

  test('is only read from the front of the file', () => {
    expect(stampOf(`${tokens('--bg: #000;')}\n${stamped(stamp, '')}`)).toBeNull()
  })
})
