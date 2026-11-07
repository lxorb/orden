import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree, type LanguageSupport, LRLanguage } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { IterMode, type Tree, TreeFragment } from '@lezer/common'
import { parser as javascript } from '@lezer/javascript'
import { MarkdownParser } from '@lezer/markdown'
import { htmlGrammar } from '@orden/lang-html'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { nibMarkdownExtensions } from './extensions'

const js = LRLanguage.define({ parser: javascript })

let extensions: LanguageSupport

const BIG = 20_000

function countBigParses(): { count: () => number } {
  const original = Object.getOwnPropertyDescriptor(MarkdownParser.prototype, 'parseInline')
    ?.value as MarkdownParser['parseInline']
  let calls = 0
  let late = 0
  const now = Date.now.bind(Date)
  vi.spyOn(Date, 'now').mockImplementation(() => now() + late)
  vi.spyOn(MarkdownParser.prototype, 'parseInline').mockImplementation(function (
    this: MarkdownParser,
    text,
    offset,
  ) {
    const result = original.call(this, text, offset)
    if (text.length > BIG) {
      calls++
      late += 1000
    }
    return result
  })
  return { count: () => calls }
}

beforeAll(async () => {
  const grammar = await htmlGrammar()
  extensions = markdown({
    base: markdownLanguage,
    codeLanguages: () => js,
    extensions: nibMarkdownExtensions,
    htmlTagLanguage: grammar.html({ matchClosingTags: false }),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function shape(tree: Tree): string {
  const out: string[] = []
  tree.iterate({
    mode: IterMode.IgnoreMounts,
    enter: (node) => void out.push(`${node.name} ${node.from}-${node.to}`),
  })
  return out.join('\n')
}

function innerAt(state: EditorState, tree: Tree, needle: string): string {
  const at = state.doc.toString().lastIndexOf(needle) + 1
  return tree.resolveInner(at, 1).name
}

function paragraph(lines: number, tags: boolean): string {
  return Array.from(
    { length: lines },
    (_, i) => `word ${i} and *more* \`x\` text${tags && i % 50 === 7 ? ` <b>t${i}</b>` : ''} here`,
  ).join('\n')
}

const cases = {
  'in the middle, with tags': (body: string) =>
    '```js\nlet first = 1\n```\n\n' + body + '\n\n```js\nlet second = 2\n```\n\nend\n',
  'at the end': (body: string) => '```js\nlet first = 1\n```\n\n' + body + '\n',
}

describe('a long paragraph typed into', () => {
  for (const [name, wrap] of Object.entries(cases)) {
    test(`is read once per key when it is ${name}`, () => {
      const doc = wrap(paragraph(1500, name.includes('tags')))
      let state = EditorState.create({ doc, extensions })
      expect(ensureSyntaxTree(state, state.doc.length, 1e9)).not.toBeNull()
      const parses = countBigParses()

      const at = doc.indexOf('word 700 ') + 4
      for (let key = 0; key < 4; key++) {
        state = state.update({ changes: { from: at + key, insert: 'q' } }).state
        const tree = ensureSyntaxTree(state, state.doc.length, 1e9)
        expect(tree).not.toBeNull()
        expect(parses.count()).toBe(key + 1)
      }

      const tree = ensureSyntaxTree(state, state.doc.length, 1e9)!
      const fresh = (markdownLanguage.parser as MarkdownParser)
        .configure(nibMarkdownExtensions)
        .parse(state.doc.toString())
      expect(shape(tree)).toBe(shape(fresh))
      expect(innerAt(state, tree, 'first')).toBe('VariableDefinition')
      if (doc.includes('second')) expect(innerAt(state, tree, 'second')).toBe('VariableDefinition')
      if (doc.includes('<b>')) expect(innerAt(state, tree, '<b>t1457')).toBe('TagName')
    })
  }
})

describe('a long paragraph parsed again after an edit', () => {
  function reparse(lines: number): number {
    const parser = extensions.language.parser
    const doc = `# P\n\n${paragraph(lines, false)}\n\nend\n`
    const tree = parser.parse(doc)
    const at = doc.indexOf(`word ${lines >> 1} `)
    const next = doc.slice(0, at) + 'q' + doc.slice(at)
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
      { fromA: at, toA: at, fromB: at, toB: at + 1 },
    ])
    let best = Infinity
    for (let round = 0; round < 3; round++) {
      const start = performance.now()
      parser.parse(next, fragments)
      best = Math.min(best, performance.now() - start)
    }
    return best
  }

  test('takes time in proportion to its length', () => {
    reparse(1000)
    const short = reparse(1000)
    const long = reparse(8000)
    expect(long / short).toBeLessThan(14)
  })
})
