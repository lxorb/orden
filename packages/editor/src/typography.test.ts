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
  test.each([
    ['', '“', '"'],
    ['he said ', 'he said “', '"'],
    ['he said “hello', 'he said “hello”', '"'],
    ['(', '(“', '"'],
    ['', '‘', "'"],
    ['‘hello', '‘hello’', "'"],
    ['don', 'don’', "'"],
  ])('%j', (input, wanted, extra) => expect(type(input, extra)).toEqual(wanted))
})

describe('dashes', () => {
  test.each([
    ['a -', 'a –', '-'],
    ['a –', 'a —', '-'],
    ['a', 'a-', '-'],
  ])('%j', (input, wanted, extra) => expect(type(input, extra)).toEqual(wanted))
})

describe('a line that is a break rather than a sentence', () => {
  const typed = (line: string) => line.split('').reduce((so, character) => type(so, character), '')

  test.each([
    ['---', '---'],
    ['----', '----'],
    ['--------', '--------'],
    ['  ---', '  ---'],
    ['> ---', '> ---'],
    ['>> ---', '>> ---'],
    ['a -- b', 'a – b'],
    ['a --- b', 'a — b'],
    ['see -- here', 'see – here'],
  ])('%j', (input, wanted) => expect(typed(input)).toEqual(wanted))

  test.each([
    ['-', '--', '-'],
    ['--', '---', '-'],
  ])('%j', (input, wanted, extra) => expect(type(input, extra)).toEqual(wanted))

  test.each([
    ['---', true],
    ['a --', false],
    ['    --', false],
  ])('%j', (input, wanted) => expect(typingBreak(input)).toEqual(wanted))

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

  test.each([
    ['---', '---'],
    ['===', '==='],
  ])('%j', (input, wanted) => expect(typed(input)).toEqual(wanted))
})

describe('ellipsis', () => {
  test.each([
    ['wait..', 'wait…', '.'],
    ['wait.', 'wait..', '.'],
  ])('%j', (input, wanted, extra) => expect(type(input, extra)).toEqual(wanted))
})

describe('code spans', () => {
  test.each([
    ['run `echo ', true, 10],
    ['run `echo` ', false, 11],
    ['    let x = "y"', true, 12],
    ['```js', true, 5],
  ])('%j', (input, wanted, extra) => expect(inCodeSpan(input, extra)).toEqual(wanted))
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
  test.each([
    ['```js\nconst s = "a|\n```\n', true],
    ['```\nwait..|\n```\n', true],
    ['run `echo "a|` after\n', true],
    ['```js|\n\n```\n', true],
    ['the slope $f|$ of it\n', true],
    ['$$\nf|\n$$\n', true],
    ['---\ntitle: "a|\n---\n\nBody.\n', true],
    ['see [it](https://x.dev/a|b "T")\n', true],
    ['see [it](https://x.dev "a|")\n', true],
    ['text <span class="a| ">x</span>\n', true],
    ['he said |\n', false],
    ['run `echo` and| then\n', false],
    ['```js\nlet x = 1\n```\n\nafter| it\n', false],
    ['see [it](https://x.dev) and| more\n', false],
    ['```js\nhe said| something\n', false],
  ])('%j', (input, wanted) => expect(at(input)).toEqual(wanted))
})
