import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { indentItems, outdentItems } from './list-keys'

function pressed(command: StateCommand, doc: string, words: string): string {
  let next = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf(words) + words.length),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  )
  command({ state: next, dispatch: (made: Transaction) => (next = made.state) })
  return next.doc.toString()
}

describe('Tab and Shift-Tab on a list item that holds a quote', () => {
  test('Tab takes the quote along with its item', () => {
    expect(pressed(indentItems, '- a\n- b\n  > said\n  > more\n- c', '- b')).toBe(
      '- a\n  - b\n    > said\n    > more\n- c',
    )
  })

  test('Tab takes a callout along with its task', () => {
    expect(pressed(indentItems, '- [ ] a\n- [ ] b\n  > [!note] Why\n  > Because\n- [ ] c', '- [ ] b')).toBe(
      '- [ ] a\n  - [ ] b\n    > [!note] Why\n    > Because\n- [ ] c',
    )
  })

  test('Shift-Tab twice keeps the quote a quote of its item, not code', () => {
    const once = pressed(outdentItems, '- a\n  - b\n    - c\n      > said', '    - c')
    expect(pressed(outdentItems, once, '- c')).toBe('- a\n  - b\n- c\n  > said')
  })
})
