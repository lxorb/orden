import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { turnBlocksInto } from './commands'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function turnedIntoTasks(doc: string, from: string, to: string): string {
  const at = doc.indexOf(from)
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(at, doc.indexOf(to)),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = parsed(state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView
  turnBlocksInto(view, at, 'task')
  return state.doc.toString()
}
describe('Turn into task over blocks that hold a ticked task', () => {
  test('a ticked task stays ticked', () => {
    expect(turnedIntoTasks('- [x] done\n- plain\n', 'done', 'plain')).toBe('- [x] done\n- [ ] plain\n')
  })
  test('a ticked task on its own stays ticked', () => {
    expect(turnedIntoTasks('- [x] done\n', 'done', 'done')).toBe('- [x] done\n')
  })
})
