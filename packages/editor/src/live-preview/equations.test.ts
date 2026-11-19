import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { equationsOf, numberEquations } from './blocks'
import { MathWidget, labelOf, prepare } from './render'

const labels = (entries: [string, number][]) => new Map(entries)
function numbered(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), numberEquations.of(true)],
  })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return state
}
describe('equation labels', () => {
  test.each([
    ['E = mc^2 \\label{eq:mass}', 'E = mc^2 '],
    ['\\eqref{missing}', '\\eqref{missing}'],
    ['\\int_0^\\infty e^{-x^2}\\,dx', '\\int_0^\\infty e^{-x^2}\\,dx'],
  ])('%j', (input, wanted) => expect(prepare(input)).toEqual(wanted))
  test('a reference resolves to the number it was given', () => {
    expect(prepare('see \\eqref{eq:mass}', labels([['eq:mass', 3]]))).toBe('see (3)')
  })
  test('the short form works too', () => {
    expect(prepare('\\ref{one}', labels([['one', 1]]))).toBe('(1)')
  })
  test('an unknown reference is left as written', () => {
    expect(prepare('\\eqref{missing}')).toBe('\\eqref{missing}')
  })
  test('equations without a label have none', () => {
    expect(labelOf('E = mc^2')).toBeUndefined()
    expect(labelOf('x \\label{a}')).toBe('a')
  })
  test('ordinary maths passes through untouched', () => {
    expect(prepare('\\int_0^\\infty e^{-x^2}\\,dx')).toBe('\\int_0^\\infty e^{-x^2}\\,dx')
  })
  test('labels belong to their own note', () => {
    const one = numbered('$$\nx \\label{a}\n$$\n')
    const other = numbered('$$\ny\n$$\n\n$$\nx \\label{a}\n$$\n')
    expect(equationsOf(one).labels.get('a')).toBe(1)
    expect(equationsOf(other).labels.get('a')).toBe(2)
    expect(equationsOf(one).labels.get('a')).toBe(1)
  })
  test('a reference redraws when the equation it points at is renumbered', () => {
    const before = numbered('$$\nx \\label{a}\n$$\n\nsee $\\eqref{a}$\n')
    const after = numbered('$$\ny\n$$\n\n$$\nx \\label{a}\n$$\n\nsee $\\eqref{a}$\n')
    const was = new MathWidget('\\eqref{a}', false, undefined, equationsOf(before).labels)
    const now = new MathWidget('\\eqref{a}', false, undefined, equationsOf(after).labels)
    expect(now.eq(was)).toBe(false)
  })
})
