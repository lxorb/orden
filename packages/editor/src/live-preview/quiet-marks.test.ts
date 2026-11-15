import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { buildDecorations } from './decorate'
import { quietMarks } from './reveal'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function written(doc: string, cursor: number, quiet: boolean) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        quietMarks.of(quiet),
      ],
    }),
  )
}

function concealed(doc: string, cursor: number, quiet: boolean): string[] {
  const out: string[] = []
  buildDecorations(written(doc, cursor, quiet)).atomic.between(0, doc.length, (from, to) => {
    out.push(doc.slice(from, to))
  })
  return out
}

function lineClasses(doc: string, cursor: number, quiet: boolean): string[] {
  const out: string[] = []
  buildDecorations(written(doc, cursor, quiet)).decorations.between(
    0,
    doc.length,
    (_from, _to, value) => {
      const name: unknown = value.spec.class
      if (typeof name === 'string') out.push(...name.split(' '))
    },
  )
  return out
}

describe('quiet marks', () => {
  test('bold keeps its stars hidden with the caret inside it', () => {
    const doc = 'a **bold** b'
    expect(concealed(doc, 5, false)).toEqual([])
    expect(concealed(doc, 5, true)).toEqual(['**', '**'])
  })

  test('a heading keeps its # hidden on its own line', () => {
    const doc = '# Title'
    expect(concealed(doc, 4, false)).toEqual([])
    expect(concealed(doc, 4, true)).toEqual(['# '])
  })

  test('inline code hides its backticks, a fence does not', () => {
    expect(concealed('a `x` b', 3, true)).toEqual(['`', '`'])
    const fence = '```js\nx\n```'
    expect(concealed(fence, 7, true)).toEqual([])
  })

  test('a link still opens its target under the caret', () => {
    const doc = '[label](https://example.com)'
    expect(concealed(doc, 3, true)).toEqual([])
  })

  test('a # with nothing after it is no heading yet, so it does not grow and vanish while typed (#2089)', () => {
    for (const quiet of [true, false]) {
      for (const doc of ['#', '###', '######', '- ##', '> #']) {
        const level = doc.replace(/[^#]/g, '').length
        expect(concealed(doc, doc.length, quiet), doc).not.toContain('#'.repeat(level))
        expect(lineClasses(doc, doc.length, quiet), doc).not.toContain(`orden-h${level}`)
      }
    }
  })

  test('a # becomes a heading once a space follows it (#2089)', () => {
    expect(lineClasses('# ', 2, true)).toContain('orden-h1')
    expect(concealed('# ', 2, true)).toEqual(['# '])
    expect(lineClasses('## T', 4, true)).toContain('orden-h2')
    expect(lineClasses('- ## ', 5, true)).toContain('orden-h2')
  })
})
