import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed } from './paste-place'

function pasted(doc: string, at: number, text: string): EditorState {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  return parsed(state.update(placed(state, text)).state)
}

function standsAlone(state: EditorState, words: string): boolean {
  const at = state.doc.toString().indexOf(words)
  const node = syntaxTree(state).resolveInner(at, 1)
  const paragraph = node.name === 'Paragraph' ? node : node.parent
  return paragraph?.name === 'Paragraph' && paragraph.parent?.name === 'Document'
}

describe('whole block lines copied in Orden, pasted at the start of a paragraph', () => {
  const doc = 'Before the trip.\n\nAfter the trip.'
  const start = doc.indexOf('After')

  test('a list leaves the paragraph a paragraph of its own', () => {
    expect(standsAlone(pasted(doc, start, '- passport\n- tickets\n'), 'After the trip.')).toBe(true)
  })

  test('a quote leaves the paragraph outside the quote', () => {
    expect(
      standsAlone(pasted(doc, start, '> Pack light.\n> Leave early.\n'), 'After the trip.'),
    ).toBe(true)
  })

  test('a table leaves the paragraph out of its rows', () => {
    const table = '| item | cost |\n| --- | --- |\n| tea | 2 |\n'
    expect(standsAlone(pasted(doc, start, table), 'After the trip.')).toBe(true)
  })
})
