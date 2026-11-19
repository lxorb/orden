import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { turnBlocksInto } from './commands'
import type { BlockShape } from './shape'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function turned(doc: string, words: string, shape: BlockShape): string {
  const at = doc.indexOf(words) + 1
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec | Transaction) => {
      state = parsed(spec instanceof Transaction ? spec.state : state.update(spec).state)
    },
    focus: () => undefined,
  } as unknown as EditorView
  turnBlocksInto(view, at, shape)
  return state.doc.toString()
}
describe('Turn into from the block menu on a list item with children', () => {
  test('Turn into paragraph keeps a child item an item, as the list button does', () => {
    const doc = '- a\n  - b\n- c\n'
    expect(turned(doc, 'a', 'paragraph')).toMatch(/^[ \t]*- b$/m)
  })
  test('Turn into paragraph on a task keeps its subtask a task', () => {
    const doc = '- [ ] Pack\n  - [ ] socks\n'
    expect(turned(doc, 'Pack', 'paragraph')).toMatch(/^[ \t]*- \[ \] socks$/m)
  })
})
