import { frontMatterBlock } from '@orden/markdown/front-matter'
import { describe, expect, test } from 'vitest'
import { isMap, parseDocument, stringify } from 'yaml'
import corpus from './front-matter-corpus.json'
import { noteValues } from './note-values'

function rng(seed: number) {
  let s = seed
  return (n: number) => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) % n
  }
}

const KEYS = [
  'title',
  'due date',
  'Priorität',
  'a.b',
  'R&D',
  'Size (cm)',
  '日期',
  'x-y',
  'n1',
  '"q k"',
]
const WORDS = [
  'word',
  "don't",
  '"quoted"',
  '[open',
  'a: b',
  '# hash',
  '- item',
  '---',
  '{',
  'x]',
  '|',
  '> y',
]

function words(r: (n: number) => number): string {
  const out: string[] = []
  for (let at = 1 + r(4); at > 0; at--) out.push(WORDS[r(WORDS.length)] ?? '')
  return out.join(' ')
}

function value(r: (n: number) => number): unknown {
  switch (r(9)) {
    case 0:
      return r(1000)
    case 1:
      return r(2) === 0
    case 2:
      return 'word'
    case 3:
      return words(r)
    case 4:
      return `${words(r)}\n\n${words(r)}\n`
    case 5:
      return [words(r), 'b', r(10)]
    case 6:
      return { inner: words(r), 'other key': [1, 2] }
    case 7:
      return [{ a: words(r), b: `${words(r)}\n${words(r)}` }]
    default:
      return null
  }
}

function mapping(r: (n: number) => number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (let at = 1 + r(5); at > 0; at--) {
    out[(KEYS[r(KEYS.length)] ?? '').replaceAll('"', '')] = value(r)
  }
  return out
}

function spelled(r: (n: number) => number, map: Record<string, unknown>, style?: 'block'): string {
  return stringify(map, {
    indentSeq: r(2) === 0,
    collectionStyle: style ?? (['any', 'block', 'flow'] as const)[r(3)] ?? 'any',
    lineWidth: [0, 20, 80][r(3)] ?? 0,
    defaultStringType:
      (['PLAIN', 'QUOTE_DOUBLE', 'QUOTE_SINGLE', 'BLOCK_LITERAL', 'BLOCK_FOLDED'] as const)[r(5)] ??
      'PLAIN',
    aliasDuplicateObjects: false,
  })
}

function reads(body: string): boolean {
  const doc = parseDocument(body)
  return doc.errors.length === 0 && isMap(doc.contents)
}

const HELD_BACK = new Set([`---\n${'k'.repeat(1100)}: 2\n---\nrest`])

describe('the corpus of what real tools write', () => {
  test.each(corpus)('%j', (note) => {
    const body = note.slice(4, note.lastIndexOf('---\nrest'))
    if (!reads(body) || HELD_BACK.has(note)) return
    expect(frontMatterBlock(note)?.close).toBe(4 + body.length)
  })
})

describe('a note saved in the middle of a key', () => {
  test('keeps its block and every value the other lines say', () => {
    const note = '---\nstatus: done\ntitle: x\nsta\n---\n# Note\n'
    expect(frontMatterBlock(note)).not.toBeNull()
    expect(noteValues(note)).toMatchObject({ status: 'done', title: 'x' })
  })
})

describe('front matter against the YAML library', () => {
  test('whatever YAML reads as a mapping is a block, and closes where it does', () => {
    const r = rng(7)
    let held = 0
    for (let at = 0; at < 6000; at++) {
      const body = spelled(r, mapping(r))
      if (!reads(body)) continue
      held++
      const note = `---\n${body}---\nrest`
      expect(frontMatterBlock(note)?.close, note).toBe(`---\n${body}`.length)
    }
    expect(held).toBeGreaterThan(5000)
  })

  test('a line of prose at the margin takes a block away', () => {
    const r = rng(11)
    const PROSE = [
      'prose words',
      'A sentence without a colon.',
      'word',
      '## Section',
      '> quoted',
      '* item',
    ]
    let held = 0
    for (let at = 0; at < 6000; at++) {
      const keys = Object.entries(mapping(r)).map(([key, one]) =>
        spelled(r, { [key]: one }, 'block'),
      )
      keys.splice(r(keys.length + 1), 0, `\n${PROSE[r(PROSE.length)] ?? ''}\n\n`)
      const body = keys.join('')
      if (reads(body)) continue
      held++
      const block = frontMatterBlock(`---\n${body}---\nrest`)
      expect(block, body).toBeNull()
    }
    expect(held).toBeGreaterThan(3000)
  })
})
