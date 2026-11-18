import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed } from './paste-place'

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function pasted(doc: string, at: number, text: string): EditorState {
  const state = stateOf(doc, at)
  return parsed(state.update(placed(state, text)).state)
}

function standsAlone(state: EditorState, words: string): boolean {
  const at = state.doc.toString().indexOf(words)
  const node = syntaxTree(state).resolveInner(at, 1)
  const paragraph = node.name === 'Paragraph' ? node : node.parent
  return paragraph?.name === 'Paragraph' && paragraph.parent?.name === 'Document'
}

describe('edit29 a list or quote copied in Orden, pasted on the blank line between paragraphs', () => {
  const doc = 'Before the trip.\n\nAfter the trip.'
  const blank = 'Before the trip.\n'.length

  test('a list leaves the paragraph under it a paragraph of its own', () => {
    const after = pasted(doc, blank, '- passport\n- tickets')
    expect(standsAlone(after, 'After the trip.')).toBe(true)
  })

  test('a quote leaves the paragraph under it outside the quote', () => {
    const after = pasted(doc, blank, '> Pack light.\n> Leave early.')
    expect(standsAlone(after, 'After the trip.')).toBe(true)
  })

  test('a list pasted at the end of a line keeps the next line out of its last item', () => {
    const lines = 'Shopping:\nMilk is already in the fridge.'
    const after = pasted(lines, 'Shopping:'.length, '- eggs\n- bread')
    expect(standsAlone(after, 'Milk is already')).toBe(true)
  })
})
