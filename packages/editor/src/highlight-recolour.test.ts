import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { highlightTone } from '@orden/markdown/highlights'
import { parsed } from '../test/parsed'
import { toggleHighlight } from './highlight'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(async () => {
  await loadLineCommands()
})
function pressed(doc: string, picked: string, tone: number | null): string {
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleHighlight(highlightTone(tone))({
    state,
    dispatch: (one: Transaction) => (state = one.state),
  })
  return state.doc.toString()
}
describe('another colour picked over one highlighted line', () => {
  test('recolours the highlight', () => {
    expect(pressed('- ==🔴 alpha==', '==🔴 alpha==', 5)).toBe('- ==🔵 alpha==')
  })
})
describe('another colour picked over several highlighted lines', () => {
  test('recolours red items blue instead of taking their highlight off', () => {
    const doc = '- ==🔴 alpha==\n- ==🔴 beta=='
    expect(pressed(doc, '==🔴 alpha==\n- ==🔴 beta==', 5)).toBe('- ==🔵 alpha==\n- ==🔵 beta==')
  })
  test('gives plain highlighted paragraphs the picked colour instead of taking it off', () => {
    const doc = '==alpha==\n\n==beta=='
    expect(pressed(doc, doc, 1)).toBe('==🔴 alpha==\n\n==🔴 beta==')
  })
  test('the same colour still takes the highlight off', () => {
    const doc = '- ==🔴 alpha==\n- ==🔴 beta=='
    expect(pressed(doc, '==🔴 alpha==\n- ==🔴 beta==', 1)).toBe('- alpha\n- beta')
  })
})
