import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { setHeading, shiftHeading } from './commands'
import { ordenMarkdownExtensions } from './markdown/extensions'

function ran(command: StateCommand, doc: string, at: string): string {
  let state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.indexOf(at)),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
  command({ state, dispatch: (transaction) => (state = transaction.state) })
  return state.doc.toString()
}

describe('heading commands on a callout title line', () => {
  const doc = '> [!NOTE] Title\n> body'

  test('Heading 2 keeps the callout marker first on its line', () => {
    expect(ran(setHeading(2), doc, 'Title').split('\n')[0]).toMatch(/^> \[!NOTE\]/)
  })

  test('heading up keeps the callout marker first on its line', () => {
    expect(ran(shiftHeading(1), doc, 'Title').split('\n')[0]).toMatch(/^> \[!NOTE\]/)
  })
})
