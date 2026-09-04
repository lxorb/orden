import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { findLigatures, ligaturesIn } from './ligatures'
import { nibMarkdownExtensions } from './markdown/extensions'

/** Somewhere to park the caret that is outside every run under test. */
const PARK = '\n\nx'

function state(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage, extensions: nibMarkdownExtensions })],
  })
}

/** What is shown as a glyph, as `text→glyph`, with the caret parked off the
 *  sample unless a position is given. */
function shown(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  return ligaturesIn(state(full, cursor ?? full.length)).map(
    (one) => `${full.slice(one.from, one.to)}${one.glyph}`,
  )
}

describe('finding runs', () => {
  test('finds each run where it is', () => {
    expect(findLigatures('a -> b', 10)).toEqual([{ from: 12, to: 14, glyph: '→' }])
  })

  test('takes the longest run', () => {
    expect(findLigatures('<-->').map((one) => one.glyph)).toEqual(['⟷'])
    expect(findLigatures('<=>').map((one) => one.glyph)).toEqual(['⇔'])
    expect(findLigatures('<==>').map((one) => one.glyph)).toEqual(['⟺'])
  })

  test('knows the comparisons and the ellipsis', () => {
    expect(findLigatures('a <= b >= c != d ... e').map((one) => one.glyph)).toEqual(['≤', '≥', '≠', '…'])
  })

  test('leaves what it has no glyph for', () => {
    expect(findLigatures('a -- b == c > d')).toEqual([])
  })
})

describe('what is shown', () => {
  test('a run in prose', () => {
    expect(shown('a -> b')).toEqual(['->→'])
  })

  test('a run in code', () => {
    expect(shown('```\na->b\n```')).toEqual(['->→'])
    expect(shown('`x <= y`')).toEqual(['<=≤'])
  })

  test('the run under the caret reads as typed', () => {
    expect(shown('a -> b', 3)).toEqual([])
    // At either end the caret is beside the run, not in it.
    expect(shown('a -> b', 2)).toEqual(['->→'])
    expect(shown('a -> b', 4)).toEqual(['->→'])
  })

  test('a selection over the run reads as typed', () => {
    const full = 'a -> b' + PARK
    const selected = state(full, 0).update({ selection: EditorSelection.range(1, 3) }).state
    expect(ligaturesIn(selected)).toEqual([])
  })

  test('a quote mark is not the start of a sign', () => {
    expect(shown('>= 1')).toEqual([])
  })

  test('a highlight mark is not the start of an arrow', () => {
    expect(shown('==>a==')).toEqual([])
  })

  test('a comment keeps its closing', () => {
    expect(shown('<!-- a -->')).toEqual([])
    expect(shown('text\n\n<!-- a -->\n\nmore')).toEqual([])
  })

  test('an address is left alone', () => {
    expect(shown('[x](http://a.b/->c)')).toEqual([])
    expect(shown('<http://a.b/->c>')).toEqual([])
  })

  test('maths is left alone', () => {
    expect(shown('$a <= b$')).toEqual([])
  })
})
