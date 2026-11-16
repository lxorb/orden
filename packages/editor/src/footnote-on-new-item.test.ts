import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { insertFootnote } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function inserted(doc: string, at: number): string {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  let next = state
  insertFootnote({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}

describe('edit29 Insert footnote on a new item at the end of the note', () => {
  test('keeps the bullet a bullet', () => {
    const doc = 'Reading list\n\n- Dune\n- '
    expect(inserted(doc, doc.length)).toBe('Reading list\n\n- Dune\n- [^1]\n\n[^1]: ')
  })

  test('keeps a numbered item numbered', () => {
    const doc = '1. first\n2. '
    expect(inserted(doc, doc.length)).toBe('1. first\n2. [^1]\n\n[^1]: ')
  })

  test('keeps a new task a task', () => {
    const doc = '- [ ] call the bank\n- [ ] '
    expect(inserted(doc, doc.length)).toBe('- [ ] call the bank\n- [ ] [^1]\n\n[^1]: ')
  })
})
