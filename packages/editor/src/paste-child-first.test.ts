import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { placed } from './paste-place'
import { parsed } from '../test/parsed'

function pasted(doc: string, text: string): string {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: markdown({ base: markdownLanguage }),
    }),
  )
  return state.update(placed(state, text)).state.doc.toString()
}
describe('items copied from their words, the first with a child, pasted on a new item', () => {
  test('keep the child under its own item and the later item a sibling', () => {
    expect(pasted('- list\n- ', 'milk\n  - oat\n- eggs')).toBe('- list\n- milk\n  - oat\n- eggs')
  })
  test('keep a numbered child under its own item', () => {
    expect(pasted('1. list\n2. ', 'milk\n   1. oat\n3. eggs')).toBe('1. list\n2. milk\n   1. oat\n3. eggs')
  })
})
