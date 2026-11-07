import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../scripts/growth'
import { lexMarkdown, renderMarkdown } from './index'
import { isTagName, opensTag, tagAt, tagNameAt } from './tags'

function drawn(source: string, options: Parameters<typeof renderMarkdown>[1] = {}): string[] {
  const html = renderMarkdown(source, options)
  return [...html.matchAll(/class="tag"[^>]*data-tag="([^"]*)"/g)].map((found) => found[1] ?? '')
}

describe('what a tag is', () => {
  test('a letter after the hash, then letters, digits and the joining three', () => {
    expect(tagNameAt('#work', 0)).toBe('work')
    expect(tagNameAt('#work/orden-2_b, then', 0)).toBe('work/orden-2_b')
    expect(tagNameAt('#Überblick', 0)).toBe('Überblick')
    expect(tagNameAt('#日本語', 0)).toBe('日本語')
  })

  test('marks and emoji are in a name, which is never all digits', () => {
    expect(tagNameAt('#हिन्दी', 0)).toBe('हिन्दी')
    expect(tagNameAt('#กิน', 0)).toBe('กิน')
    expect(tagNameAt('#café', 0)).toBe('café')
    expect(tagNameAt('#tag👍', 0)).toBe('tag👍')
    expect(tagNameAt('#2024-review', 0)).toBe('2024-review')
    expect(tagNameAt('#2024', 0)).toBeNull()
  })

  test('not a number, not a heading, not a bare hash', () => {
    expect(tagNameAt('#42', 0)).toBeNull()
    expect(tagNameAt('# Heading', 0)).toBeNull()
    expect(tagNameAt('#', 0)).toBeNull()
    expect(tagNameAt('work', 0)).toBeNull()
  })

  test('only where a word opens', () => {
    expect(opensTag('')).toBe(true)
    expect(opensTag(' ')).toBe(true)
    expect(opensTag('\n')).toBe(true)
    expect(opensTag('(')).toBe(true)
    expect(opensTag('C')).toBe(false)
    expect(opensTag('/')).toBe(false)
  })

  test('and inside emphasis, strike, highlight or a cell', () => {
    for (const before of ['*', '_', '~~', '==', 'x **', '(**']) expect(opensTag(before)).toBe(true)
  })

  test('but a mark in the middle of a word opens nothing', () => {
    for (const before of ['a*', 'a=', 'color=', 'snake_', '3*', 'a~', 'a|', '?q=', 'Note|']) {
      expect(opensTag(before)).toBe(false)
    }
  })

  test('but not as the target of a link, which is a heading in the note', () => {
    expect(opensTag('](')).toBe(false)
    expect(opensTag(' (')).toBe(true)
  })
})

const PARITY: [string, string[]][] = [
  ['see https://x.test/?q=#x', []],
  ['[link](https://x.test/?q=#x)', []],
  ['<https://x.test/#a> <https://x.test/?a=#b>', []],
  ['plain a|#b text', []],
  ['code-ish a=#b prose and color=#ff8800', []],
  ['snake_#x 3*#y a~#z', []],
  ['[[Note|#alias]]', []],
  ['[s](#setup) ![i](#img) and [s](#open', []],
  ['**#a** ~~#d~~ ==#e== x **#f**', ['a', 'd', 'e', 'f']],
  ['_#u_ and __#todo__ and _#snake_case_', ['u', 'todo', 'snake_case']],
  ['| x | y |\n| - | - |\n|#f|#g|', ['f', 'g']],
]

describe('a tag on a page', () => {
  test('is drawn as a tag, the hash with it', () => {
    expect(renderMarkdown('Filed under #work.')).toBe(
      '<p>Filed under <span class="tag" data-tag="work">#work</span>.</p>\n',
    )
  })

  test('nested is one tag', () => {
    expect(drawn('Under #work/orden/canvas today')).toEqual(['work/orden/canvas'])
  })

  test('opening a paragraph, a heading, an item, a cell and a bracket', () => {
    expect(drawn('#first words')).toEqual(['first'])
    expect(drawn('## A heading #in-it')).toEqual(['in-it'])
    expect(drawn('- #item\n- two')).toEqual(['item'])
    expect(drawn('| a |\n| - |\n| #cell |')).toEqual(['cell'])
    expect(drawn('words (#aside) more')).toEqual(['aside'])
  })

  test('inside emphasis, strike, highlight or a cell, and never as a link target', () => {
    expect(drawn('**#a** *#b* ~~#d~~ ==#e== call')).toEqual(['a', 'b', 'd', 'e'])
    expect(drawn('| x | y |\n| - | - |\n|#f|#g|')).toEqual(['f', 'g'])
    expect(drawn('See [setup](#setup) and ![x](#y). Real #setup.')).toEqual(['setup'])
  })

  test('alike on the page and in the index, row by row', () => {
    for (const [source, tags] of PARITY) expect(drawn(source), source).toEqual(tags)
  })

  test('left alone in code, maths, addresses, links, headings and mid-word', () => {
    expect(drawn('`#code` and\n\n```\n#fenced\n```')).toEqual([])
    expect(drawn('$#x$')).toEqual([])
    expect(drawn('https://orden.dev/#top and <https://orden.dev/#also>')).toEqual([])
    expect(drawn('[see #this](https://orden.dev) and [[Note#Heading]]')).toEqual([])
    expect(drawn('# Heading\n\nC#sharp and a#b')).toEqual([])
    expect(drawn('#42 and \\#escaped')).toEqual([])
  })

  test('a link on a surface that says where one goes, and words everywhere else', () => {
    const html = renderMarkdown('A #work/orden tag', { tagHref: (tag) => `#tag:${tag}` })

    expect(html).toContain(
      '<a class="tag" href="#tag:work/orden" data-tag="work/orden">#work/orden</a>',
    )
    expect(renderMarkdown('A #work tag', { escapeHtml: true })).toContain(
      '<span class="tag" data-tag="work">#work</span>',
    )
  })

  test('says its words to a reader of the tokens that has never heard of a tag', () => {
    const [paragraph] = lexMarkdown('Filed #work')
    const inline = (paragraph as { tokens?: { type: string; text?: string }[] }).tokens ?? []

    expect(inline.map((one) => [one.type, one.text])).toEqual([
      ['text', 'Filed '],
      ['hashtag', '#work'],
    ])
  })
})

describe('a name a tag can be renamed to', () => {
  test.each(['work', 'work/orden', 'a-b', 'a_b', 'Größe', '2024/q1', 'x2024'])(
    '%s is one',
    (name) => {
      expect(isTagName(name)).toBe(true)
    },
  )

  test.each(['2024', 'a.b', 'a,b', 'a!', 'a b', '', '#a', '/a', 'foo/', 'a//b'])(
    '%j is none',
    (name) => {
      expect(isTagName(name)).toBe(false)
    },
  )
})

describe('a long line of a table', () => {
  test('is read for tags in time that grows with its length', () => {
    const read = (count: number) => {
      const text = `| ${'|#a '.repeat(count)}\n${'|#b'.repeat(count)}`
      for (let at = text.indexOf('#'); at !== -1; at = text.indexOf('#', at + 1)) tagAt(text, at)
    }
    expect(growth(read, 4_000)).toBeLessThan(GROWS_AT_MOST)
  }, 60_000)

  test('still tells a row from a line that only holds a bar', () => {
    expect(tagAt('| x |#a', 5)).toBe('a')
    expect(tagAt('  | x |#a', 7)).toBe('a')
    expect(tagAt('x |#a', 3)).toBeNull()
    expect(tagAt('| x\nx |#a', 7)).toBeNull()
    expect(tagAt('x\n| y |#a', 7)).toBe('a')
  })
})
