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
describe('whole list lines whose last item runs on, pasted at the start of a paragraph', () => {
  const doc = 'Before the trip.\n\nAfter the trip.'
  const start = doc.indexOf('After')
  test('a last item with a second line leaves the paragraph a paragraph of its own', () => {
    const state = pasted(doc, start, '- passport\n- tickets\n  and visas\n')
    expect(standsAlone(state, 'After the trip.')).toBe(true)
  })
  test('a last item with a second paragraph leaves the paragraph a paragraph of its own', () => {
    const state = pasted(doc, start, '- passport\n- tickets\n\n  Print them.\n')
    expect(standsAlone(state, 'After the trip.')).toBe(true)
  })
})
