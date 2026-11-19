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
describe('code pasted into an item or quote keeps all of its lines inside', () => {
  test('a diff pasted after the words of a bullet stays in the item', () => {
    expect(pasted('- see', '```diff\n- old\n+ new\n```')).toBe('- see\n\n  ```diff\n  - old\n  + new\n  ```')
  })
  test('a prompt pasted into a quote keeps its own marker', () => {
    expect(pasted('> see', '```\n> prompt\n```')).toBe('> see\n>\n> ```\n> > prompt\n> ```')
  })
})
describe('a list pasted after the words of an item keeps its items together', () => {
  test('two bullets', () => {
    expect(pasted('- see', '- a\n- b')).toBe('- see\n\n  - a\n  - b')
  })
  test('two numbered items', () => {
    expect(pasted('1. see', '1. a\n2. b')).toBe('1. see\n\n   1. a\n   2. b')
  })
  test('two bullets after an item in a quote', () => {
    expect(pasted('> - see', '- a\n- b')).toBe('> - see\n>\n>   - a\n>   - b')
  })
})
describe('nested items copied in Orden from their words and pasted on a new item of that list', () => {
  test('stay siblings', () => {
    expect(pasted('- a\n  - b\n  - c\n  - ', 'b\n  - c')).toBe('- a\n  - b\n  - c\n  - b\n  - c')
  })
})
