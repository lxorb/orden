import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { findLigatures, ligaturesIn } from './ligatures'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

const PARK = '\n\nx'
function state(doc: string, cursor: number) {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursor),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
function shown(doc: string, cursor?: number): string[] {
  const full = cursor === undefined ? doc + PARK : doc
  return ligaturesIn(state(full, cursor ?? full.length)).map((one) => `${full.slice(one.from, one.to)}${one.glyph}`)
}
function shownInCode(doc: string): string[] {
  const full = doc + PARK
  return ligaturesIn(state(full, full.length), undefined, 'code').map(
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
  test.each([
    ['a -> b', ['->→']],
    ['```\na->b\n```', ['->→']],
    ['`x <= y`', ['<=≤']],
    ['>= 1', []],
    ['==>a==', []],
    ['<!-- a -->', []],
    ['text\n\n<!-- a -->\n\nmore', []],
    ['[x](http://a.b/->c)', []],
    ['<http://a.b/->c>', []],
    ['$a <= b$', []],
  ])('%j', (input, wanted) => expect(shown(input)).toEqual(wanted))
  test.each([
    ['a -> b', [], 3],
    ['a -> b', ['->→'], 2],
    ['a -> b', ['->→'], 4],
  ])('%j', (input, wanted, extra) => expect(shown(input, extra)).toEqual(wanted))
  test('a selection over the run reads as typed', () => {
    const full = 'a -> b' + PARK
    const selected = state(full, 0).update({ selection: EditorSelection.range(1, 3) }).state
    expect(ligaturesIn(selected)).toEqual([])
  })
})
describe('the code scope', () => {
  test.each([
    [['```', 'a->b', '```'].join('\n'), ['->→']],
    ['`x <= y`', ['<=≤']],
    [['```js', 'const f = (a) => a', '```'].join('\n'), ['=>⇒']],
    ['a -> b', []],
    ['a **b -> c** d', []],
    ['walk `a -> b` then a -> b', ['->→']],
  ])('%j', (input, wanted) => expect(shownInCode(input)).toEqual(wanted))
})
