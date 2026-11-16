import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { insertLink } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function linked(doc: string, from: number, to = from): string {
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

describe('Insert link (Mod-K) with the caret in a link already written', () => {
  test('a markdown link stays whole', () => {
    const doc = 'Read the [docs](https://example.com) first'
    expect(linked(doc, doc.indexOf('docs') + 2)).toContain('[docs](https://example.com)')
  })

  test('a wikilink stays whole', () => {
    const doc = 'See [[Project plan]] today'
    expect(linked(doc, doc.indexOf('plan'))).toContain('[[Project plan]]')
  })
})
