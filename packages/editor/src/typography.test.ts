import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { frontMatter } from '@orden/markdown'
import { inCodeSpan, keepsStraightQuotes, smartReplacement, typingBreak } from './typography'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function type(line: string, character: string): string {
  const before = line + character
  const replacement = smartReplacement(before)
  if (!replacement) return before
  return before.slice(0, before.length - replacement.consumed) + replacement.insert
}
describe('quotes', () => {
  test('opens at the start of a line', () => {
    expect(type('', '"')).toBe('“')
  })
  test('opens after a space', () => {
    expect(type('he said ', '"')).toBe('he said “')
  })
  test('closes after a word', () => {
    expect(type('he said “hello', '"')).toBe('he said “hello”')
  })
  test('opens after a bracket', () => {
    expect(type('(', '"')).toBe('(“')
  })
  test('handles single quotes the same way', () => {
    expect(type('', "'")).toBe('‘')
    expect(type('‘hello', "'")).toBe('‘hello’')
  })
  test('makes an apostrophe, not an opening quote', () => {
    expect(type('don', "'")).toBe('don’')
  })
})
describe('dashes', () => {
  test('two hyphens become an en dash', () => {
    expect(type('a -', '-')).toBe('a –')
  })
  test('three become an em dash', () => {
    expect(type('a –', '-')).toBe('a —')
  })
  test('a lone hyphen is left alone', () => {
    expect(type('a', '-')).toBe('a-')
  })
})
describe('a line that is a break rather than a sentence', () => {
  const typed = (line: string) => line.split('').reduce((so, character) => type(so, character), '')
  test('three hyphens on their own line stay a rule', () => {
    expect(typed('---')).toBe('---')
  })
  test('and so do the longer runs a rule may be written with', () => {
    expect(typed('----')).toBe('----')
    expect(typed('--------')).toBe('--------')
  })
  test('the second hyphen is the one that had to be spared', () => {
    expect(type('-', '-')).toBe('--')
    expect(type('--', '-')).toBe('---')
  })
  test('indented up to three spaces, and inside a quotation', () => {
    expect(typed('  ---')).toBe('  ---')
    expect(typed('> ---')).toBe('> ---')
    expect(typed('>> ---')).toBe('>> ---')
  })
  test('but dashes in prose still become dashes', () => {
    expect(typed('a -- b')).toBe('a – b')
    expect(typed('a --- b')).toBe('a — b')
    expect(typed('see -- here')).toBe('see – here')
  })
  test('and a line with words on it is prose however it ends', () => {
    expect(typingBreak('---')).toBe(true)
    expect(typingBreak('a --')).toBe(false)
    expect(typingBreak('    --')).toBe(false)
  })
  test('a rule typed rather than commanded stays a rule', () => {
    const note = `# One

${typed('---')}

# Two
`
    expect(note).toContain('\n---\n')
  })
  test('front matter can be opened by typing its fence', () => {
    const note = `${typed('---')}
title: Hi
---

Body.
`
    expect(note.split('\n')[0]).toBe('---')
    expect(frontMatter(note)).toBe('title: Hi')
  })
  test('a line of dashes or equals signs stays as it was typed', () => {
    expect(typed('---')).toBe('---')
    expect(typed('===')).toBe('===')
  })
})
describe('ellipsis', () => {
  test('three dots collapse', () => {
    expect(type('wait..', '.')).toBe('wait…')
  })
  test('two dots do not', () => {
    expect(type('wait.', '.')).toBe('wait..')
  })
})
describe('code spans', () => {
  test('inside backticks nothing is substituted', () => {
    expect(inCodeSpan('run `echo ', 10)).toBe(true)
  })
  test('after the closing backtick it resumes', () => {
    expect(inCodeSpan('run `echo` ', 11)).toBe(false)
  })
  test('an indented code block is left alone', () => {
    expect(inCodeSpan('    let x = "y"', 12)).toBe(true)
  })
  test('a fence is left alone', () => {
    expect(inCodeSpan('```js', 5)).toBe(true)
  })
})
function at(marked: string): boolean {
  const caret = marked.indexOf('|')
  const doc = marked.slice(0, caret) + marked.slice(caret + 1)
  const state = parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return keepsStraightQuotes(state, caret)
}
describe('what keeps its straight quotes', () => {
  test('the body of a fenced block, which is not prose at all', () => {
    expect(at('```js\nconst s = "a|\n```\n')).toBe(true)
    expect(at('```\nwait..|\n```\n')).toBe(true)
  })
  test('an inline code span, and the fence lines themselves', () => {
    expect(at('run `echo "a|` after\n')).toBe(true)
    expect(at('```js|\n\n```\n')).toBe(true)
  })
  test('maths, where a quote is a prime', () => {
    expect(at('the slope $f|$ of it\n')).toBe(true)
    expect(at('$$\nf|\n$$\n')).toBe(true)
  })
  test('front matter, which is YAML', () => {
    expect(at('---\ntitle: "a|\n---\n\nBody.\n')).toBe(true)
  })
  test("a link's address and its title", () => {
    expect(at('see [it](https://x.dev/a|b "T")\n')).toBe(true)
    expect(at('see [it](https://x.dev "a|")\n')).toBe(true)
  })
  test('an HTML tag, whose attributes are quoted straight', () => {
    expect(at('text <span class="a| ">x</span>\n')).toBe(true)
  })
  test('but not the prose around any of them', () => {
    expect(at('he said |\n')).toBe(false)
    expect(at('run `echo` and| then\n')).toBe(false)
    expect(at('```js\nlet x = 1\n```\n\nafter| it\n')).toBe(false)
    expect(at('see [it](https://x.dev) and| more\n')).toBe(false)
  })
  test('and not the deeper lines of a list, which are indented but still prose', () => {
    expect(at('- a\n  - b\n    - c |\n')).toBe(false)
    expect(at('- a\n  - b\n    wraps |\n')).toBe(false)
    expect(at('- a\n\n      code |\n')).toBe(true)
  })
  test('and not a fence that nothing closes, which is a paragraph', () => {
    expect(at('```js\nhe said| something\n')).toBe(false)
  })
})
describe('markdown being typed', () => {
  test("a table's divider row stays hyphens", () => {
    expect(type('| -', '-')).toBe('| --')
    expect(type('| --', '-')).toBe('| ---')
    expect(type('| --- | :-', '-')).toBe('| --- | :--')
    expect(type('|--', '-')).toBe('|---')
  })
  test('an HTML comment opens and closes as written', () => {
    expect(type('a <!-', '-')).toBe('a <!--')
    expect(type('<!-- note -', '-')).toBe('<!-- note --')
    expect(type('<!-- don', "'")).toBe("<!-- don'")
  })
  test("a wiki link's name keeps its straight quotes", () => {
    expect(type('[[Bob', "'")).toBe("[[Bob'")
    expect(type('see [[Q3 -', '-')).toBe('see [[Q3 --')
  })
  test("a link's title keeps its straight quotes before the link is closed", () => {
    expect(type('[a](https://x.com ', '"')).toBe('[a](https://x.com "')
    expect(type('[a](https://x.com "Title', '"')).toBe('[a](https://x.com "Title"')
  })
  test("an HTML tag's attributes keep their straight quotes before the tag is closed", () => {
    expect(type('<img src=', '"')).toBe('<img src="')
    expect(type('<img src="a.png', '"')).toBe('<img src="a.png"')
    expect(type('<img src="a.png" width=', '"')).toBe('<img src="a.png" width="')
  })
  test('maths keeps its primes before the closing dollar is typed', () => {
    expect(type('$f', "'")).toBe("$f'")
    expect(type('the slope $f', "'")).toBe("the slope $f'")
  })
  test('but prose after closed maths, a closed tag or a closed link still gets them', () => {
    expect(type('$x$ don', "'")).toBe('$x$ don’')
    expect(type('a \\$ don', "'")).toBe('a \\$ don’')
    expect(type('<img src="a.png"> she said ', '"')).toBe('<img src="a.png"> she said “')
    expect(type('[a](https://x.com) she said ', '"')).toBe('[a](https://x.com) she said “')
    expect(type('a < b ', '"')).toBe('a < b “')
    expect(type('a <b and it', "'")).toBe('a <b and it’')
    expect(type('`$HOME` isn', "'")).toBe('`$HOME` isn’')
    expect(type('It costs $5 and it', "'")).toBe('It costs $5 and it’')
    expect(type('from $5 to $9 isn', "'")).toBe('from $5 to $9 isn’')
  })
  test('but prose after a closed link or comment still gets them', () => {
    expect(type('[[Bob]] can', "'")).toBe('[[Bob]] can’')
    expect(type('<!-- x --> a -', '-')).toBe('<!-- x --> a –')
    expect(type('a | b -', '-')).toBe('a | b –')
  })
})
