import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { insertLink } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function linked(doc: string, from: number, to: number): string {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.range(from, to),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  let next = state
  insertLink({ state, dispatch: (one: Transaction) => (next = one.state) })
  return next.doc.toString()
}

describe('Insert link over a whole picked line', () => {
  test('a list item keeps its marker outside the link', () => {
    expect(linked('- item\n', 0, 6)).toBe('- [item]()\n')
  })

  test('a heading keeps its hashes outside the link', () => {
    expect(linked('# Title\nnext', 0, 8)).toBe('# [Title]()\nnext')
  })
})
