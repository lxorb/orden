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
function pressed(doc: string, picked: string, tone: number | null = null): string {
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
describe('highlight pressed over highlighted items picked inside their marks', () => {
  test('takes the highlight off both items instead of writing four equals signs', () => {
    expect(pressed('- ==alpha==\n- ==beta==', 'alpha==\n- ==beta')).toBe('- alpha\n- beta')
  })
})
describe('highlight pressed over items only some of which are highlighted', () => {
  test('a highlighted first item is not given a second pair of marks', () => {
    expect(pressed('- ==alpha==\n- beta', 'alpha==\n- beta')).toBe('- ==alpha==\n- ==beta==')
  })
  test('a whole highlighted item picked with its marks is not given a second pair', () => {
    expect(pressed('- alpha\n- ==beta==', 'alpha\n- ==beta==')).toBe('- ==alpha==\n- ==beta==')
  })
  test('a coloured highlighted item does not get its colour written twice', () => {
    expect(pressed('- ==🔴 alpha==\n- beta', '==🔴 alpha==\n- beta', 1)).not.toContain('====')
  })
})
