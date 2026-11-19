import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { beforeAll, describe, expect, test } from 'vitest'
import { completionExtensions, loadCompletion } from './completion'
import { loadLineCommands } from './line-door'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { modeExtensions } from './modes'
import { parsed } from '../test/parsed'

beforeAll(async () => {
  await loadCompletion()
  await loadLineCommands()
})
function typedOver(doc: string, character: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        modeExtensions(),
        completionExtensions(),
      ],
    }),
  )
  const view = {
    get state() {
      return state
    },
    compositionStarted: false,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView
  const { from, to } = state.selection.main
  for (const handler of state.facet(EditorView.inputHandler)) {
    if (handler(view, from, to, character, () => state.update({}))) return state.doc.toString()
  }
  return state.update({ changes: { from, to, insert: character } }).state.doc.toString()
}
describe('a mark typed over several italic paragraphs', () => {
  test('a typed star adds a star on each, as it does on one paragraph', () => {
    expect(typedOver('*one*', '*')).toBe('**one**')
    expect(typedOver('*one*\n\n*two*', '*')).toBe('**one**\n\n**two**')
  })
})
