import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { buildDecorations } from './decorate'
import { quietMarks } from './reveal'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

const decorated = (doc: string, cursor: number, quiet: boolean) =>
  buildDecorations(
    parsed(
      EditorState.create({
        doc,
        selection: EditorSelection.cursor(cursor),
        extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), quietMarks.of(quiet)],
      }),
    ),
  )

function lineClasses(doc: string, cursor: number, quiet: boolean): string[] {
  const out: string[] = []
  decorated(doc, cursor, quiet).decorations.between(0, doc.length, (_from, _to, value) => {
    const spec = value.spec as { class?: string }
    if (spec.class) out.push(spec.class)
  })
  return out
}

function concealed(doc: string, cursor: number, quiet: boolean): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), quietMarks.of(quiet)],
    }),
  )
  const out: string[] = []
  buildDecorations(state).atomic.between(0, doc.length, (from, to) => {
    out.push(doc.slice(from, to))
  })
  return out
}

describe('quiet marks', () => {
  test.each([
    ['a **bold** b', [], 5, false],
    ['a **bold** b', ['**', '**'], 5, true],
    ['# Title', [], 4, false],
    ['# Title', ['# '], 4, true],
  ])('%j', (input, wanted, extra, last) => expect(concealed(input, extra, last)).toEqual(wanted))

  test('a # becomes a heading only once a space follows it', () => {
    for (const quiet of [true, false]) {
      expect(concealed('#', 1, quiet)).toEqual([])
      expect(lineClasses('#', 1, quiet)).not.toContain('orden-h1')
      expect(concealed('###', 3, quiet)).toEqual([])
      expect(lineClasses('###', 3, quiet)).not.toContain('orden-h3')
      expect(lineClasses('# ', 2, quiet)).toContain('orden-h1')
    }
    expect(concealed('# ', 2, true)).toEqual(['# '])
    expect(concealed('a\n#', 0, false)).toEqual([])
  })

  test('a list mark becomes a bullet only once a space follows it', () => {
    for (const quiet of [true, false]) {
      expect(concealed('-', 1, quiet)).toEqual([])
      expect(concealed('a\n\n-', 0, quiet)).toEqual([])
      expect(concealed('a\n\n- ', 0, quiet)).toEqual(['-'])
    }
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
})
