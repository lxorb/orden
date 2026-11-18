import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed, plainly } from './paste-place'

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function standsAlone(state: EditorState, words: string): boolean {
  const at = state.doc.toString().indexOf(words)
  const node = syntaxTree(state).resolveInner(at, 1)
  const paragraph = node.name === 'Paragraph' ? node : node.parent
  return paragraph?.name === 'Paragraph' && paragraph.parent?.name === 'Document'
}

function pasted(route: (state: EditorState, text: string) => TransactionSpec): EditorState {
  const doc = 'Groceries\n- \nMilk is already in the fridge.'
  const state = stateOf(doc, 'Groceries\n- '.length)
  return parsed(state.update(route(state, '- eggs\n- bread')).state)
}

describe('edit30 a list pasted on a new empty item right above a line of words', () => {
  test('copied in Orden, the line under it stays a paragraph of its own', () => {
    expect(standsAlone(pasted(placed), 'Milk is already')).toBe(true)
  })

  test('as plain text, the line under it stays a paragraph of its own', () => {
    expect(standsAlone(pasted(plainly), 'Milk is already')).toBe(true)
  })
})
