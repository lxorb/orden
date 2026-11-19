import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { highlightTone } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { toggleHighlight } from './highlight'
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

function pressed(command: ReturnType<typeof toggleHighlight>, state: EditorState): EditorState {
  let next = state
  command({ state, dispatch: (one: Transaction) => (next = parsed(one.state)) })
  return next
}

function typed(state: EditorState, words: string): EditorState {
  const at = state.selection.main.head
  return parsed(state.update({ changes: { from: at, insert: words }, selection: { anchor: at + words.length } }).state)
}

describe('highlight pressed, words typed, highlight pressed again', () => {
  test('keeps the typed words highlighted and steps the caret out, as bold does', () => {
    const highlight = toggleHighlight(highlightTone(null))
    let state = stateOf('Note: ', 6)
    state = pressed(highlight, state)
    state = typed(state, 'important')
    state = pressed(highlight, state)
    expect(state.doc.toString()).toBe('Note: ==important==')
  })

  test('and a coloured one keeps its colour on the typed words', () => {
    const highlight = toggleHighlight(highlightTone(1))
    let state = stateOf('Note: ', 6)
    state = pressed(highlight, state)
    state = typed(state, 'important')
    state = pressed(highlight, state)
    expect(state.doc.toString()).toBe('Note: ==🔴 important==')
  })
})
