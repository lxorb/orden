import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import {
  EditorSelection,
  EditorState,
  type StateCommand,
  type Transaction,
} from '@codemirror/state'
import { highlightTone } from '@nib/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { highlightSelection, setHighlightColour, toggleHighlight } from './highlight'

const PLAIN = highlightTone(null)
const RED = highlightTone(1)
const GREEN = highlightTone(4)

/** A document with the selection written into it: `[` and `]` are its ends. */
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
  test('writes the colour the way Obsidian writes it', () => {
    expect(run(toggleHighlight(RED), 'be [careful] here')).toBe('be ==🔴 careful== here')
  })

  test('writes no colour at all for the plain one, which is what it always wrote', () => {
    expect(run(toggleHighlight(PLAIN), 'be [careful] here')).toBe('be ==careful== here')
  })

  test('takes the highlight off when the same colour is asked for again', () => {
    expect(run(toggleHighlight(RED), 'be ==🔴 [careful]== here')).toBe('be careful here')
    expect(run(toggleHighlight(PLAIN), 'be ==[careful]== here')).toBe('be careful here')
  })

  test('changes the colour rather than nesting a second highlight inside one', () => {
    expect(run(toggleHighlight(GREEN), 'be ==🔴 [careful]== here')).toBe('be ==🟢 careful== here')
  })

  test('takes the colour off a highlight asked for the plain one', () => {
    expect(run(toggleHighlight(PLAIN), 'be ==🔴 [careful]== here')).toBe('be ==careful== here')
  })

  test('colours a highlight that had none', () => {
    expect(run(toggleHighlight(RED), 'be ==[careful]== here')).toBe('be ==🔴 careful== here')
  })

  test('reads the marks whether they are inside the selection or outside it', () => {
    expect(run(toggleHighlight(RED), 'be [==careful==] here')).toBe('be ==🔴 careful== here')
  })
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
