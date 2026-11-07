import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { type Tree } from '@lezer/common'
import { InlineContext, type MarkdownParser } from '@lezer/markdown'
import { describe, expect, test } from 'vitest'
import { nibMarkdownExtensions, nibMarkdownParser } from './extensions'

type Inline = ((cx: InlineContext, next: number, pos: number) => number) & { triggers?: string }

type Inside = MarkdownParser & {
  inlineParsers: readonly (Inline | undefined)[]
  inlineNames: readonly string[]
  inlineTable?: readonly (readonly Inline[])[]
}

const Context = InlineContext as unknown as new (
  parser: MarkdownParser,
  text: string,
  offset: number,
) => InlineContext

const parsers: Record<string, MarkdownParser> = {
  nib: nibMarkdownParser,
  editor: markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions }).language
    .parser as MarkdownParser,
}

const PIECES = [
  'a',
  'word',
  ' ',
  '  ',
  '\n',
  '*',
  '**',
  '_',
  '~~',
  '~',
  '^',
  '==',
  '%%',
  '$',
  '$$',
  '`',
  '``',
  '[',
  ']',
  '[[',
  ']]',
  '![',
  '[^',
  '(',
  ')',
  '<',
  '>',
  '<b>',
  '</b>',
  '<!--',
  '-->',
  '&amp;',
  '&',
  '\\',
  '\\*',
  'https://x.org/a',
  'www.ex.com',
  'a@b.co',
  'mailto:a@b.co',
  'x:',
  ':smile:',
  '#tag',
  '#',
  '@',
  '.',
  '+',
  '-',
  'é',
  '中',
  '😀',
  '\t',
  '"',
  "'",
  ':',
  '!',
  '|',
]

function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

function texts(count: number, seed: number): string[] {
  const next = random(seed)
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 1 + Math.floor(next() * 40) },
      () => PIECES[Math.floor(next() * PIECES.length)],
    ).join(''),
  )
}

function shape(parser: MarkdownParser, text: string): string {
  const tree: Tree = parser.parse(text)
  const out: string[] = []
  tree.iterate({ enter: (node) => void out.push(`${node.name} ${node.from}-${node.to}`) })
  return out.join(' ')
}

describe.each(Object.entries(parsers))('the %s parser', (_name, parser) => {
  const inside = parser as Inside

  test('names the characters of most of its inline parsers', () => {
    const named = inside.inlineParsers.filter((parse) => parse?.triggers !== undefined)
    expect(named.length).toBeGreaterThan(inside.inlineParsers.filter(Boolean).length - 3)
  })

  test('has every inline parser that names its characters decline any other', () => {
    for (const text of texts(400, 11)) {
      inside.inlineParsers.forEach((parse, index) => {
        if (parse?.triggers === undefined) return
        for (let pos = 0; pos < text.length; pos++) {
          const next = text.charCodeAt(pos)
          if (parse.triggers.includes(String.fromCharCode(next))) continue
          const cx = new Context(parser, text, 0)
          const result = parse(cx, next, pos)
          expect(result, `${inside.inlineNames[index]} at ${pos} of ${JSON.stringify(text)}`).toBe(
            -1,
          )
        }
      })
    }
  })

  test('reads text the same as when every parser is asked at every character', () => {
    const every = Object.create(parser) as Inside
    const all = inside.inlineParsers.filter((parse): parse is Inline => Boolean(parse))
    Object.defineProperty(every, 'inlineTable', { value: Array.from({ length: 129 }, () => all) })
    for (const text of texts(600, 5)) {
      expect(shape(parser, text), JSON.stringify(text)).toBe(shape(every, text))
    }
  })
})

describe('an address in text', () => {
  function urls(text: string): string[] {
    const out: string[] = []
    nibMarkdownParser.parse(text).iterate({
      enter: (node) => {
        if (node.name === 'URL') out.push(text.slice(node.from, node.to))
      },
    })
    return out
  }

  test.each([
    ['a', true],
    ['Kestrel', true],
    ['wind', true],
    ['hawk', true],
    ['moss', true],
    ['x1', true],
    ['9lives', true],
    ['_under', false],
    ['.dot', true],
    ['+plus', true],
    ['-dash', true],
    ['a.b+c-d_e', true],
    ['q'.repeat(100), true],
    ['q'.repeat(101), false],
  ])('%s@ex.org is a link: %s', (local, linked) => {
    const address = `${local}@ex.org`
    expect(urls(`see ${address} now`)).toEqual(linked ? [address] : [])
  })

  test('is found after an @ too far back to belong to it', () => {
    const text = `x @ ${'filler words '.repeat(20)} mail me at a@ex.org or www.ex.org`
    expect(urls(text)).toEqual(['a@ex.org', 'www.ex.org'])
  })
})
