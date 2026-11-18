import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { marksAcross } from './marks'

function across(doc: string, mark = '**') {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(0, doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  let next = state
  marksAcross(mark)({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}

describe('bold over several blocks inside a quote', () => {
  test('two paragraphs of one quote get a run each', () => {
    expect(across('> a\n>\n> b')).toBe('> **a**\n>\n> **b**')
  })

  test('the items of a quoted list get a run each', () => {
    expect(across('> - a\n> - b')).toBe('> - **a**\n> - **b**')
  })

  test('two headings one under the other get a run each', () => {
    expect(across('# A\n## B')).toBe('# **A**\n## **B**')
  })
})
