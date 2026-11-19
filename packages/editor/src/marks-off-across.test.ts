import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'

beforeAll(async () => {
  await loadLineCommands()
})
function pressed(mark: string, doc: string, picked: string): EditorState {
  const from = doc.indexOf(picked)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, from + picked.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  toggleWrap(mark)({ state, dispatch: (one: Transaction) => (state = one.state) })
  return parsed(state)
}
describe('a mark pressed over the words of marked lines picked inside their marks', () => {
  test('bold takes the bold off two bold items', () => {
    expect(pressed('**', '- **alpha**\n- **beta**', 'alpha**\n- **beta').doc.toString()).toBe('- alpha\n- beta')
  })
  test('italic takes the italics off two italic items instead of making them bold', () => {
    expect(pressed('*', '- *alpha*\n- *beta*', 'alpha*\n- *beta').doc.toString()).toBe('- alpha\n- beta')
  })
  test('bold takes the bold off one bold paragraph written over two lines', () => {
    expect(pressed('**', '**alpha\nbeta**', 'alpha\nbeta').doc.toString()).toBe('alpha\nbeta')
  })
})
