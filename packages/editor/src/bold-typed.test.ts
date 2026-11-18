import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleWrap } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function pressed(command: ReturnType<typeof toggleWrap>, state: EditorState): EditorState {
  let next = state
  command({ state, dispatch: (one: Transaction) => (next = parsed(one.state)) })
  return next
}

function typed(state: EditorState, words: string): EditorState {
  const at = state.selection.main.head
  return parsed(
    state.update({ changes: { from: at, insert: words }, selection: { anchor: at + words.length } })
      .state,
  )
}

describe('bold pressed, words typed, bold pressed again', () => {
  test('keeps the typed words bold and steps the caret out of the run', () => {
    const bold = toggleWrap('**')
    let state = stateOf('Note: ', 6)
    state = pressed(bold, state)
    state = typed(state, 'important')
    state = pressed(bold, state)
    expect(state.doc.toString()).toBe('Note: **important**')
  })
})
