import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import { loadLineCommands, sortLines } from './line-door'
import { SharedDoc } from './shared'

test('a key pressed before the commands land never runs in the note shown by then', async () => {
  let state = EditorState.create({ doc: 'b\na', selection: EditorSelection.cursor(0) })
  const view = {
    get state() {
      return state
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state
    },
  } as unknown as EditorView
  const first = new SharedDoc('b\na')
  const second = new SharedDoc('d\nc')
  first.join(view)
  sortLines(view)
  second.join(view)
  await loadLineCommands()
  expect(state.doc.toString()).toBe('d\nc')
  expect(first.text.toString()).toBe('b\na')
})
