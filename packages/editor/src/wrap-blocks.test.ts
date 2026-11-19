import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { beforeAll, describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { toggleWrap } from './commands'
import { highlightSelection, setHighlightColour } from './highlight'
import { loadLineCommands } from './line-door'
import { highlightTone } from '@orden/markdown/highlights'

beforeAll(async () => {
  await loadLineCommands()
  setHighlightColour(highlightTone(null))
})
function ran(command: StateCommand, doc: string, from: number, to: number): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}
describe('a whole line picked, as a triple click picks it', () => {
  test('bold on a heading line bolds its words and keeps the heading', () => {
    expect(ran(toggleWrap('**'), '# Title\nnext', 0, 8)).toBe('# **Title**\nnext')
  })
  test('bold on a list item line bolds its words and keeps the item', () => {
    expect(ran(toggleWrap('**'), '- item\n- two', 0, 7)).toBe('- **item**\n- two')
  })
  test('strikethrough on a task line keeps the task', () => {
    expect(ran(toggleWrap('~~'), '- [ ] task\nx', 0, 11)).toBe('- [ ] ~~task~~\nx')
  })
  test('highlight on a heading line keeps the heading and its line break', () => {
    expect(ran(highlightSelection, '# Title\nnext', 0, 8)).toBe('# ==Title==\nnext')
  })
})
describe('highlight over several lines', () => {
  test('goes inside each item, as bold does, and keeps the list', () => {
    expect(ran(toggleWrap('**'), '- a\n- b', 0, 7)).toBe('- **a**\n- **b**')
    expect(ran(highlightSelection, '- a\n- b', 0, 7)).toBe('- ==a==\n- ==b==')
  })
  test('goes on each paragraph, since a highlight ends with its block', () => {
    expect(ran(highlightSelection, 'a\n\nb', 0, 4)).toBe('==a==\n\n==b==')
  })
})
