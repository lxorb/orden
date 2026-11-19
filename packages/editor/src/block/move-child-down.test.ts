import { history } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { moveBlockDown, moveBlockUp } from './commands'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { parsed } from '../../test/parsed'

function viewOf(doc: string, caret: number) {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), history()],
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
  return view
}
function moved(doc: string, words: string, command: typeof moveBlockDown): string {
  const view = viewOf(doc, doc.indexOf(words) + 2)
  command(view)
  return view.state.doc.toString()
}
describe('Move block down on a block inside a list item', () => {
  test('swaps it with that sibling inside the parent, as Move block up does', () => {
    const doc = '- one\n  - a\n  - b\n- two\n'
    expect(moved('- one\n  - b\n  - a\n- two\n', '- a', moveBlockUp)).toBe(doc)
    expect(moved(doc, '- a', moveBlockDown)).toBe('- one\n  - b\n  - a\n- two\n')
  })
  test('keeps a subtask under its task', () => {
    const doc = '- [ ] Pack\n  - [ ] socks\n  - [ ] shirts\n'
    expect(moved(doc, '- [ ] socks', moveBlockDown)).toBe('- [ ] Pack\n  - [ ] shirts\n  - [ ] socks\n')
  })
  test('keeps a paragraph inside its item when it moves past the item’s last block', () => {
    const doc = '- a\n\n  first words\n\n  second words\n\n- b\n'
    expect(moved('- a\n\n  second words\n\n  first words\n\n- b\n', 'first', moveBlockUp)).toBe(doc)
    expect(moved(doc, 'first', moveBlockDown)).toBe('- a\n\n  second words\n\n  first words\n\n- b\n')
  })
})
