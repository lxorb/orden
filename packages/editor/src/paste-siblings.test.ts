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

describe('lines copied from their words in Orden and pasted on a new empty line of the same kind', () => {
  test('two bullets stay siblings', () => {
    expect(pasted('- bread\n- ', 'milk\n- eggs')).toBe('- bread\n- milk\n- eggs')
  })

  test('two numbered items stay siblings', () => {
    expect(pasted('1. bread\n2. ', 'milk\n3. eggs')).toBe('1. bread\n2. milk\n3. eggs')
  })

  test('two tasks stay siblings', () => {
    expect(pasted('- [ ] bread\n- [ ] ', 'milk\n- [ ] eggs')).toBe(
      '- [ ] bread\n- [ ] milk\n- [ ] eggs',
    )
  })

  test('two quoted lines stay in the one quote', () => {
    expect(pasted('> first\n> ', 'second\n> third')).toBe('> first\n> second\n> third')
  })
})
