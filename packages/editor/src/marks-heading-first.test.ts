import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { highlightTone } from '@orden/markdown/highlights'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { highlightAcross, marksAcross } from './marks'

function stateOf(doc: string): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
function run(
  command: (target: { state: EditorState; dispatch: (one: Transaction) => void }) => boolean,
  doc: string,
): string {
  const state = stateOf(doc)
  let next = state
  command({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}
describe('edit31 a mark over a heading and the paragraph written right under it', () => {
  test('bold gives the heading and the paragraph a run each', () => {
    expect(run(marksAcross('**'), '# Title\nSome text')).toBe('# **Title**\n**Some text**')
  })
  test('italic over a heading and two paragraph lines under it', () => {
    expect(run(marksAcross('*'), '## Plan\nFirst line\nsecond line').split('\n')[0]).toBe('## *Plan*')
  })
  test('highlight gives the heading and the paragraph a run each', () => {
    expect(run(highlightAcross(highlightTone(null)), '# Title\nSome text')).toBe('# ==Title==\n==Some text==')
  })
  test('bold over a line of words and the quote written right under it gives each a run', () => {
    expect(run(marksAcross('**'), 'He said:\n> Ship it')).toBe('**He said:**\n> **Ship it**')
  })
})
