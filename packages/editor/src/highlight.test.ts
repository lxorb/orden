import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { highlightTone } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { highlightSelection, setHighlightColour, toggleHighlight } from './highlight'

const PLAIN = highlightTone(null)
const RED = highlightTone(1)
const GREEN = highlightTone(4)

function run(command: StateCommand, marked: string): string {
  const doc = marked.replace(/[[\]]/g, '')
  const state = EditorState.create({
    doc,
    selection: EditorSelection.range(marked.indexOf('['), marked.indexOf(']') - 1),
    extensions: [markdown({ base: markdownLanguage })],
  })

  let next = state
  command({ state, dispatch: (transaction: Transaction) => (next = transaction.state) })
  return next.doc.toString()
}

describe('highlighting the selection', () => {
  test.each([
    [toggleHighlight(RED), 'be ==🔴 careful== here', 'be [careful] here'],
    [toggleHighlight(PLAIN), 'be ==careful== here', 'be [careful] here'],
    [toggleHighlight(RED), 'be careful here', 'be ==🔴 [careful]== here'],
    [toggleHighlight(PLAIN), 'be careful here', 'be ==[careful]== here'],
    [toggleHighlight(GREEN), 'be ==🟢 careful== here', 'be ==🔴 [careful]== here'],
    [toggleHighlight(PLAIN), 'be ==careful== here', 'be ==🔴 [careful]== here'],
    [toggleHighlight(RED), 'be ==🔴 careful== here', 'be ==[careful]== here'],
    [toggleHighlight(RED), 'be ==🔴 careful== here', 'be [==careful==] here'],
  ])('%j', (input, wanted, extra) => expect(run(input, extra)).toEqual(wanted))
})

describe('the colour that sticks', () => {
  test('is what the shortcut and the bar’s own button write', () => {
    setHighlightColour(GREEN)
    try {
      expect(run(highlightSelection, 'be [careful] here')).toBe('be ==🟢 careful== here')
    } finally {
      setHighlightColour(PLAIN)
    }
  })

  test('is the plain highlight until somebody chooses one', () => {
    expect(run(highlightSelection, 'be [careful] here')).toBe('be ==careful== here')
  })
})
