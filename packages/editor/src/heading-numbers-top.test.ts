import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { buildDecorations } from './live-preview/decorate'
import { numberHeadings } from './headings'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { parsed } from '../test/parsed'

function numbersDrawn(doc: string): string[] {
  const state = parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }), numberHeadings.of(true)],
    }),
  )
  const out: string[] = []
  buildDecorations(state).decorations.between(0, doc.length, (at, _to, value) => {
    const number = (value.spec.attributes as Record<string, string> | undefined)?.['data-heading-number']
    if (number) out.push(`${number} ${state.doc.lineAt(at).text}`)
  })
  return out
}
describe('numbered headings in a note whose top headings are not level one', () => {
  test('count from 1, as the setting says, not from 0', () => {
    expect(numbersDrawn('## Setup\n\nwords\n\n## Usage\n\n### Flags\n\nmore\n')).toEqual([
      '1 ## Setup',
      '2 ## Usage',
      '2.1 ### Flags',
    ])
  })
})
